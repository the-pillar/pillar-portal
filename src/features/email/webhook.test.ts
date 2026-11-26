import { Webhook } from "standardwebhooks"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { rpc, recordErrorEvent, emailConfig } = vi.hoisted(() => ({
  rpc: vi.fn(),
  recordErrorEvent: vi.fn(async () => {}),
  emailConfig: { webhookSecret: undefined as string | undefined },
}))

vi.mock("next/server", () => ({
  after: (callback: () => unknown) => void callback(),
}))
vi.mock("@/lib/env.server", () => ({ emailConfig }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }))
vi.mock("@/lib/record-error-event", () => ({ recordErrorEvent }))

import { handleResendWebhook } from "./webhook"

// Built at runtime: no secret-shaped literal sits in the source.
const SECRET =
  "whsec_" + Buffer.from("a-secret-for-these-tests").toString("base64")
const URL_ = "https://portal.example/api/webhooks/resend"

const BOUNCE = {
  type: "email.bounced",
  created_at: "2026-11-26T01:00:00Z",
  data: {
    email_id: "msg_abc123",
    subject: "A private subject",
    to: ["ana@example.com"],
    bounce: {
      type: "Permanent",
      subType: "General",
      message: "550 mailbox ana@example.com unavailable",
    },
  },
}

function signed(
  body: unknown,
  {
    id = "msg_svix1",
    ageSeconds = 0,
    headers = {} as Record<string, string>,
  } = {}
) {
  const raw = typeof body === "string" ? body : JSON.stringify(body)
  const at = new Date(Date.now() - ageSeconds * 1000)
  const signature = new Webhook(SECRET).sign(id, at, raw)
  return new Request(URL_, {
    method: "POST",
    body: raw,
    headers: {
      "svix-id": id,
      "svix-timestamp": String(Math.floor(at.getTime() / 1000)),
      "svix-signature": signature,
      ...headers,
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  emailConfig.webhookSecret = SECRET
  rpc.mockResolvedValue({ data: "recorded", error: null })
})

describe("handleResendWebhook", () => {
  it("records a verified bounce and answers 200", async () => {
    const response = await handleResendWebhook(signed(BOUNCE))
    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledExactlyOnceWith("record_email_event", {
      svix_id: "msg_svix1",
      event_type: "email.bounced",
      provider_message_id: "msg_abc123",
      bounce_type: "Permanent",
      bounce_subtype: "General",
    })
  })

  it("passes a suppression's type as bounce_type, never its message", async () => {
    const event = {
      type: "email.suppressed",
      data: {
        email_id: "msg_abc123",
        suppressed: { type: "OnAccountSuppressionList", message: "free text" },
      },
    }
    expect((await handleResendWebhook(signed(event))).status).toBe(200)
    expect(rpc.mock.calls[0][1]).toEqual({
      svix_id: "msg_svix1",
      event_type: "email.suppressed",
      provider_message_id: "msg_abc123",
      bounce_type: "OnAccountSuppressionList",
      bounce_subtype: "",
    })
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("free text")
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("ana@example.com")
  })

  it("answers 200 for any recorder outcome, a replay included", async () => {
    rpc.mockResolvedValue({ data: "duplicate", error: null })
    expect((await handleResendWebhook(signed(BOUNCE))).status).toBe(200)
    rpc.mockResolvedValue({ data: "ignored", error: null })
    expect(
      (await handleResendWebhook(signed({ type: "email.delivered" }))).status
    ).toBe(200)
  })

  it("rejects a tampered body with 401 and calls nothing", async () => {
    const request = signed(BOUNCE)
    const tampered = new Request(URL_, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({ ...BOUNCE, type: "email.complained" }),
    })
    expect((await handleResendWebhook(tampered)).status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("rejects a timestamp 6 minutes old with 401", async () => {
    const response = await handleResendWebhook(
      signed(BOUNCE, { ageSeconds: 360 })
    )
    expect(response.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("accepts a timestamp 4 minutes old", async () => {
    const response = await handleResendWebhook(
      signed(BOUNCE, { ageSeconds: 240 })
    )
    expect(response.status).toBe(200)
  })

  it.each(["svix-id", "svix-timestamp", "svix-signature"])(
    "rejects a request without %s with 401",
    async (name) => {
      const request = signed(BOUNCE)
      const headers = new Headers(request.headers)
      headers.delete(name)
      const stripped = new Request(URL_, {
        method: "POST",
        headers,
        body: JSON.stringify(BOUNCE),
      })
      expect((await handleResendWebhook(stripped)).status).toBe(401)
      expect(rpc).not.toHaveBeenCalled()
    }
  )

  it("rejects everything with 401 when no secret is set", async () => {
    emailConfig.webhookSecret = undefined
    expect((await handleResendWebhook(signed(BOUNCE))).status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("rejects a request carrying an Origin with 403", async () => {
    const response = await handleResendWebhook(
      signed(BOUNCE, { headers: { origin: "https://evil.example" } })
    )
    expect(response.status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("rejects a body over 64 KB with 413", async () => {
    const big = JSON.stringify({
      type: "email.delivered",
      pad: "x".repeat(70_000),
    })
    expect((await handleResendWebhook(signed(big))).status).toBe(413)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("answers 200 for a signed body that isn't an event, calling nothing", async () => {
    expect((await handleResendWebhook(signed({ nope: 1 }))).status).toBe(200)
    expect((await handleResendWebhook(signed("not json"))).status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("treats null fields as missing and still records", async () => {
    const event = {
      type: "email.bounced",
      data: {
        email_id: "msg_abc123",
        bounce: { type: "Permanent", subType: null },
      },
    }
    expect((await handleResendWebhook(signed(event))).status).toBe(200)
    expect(rpc.mock.calls[0][1]).toMatchObject({
      bounce_type: "Permanent",
      bounce_subtype: "",
    })
    rpc.mockClear()
    for (const data of [null, { email_id: null, bounce: null }]) {
      expect(
        (await handleResendWebhook(signed({ type: "email.bounced", data })))
          .status
      ).toBe(200)
    }
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it("answers 500, records it and calls nothing when the secret can't build a verifier", async () => {
    const request = signed(BOUNCE)
    emailConfig.webhookSecret = "whsec_" + "%%%not-base64%%%"
    const response = await handleResendWebhook(request)
    expect(response.status).toBe(500)
    expect(recordErrorEvent).toHaveBeenCalledOnce()
    expect(rpc).not.toHaveBeenCalled()
  })

  it("answers 500 and records the fault when the recorder fails", async () => {
    const fault = { code: "PGRST000", message: "boom" }
    rpc.mockResolvedValue({ data: null, error: fault })
    const response = await handleResendWebhook(signed(BOUNCE))
    expect(response.status).toBe(500)
    expect(recordErrorEvent).toHaveBeenCalledWith(fault, {
      route: "route /api/webhooks/resend",
    })
  })

  it("never logs the body", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (name) => vi.spyOn(console, name).mockImplementation(() => {})
    )
    rpc.mockResolvedValueOnce({ data: null, error: { code: "x" } })
    await handleResendWebhook(signed(BOUNCE))
    await handleResendWebhook(signed(BOUNCE, { ageSeconds: 360 }))
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain("ana@example.com")
      expect(JSON.stringify(spy.mock.calls)).not.toContain("A private subject")
    }
    spies.forEach((spy) => spy.mockRestore())
  })
})
