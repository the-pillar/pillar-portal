import { beforeEach, describe, expect, it, vi } from "vitest"

const { send, Resend, emailConfig } = vi.hoisted(() => {
  const send = vi.fn()
  return {
    send,
    Resend: vi.fn(function () {
      return { emails: { send } }
    }),
    emailConfig: {
      mode: "send" as "send" | "sink",
      resendApiKey: "re_" + "a-key-for-these-tests-only",
      from: "The Pillar <portal@example.com>" as string | undefined,
      dailyLimit: 100,
      monthlyLimit: 3000,
      confirmationCap: 30,
    },
  }
})

vi.mock("resend", () => ({ Resend }))
vi.mock("@/lib/env.server", () => ({ emailConfig }))

import { createResendTransport, createSinkTransport } from "./transport"

const EMAIL = {
  to: "ana@example.com",
  subject: "Hi",
  html: "<p>Hi</p>",
  text: "Hi",
  idempotencyKey: "reminder:abc:1",
}

beforeEach(() => {
  vi.clearAllMocks()
  emailConfig.from = "The Pillar <portal@example.com>"
})

describe("sink transport", () => {
  it("records the email under a sink: message id and never builds Resend", async () => {
    const sink = createSinkTransport()
    const result = await sink.send(EMAIL)

    expect(result).toEqual({
      ok: true,
      messageId: expect.stringMatching(/^sink:[0-9a-f-]{36}$/),
    })
    expect(sink.sent).toHaveLength(1)
    expect(Resend).not.toHaveBeenCalled()
  })

  it("keeps the last 50 and logs no address", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    const sink = createSinkTransport()
    for (let i = 0; i < 55; i++) {
      await sink.send({ ...EMAIL, idempotencyKey: `k:${i}` })
    }

    expect(sink.sent).toHaveLength(50)
    expect(sink.sent[0].idempotencyKey).toBe("k:5")
    expect(sink.sent.at(-1)?.idempotencyKey).toBe("k:54")
    expect(log).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
    log.mockRestore()
    info.mockRestore()
  })
})

describe("resend transport", () => {
  it("sends from EMAIL_FROM with the idempotency key and returns the id", async () => {
    send.mockResolvedValue({ data: { id: "msg_123" }, error: null })
    const transport = createResendTransport(async () => {})

    const result = await transport.send(EMAIL)

    expect(result).toEqual({ ok: true, messageId: "msg_123" })
    expect(send).toHaveBeenCalledExactlyOnceWith(
      {
        from: "The Pillar <portal@example.com>",
        to: "ana@example.com",
        subject: "Hi",
        html: "<p>Hi</p>",
        text: "Hi",
      },
      { idempotencyKey: "reminder:abc:1" }
    )
  })

  it("returns error.name as the code, never the message", async () => {
    send.mockResolvedValue({
      data: null,
      error: { name: "rate_limit_exceeded", message: "to ana@example.com" },
    })
    const result = await createResendTransport(async () => {}).send(EMAIL)

    expect(result).toEqual({ ok: false, code: "rate_limit_exceeded" })
  })

  it("falls back to email.provider_error for a name that isn't a code, and for a throw", async () => {
    const transport = createResendTransport(async () => {})
    send.mockResolvedValueOnce({
      data: null,
      error: { name: "has spaces and ana@example.com", message: "m" },
    })
    send.mockRejectedValueOnce(new Error("boom ana@example.com"))

    expect(await transport.send(EMAIL)).toEqual({
      ok: false,
      code: "email.provider_error",
    })
    expect(await transport.send(EMAIL)).toEqual({
      ok: false,
      code: "email.provider_error",
    })
  })

  it("spaces sends at least 600 ms apart", async () => {
    send.mockResolvedValue({ data: { id: "msg_1" }, error: null })
    const sleep = vi.fn(async () => {})
    const transport = createResendTransport(sleep)

    await transport.send(EMAIL)
    expect(sleep).not.toHaveBeenCalled()
    await transport.send(EMAIL)

    expect(sleep).toHaveBeenCalledTimes(1)
    const [ms] = sleep.mock.calls[0] as unknown as [number]
    expect(ms).toBeGreaterThan(0)
    expect(ms).toBeLessThanOrEqual(600)
  })

  it("refuses to be built without the sender address", () => {
    emailConfig.from = undefined
    expect(() => createResendTransport()).toThrow("email.not_configured")
  })
})
