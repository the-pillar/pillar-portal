import "server-only"

import { after } from "next/server"
import { Webhook } from "standardwebhooks"
import { z } from "zod"

import { emailConfig } from "@/lib/env.server"
import { recordErrorEvent } from "@/lib/record-error-event"
import { createAdminClient } from "@/lib/supabase/admin"

const NO_STORE = { "Cache-Control": "private, no-store" }
const MAX_BODY_BYTES = 64 * 1024
const ROUTE = "route /api/webhooks/resend"

// What the portal reads of Resend's event; everything else is dropped. The
// provider's message text is never read, so it can't reach the database.
const eventSchema = z.object({
  type: z.string().max(100),
  data: z
    .object({
      email_id: z.string().max(200).nullish(),
      bounce: z
        .object({
          type: z.string().max(200).nullish(),
          subType: z.string().max(200).nullish(),
        })
        .nullish(),
      suppressed: z.object({ type: z.string().max(200).nullish() }).nullish(),
    })
    .nullish(),
})

function reply(status: number) {
  return new Response(null, { status, headers: NO_STORE })
}

/**
 * Resend's webhook (AD-9): verifies the Svix signature, reads the event and
 * records it through `record_email_event`, which does the rest.
 *
 * - any `Origin` header (a browser sent it): 403
 * - a body over 64 KB: 413
 * - no secret configured, a missing header, a bad signature or a timestamp
 *   more than 5 minutes off: 401, and nothing is called
 * - a verified event: 200, whatever the recorder made of it
 * - a verified body that isn't an event: 200, and nothing is called
 * - a secret that can't be used (not base64): 500, recorded
 * - a recorder error or a throw: 500, recorded after the response
 *
 * Nothing here logs the body.
 */
export async function handleResendWebhook(request: Request) {
  if (request.headers.has("origin")) return reply(403)

  const declared = Number(request.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return reply(413)

  try {
    const raw = await request.text()
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
      return reply(413)
    }

    const secret = emailConfig.webhookSecret
    const id = request.headers.get("svix-id")
    const timestamp = request.headers.get("svix-timestamp")
    const signature = request.headers.get("svix-signature")
    if (!secret || !id || !timestamp || !signature) return reply(401)

    // A secret that can't build a verifier is a fault (500, recorded), not a
    // bad request.
    const webhook = new Webhook(secret)
    let verified: unknown
    try {
      verified = webhook.verify(raw, {
        "webhook-id": id,
        "webhook-timestamp": timestamp,
        "webhook-signature": signature,
      })
    } catch {
      return reply(401)
    }

    const event = eventSchema.safeParse(verified)
    if (!event.success) return reply(200)
    const { type, data } = event.data

    const { error } = await createAdminClient().rpc("record_email_event", {
      svix_id: id,
      event_type: type,
      // Empty strings stand for a missing field: the recorder matches no
      // row for an empty message id and leaves an empty part out of a code.
      provider_message_id: data?.email_id ?? "",
      bounce_type: data?.bounce?.type ?? data?.suppressed?.type ?? "",
      bounce_subtype: data?.bounce?.subType ?? "",
    })
    if (error) throw error
    return reply(200)
  } catch (error) {
    after(() => recordErrorEvent(error, { route: ROUTE }))
    return reply(500)
  }
}
