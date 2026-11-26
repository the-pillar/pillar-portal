import { Resend } from "resend"

import { emailConfig } from "@/lib/env.server"

/** What the sender hands a transport: one email to one address. */
export type OutboundEmail = {
  to: string
  subject: string
  html: string
  text: string
  /** `<dedupe_key>:<attempt>`: a resend of the same attempt dedupes. */
  idempotencyKey: string
}

/** A sent email's provider id, or a code (never a message or an address). */
export type SendResult =
  { ok: true; messageId: string } | { ok: false; code: string }

export interface EmailTransport {
  send(email: OutboundEmail): Promise<SendResult>
}

const CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/
const PROVIDER_ERROR = "email.provider_error"
const MIN_SEND_SPACING_MS = 600
const SINK_RECORD_CAP = 50

export type SunkEmail = OutboundEmail & { messageId: string }

/** The recorder behind `sink` mode. */
export type SinkTransport = EmailTransport & {
  /** The last 50 emails, oldest first. */
  readonly sent: readonly SunkEmail[]
  clear(): void
}

/**
 * Sink mode: the whole path runs and the email is recorded in memory (the
 * last 50, for tests and for a look at what would have gone out), never
 * sent. It logs nothing, so no address reaches a log. The message id is
 * `sink:<uuid>`.
 */
export function createSinkTransport(): SinkTransport {
  const sent: SunkEmail[] = []
  return {
    sent,
    clear() {
      sent.length = 0
    },
    async send(email) {
      const messageId = `sink:${crypto.randomUUID()}`
      sent.push({ ...email, messageId })
      if (sent.length > SINK_RECORD_CAP) {
        sent.splice(0, sent.length - SINK_RECORD_CAP)
      }
      return { ok: true, messageId }
    },
  }
}

/** The default recorder, shared by every drain in this server process. */
export const sinkTransport = createSinkTransport()

function codeOf(candidate: unknown): string {
  return typeof candidate === "string" && CODE_PATTERN.test(candidate)
    ? candidate
    : PROVIDER_ERROR
}

/**
 * Send mode: Resend, from `EMAIL_FROM`, with the idempotency key, and at
 * least 600 ms between sends (Resend allows two requests a second). The
 * client is built here, not at import, so sink mode never constructs it. A
 * failure comes back as `error.name`'s code, never Resend's message.
 */
export function createResendTransport(
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms))
): EmailTransport {
  const { resendApiKey, from } = emailConfig
  if (resendApiKey === undefined || from === undefined) {
    throw new Error("email.not_configured")
  }
  const resend = new Resend(resendApiKey)
  let lastSentAt = 0

  return {
    async send(email) {
      const wait = lastSentAt + MIN_SEND_SPACING_MS - Date.now()
      if (wait > 0) await sleep(wait)
      lastSentAt = Date.now()

      try {
        const { data, error } = await resend.emails.send(
          {
            from,
            to: email.to,
            subject: email.subject,
            html: email.html,
            text: email.text,
          },
          { idempotencyKey: email.idempotencyKey }
        )
        if (error) return { ok: false, code: codeOf(error.name) }
        if (!data?.id) return { ok: false, code: PROVIDER_ERROR }
        return { ok: true, messageId: codeOf(data.id) }
      } catch {
        return { ok: false, code: PROVIDER_ERROR }
      }
    },
  }
}
