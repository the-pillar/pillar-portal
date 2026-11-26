import "server-only"

import { emailConfig } from "@/lib/env.server"
import { errorCodeOf, recordErrorEvent } from "@/lib/record-error-event"
import { createAdminClient } from "@/lib/supabase/admin"

import { EmailRenderError, renderEmail } from "./render"
import {
  createResendTransport,
  type EmailTransport,
  sinkTransport,
} from "./transport"

const BATCH_SIZE = 25
const DEADLINE_MS = 200_000
const ROUTE = "email drain"
const ENTITY_TYPE = "email_outbox"

export type DrainOptions = {
  /** Where emails go: Resend in send mode, the recorder in sink mode. */
  transport?: EmailTransport
  /** The rows claimed per batch (default 25). */
  maxRows?: number
  /** Stop starting batches after this many ms (default 200 s). */
  deadlineMs?: number
}

export type DrainResult = {
  claimed: number
  sent: number
  /** Dropped at send time, by the kind's check. */
  dropped: number
  failed: number
  /** Rows another sender had already moved on: nothing was done. */
  gone: number
  /** The drain itself failed (a claim, not a row) and stopped; recorded already. */
  faulted: boolean
}

function transportFor(options: DrainOptions): EmailTransport {
  if (options.transport) return options.transport
  return emailConfig.mode === "send" ? createResendTransport() : sinkTransport
}

/**
 * Drains the outbox: claims a batch of queued rows within the day's and the
 * month's quota, and for each one runs the kind's send-time check (in
 * Postgres), renders its template, sends it and marks the result. It loops
 * until a claim returns nothing (the queue or the quota is empty) or the
 * deadline passes.
 *
 * It never throws. A row that fails is marked `failed` with a code and
 * recorded in `error_events` (route `email drain`), and the drain goes on to
 * the next row. A thrown RPC leaves its row `sending`, which the next claim
 * puts back after 15 minutes with the same attempt number, so the resend
 * carries the same idempotency key; Resend dedupes on it only within its
 * 24-hour window.
 */
export async function drainOutbox(
  options: DrainOptions = {}
): Promise<DrainResult> {
  const result: DrainResult = {
    claimed: 0,
    sent: 0,
    dropped: 0,
    failed: 0,
    gone: 0,
    faulted: false,
  }
  const batchSize = options.maxRows ?? BATCH_SIZE
  const deadline = Date.now() + (options.deadlineMs ?? DEADLINE_MS)

  try {
    const transport = transportFor(options)
    const admin = createAdminClient()

    while (Date.now() < deadline) {
      const { data: rows, error } = await admin.rpc("claim_email_batch", {
        max_rows: batchSize,
        daily_limit: emailConfig.dailyLimit,
        monthly_limit: emailConfig.monthlyLimit,
        confirmation_cap: emailConfig.confirmationCap,
      })
      if (error) throw error
      if (rows.length === 0) break
      result.claimed += rows.length

      for (const row of rows) {
        try {
          await sendRow(admin, transport, row, result)
        } catch (thrown) {
          result.failed += 1
          await recordErrorEvent(thrown, {
            route: ROUTE,
            entityType: ENTITY_TYPE,
            entityId: row.id,
          })
        }
      }
    }
  } catch (thrown) {
    result.faulted = true
    await recordErrorEvent(thrown, { route: ROUTE })
  }

  return result
}

type Admin = ReturnType<typeof createAdminClient>
type ClaimedRow = {
  id: string
  template: string
  payload: unknown
  dedupe_key: string
  attempt: number
}

async function sendRow(
  admin: Admin,
  transport: EmailTransport,
  row: ClaimedRow,
  result: DrainResult
) {
  let prepared
  try {
    prepared = await admin.rpc("prepare_email_send", {
      outbox_id: row.id,
      attempt: row.attempt,
    })
  } catch (thrown) {
    await failAfterPrepareError(admin, row)
    throw thrown
  }
  if (prepared.error) {
    await failAfterPrepareError(admin, row)
    throw prepared.error
  }

  const [{ outcome, address }] = prepared.data
  if (outcome === "dropped") {
    result.dropped += 1
    return
  }
  if (outcome === "gone") {
    result.gone += 1
    return
  }
  if (outcome !== "ready" || address === null) {
    // `failed`: the command already marked the row (no check, no address).
    result.failed += 1
    await recordErrorEvent(
      { code: "email.prepare_failed" },
      { route: ROUTE, entityType: ENTITY_TYPE, entityId: row.id }
    )
    return
  }

  let rendered
  try {
    rendered = await renderEmail(
      row.template,
      (row.payload ?? {}) as Record<string, unknown>
    )
  } catch (thrown) {
    const code =
      thrown instanceof EmailRenderError ? thrown.code : errorCodeOf(thrown)
    await failRow(admin, row, code, result)
    return
  }

  const sent = await transport.send({
    to: address,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    idempotencyKey: `${row.dedupe_key}:${row.attempt}`,
  })

  if (!sent.ok) {
    await failRow(admin, row, sent.code, result)
    return
  }

  const marked = await admin.rpc("mark_email_sent", {
    outbox_id: row.id,
    attempt: row.attempt,
    provider_message_id: sent.messageId,
  })
  if (marked.error) throw marked.error
  if (marked.data) result.sent += 1
  else result.gone += 1
}

// Marks the row failed with a code, then records the fault. A refused mark
// (the row moved on) is not a fault.
async function failRow(
  admin: Admin,
  row: ClaimedRow,
  code: string,
  result: DrainResult
) {
  const marked = await admin.rpc("mark_email_failed", {
    outbox_id: row.id,
    attempt: row.attempt,
    error: code,
  })
  if (marked.error) throw marked.error
  if (marked.data) result.failed += 1
  else result.gone += 1
  await recordErrorEvent(
    { code },
    { route: ROUTE, entityType: ENTITY_TYPE, entityId: row.id }
  )
}

// A prepare that errors or throws (a send check that raises) would leave the
// row `sending`, reclaimed and retried every drain. Mark it failed, best
// effort. Only before the send: after transport.send a row is never marked
// failed here.
async function failAfterPrepareError(admin: Admin, row: ClaimedRow) {
  try {
    await admin.rpc("mark_email_failed", {
      outbox_id: row.id,
      attempt: row.attempt,
      error: "email.prepare_error",
    })
  } catch {
    // The caller records the original fault.
  }
}
