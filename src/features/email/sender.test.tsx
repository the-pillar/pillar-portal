import { beforeEach, describe, expect, it, vi } from "vitest"

const { rpc, recordErrorEvent, Resend, emailConfig } = vi.hoisted(() => ({
  rpc: vi.fn(),
  recordErrorEvent: vi.fn(async () => {}),
  Resend: vi.fn(),
  emailConfig: {
    mode: "sink" as const,
    resendApiKey: undefined,
    from: undefined,
    dailyLimit: 100,
    monthlyLimit: 3000,
    confirmationCap: 30,
  },
}))

vi.mock("resend", () => ({ Resend }))
vi.mock("@/lib/env.server", () => ({ emailConfig }))
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://portal.pillar.example" },
}))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }))
vi.mock("@/lib/record-error-event", () => ({
  recordErrorEvent,
  errorCodeOf: (error: unknown) =>
    (error as { code?: string } | null)?.code ?? "unknown",
}))

import { drainOutbox } from "./sender"
import { EmailShell } from "./shell"
import { templates } from "./templates"
import { createSinkTransport, type EmailTransport } from "./transport"

function row(n: number, template = "sample") {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    kind: "reminder",
    template,
    payload: { name: `Ana ${n}` },
    dedupe_key: `reminder:${n}`,
    attempt: 1,
  }
}

type Handlers = Partial<
  Record<string, (args: Record<string, unknown>) => unknown>
>

// Answers each RPC from `handlers`, by name.
function stubRpc(handlers: Handlers) {
  rpc.mockImplementation(
    async (name: string, args: Record<string, unknown>) => {
      const handler = handlers[name]
      if (!handler) throw new Error(`unexpected rpc ${name}`)
      return handler(args)
    }
  )
}

const ok = (data: unknown) => ({ data, error: null })

beforeEach(() => {
  vi.clearAllMocks()
  rpc.mockReset()
  templates.sample = {
    subject: (p) => `Hello ${String(p.name)}`,
    element: (p) => (
      <EmailShell preview="p" heading="Hi" audience="staff">
        {String(p.name)}
      </EmailShell>
    ),
  }
})

describe("drainOutbox", () => {
  it("claims, prepares, sends through the sink and marks, in sink mode without Resend", async () => {
    const queue = [[row(1), row(2)], []]
    stubRpc({
      claim_email_batch: () => ok(queue.shift() ?? []),
      prepare_email_send: () =>
        ok([{ outcome: "ready", address: "ana@example.com" }]),
      mark_email_sent: () => ok(true),
    })
    const sink = createSinkTransport()

    const result = await drainOutbox({ transport: sink })

    expect(result).toEqual({
      claimed: 2,
      sent: 2,
      dropped: 0,
      failed: 0,
      gone: 0,
      faulted: false,
    })
    expect(sink.sent.map((s) => s.idempotencyKey)).toEqual([
      "reminder:1:1",
      "reminder:2:1",
    ])
    expect(rpc).toHaveBeenCalledWith("claim_email_batch", {
      max_rows: 25,
      daily_limit: 100,
      monthly_limit: 3000,
      confirmation_cap: 30,
    })
    const marks = rpc.mock.calls.filter(([name]) => name === "mark_email_sent")
    expect(marks[0][1]).toMatchObject({
      attempt: 1,
      provider_message_id: expect.stringMatching(/^sink:/),
    })
    expect(Resend).not.toHaveBeenCalled()
    expect(recordErrorEvent).not.toHaveBeenCalled()
  })

  it("uses the sink by default when EMAIL_MODE is sink, and never builds Resend", async () => {
    const queue = [[row(1)], []]
    stubRpc({
      claim_email_batch: () => ok(queue.shift() ?? []),
      prepare_email_send: () =>
        ok([{ outcome: "ready", address: "ana@example.com" }]),
      mark_email_sent: () => ok(true),
    })

    const result = await drainOutbox()

    expect(result.sent).toBe(1)
    expect(Resend).not.toHaveBeenCalled()
  })

  it("counts a dropped row and a gone row, and sends neither", async () => {
    const queue = [[row(1), row(2)], []]
    const outcomes = ["dropped", "gone"]
    stubRpc({
      claim_email_batch: () => ok(queue.shift() ?? []),
      prepare_email_send: () =>
        ok([{ outcome: outcomes.shift(), address: null }]),
    })
    const sink = createSinkTransport()

    const result = await drainOutbox({ transport: sink })

    expect(result).toMatchObject({ claimed: 2, sent: 0, dropped: 1, gone: 1 })
    expect(sink.sent).toHaveLength(0)
  })

  it("fails only the row whose provider call errors, and records it", async () => {
    const queue = [[row(1), row(2)], []]
    stubRpc({
      claim_email_batch: () => ok(queue.shift() ?? []),
      prepare_email_send: () =>
        ok([{ outcome: "ready", address: "ana@example.com" }]),
      mark_email_sent: () => ok(true),
      mark_email_failed: () => ok(true),
    })
    const transport: EmailTransport = {
      send: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, code: "rate_limit_exceeded" })
        .mockResolvedValueOnce({ ok: true, messageId: "msg_2" }),
    }

    const result = await drainOutbox({ transport })

    expect(result).toMatchObject({ claimed: 2, sent: 1, failed: 1 })
    expect(rpc).toHaveBeenCalledWith("mark_email_failed", {
      outbox_id: row(1).id,
      attempt: 1,
      error: "rate_limit_exceeded",
    })
    expect(rpc).toHaveBeenCalledWith("mark_email_sent", {
      outbox_id: row(2).id,
      attempt: 1,
      provider_message_id: "msg_2",
    })
    expect(recordErrorEvent).toHaveBeenCalledExactlyOnceWith(
      { code: "rate_limit_exceeded" },
      { route: "email drain", entityType: "email_outbox", entityId: row(1).id }
    )
  })

  it("fails an unknown template with email.unknown_template and goes on", async () => {
    const queue = [[row(1, "mystery"), row(2)], []]
    stubRpc({
      claim_email_batch: () => ok(queue.shift() ?? []),
      prepare_email_send: () =>
        ok([{ outcome: "ready", address: "ana@example.com" }]),
      mark_email_sent: () => ok(true),
      mark_email_failed: () => ok(true),
    })
    const sink = createSinkTransport()

    const result = await drainOutbox({ transport: sink })

    expect(result).toMatchObject({ sent: 1, failed: 1 })
    expect(rpc).toHaveBeenCalledWith("mark_email_failed", {
      outbox_id: row(1, "mystery").id,
      attempt: 1,
      error: "email.unknown_template",
    })
    expect(sink.sent).toHaveLength(1)
    expect(recordErrorEvent).toHaveBeenCalledTimes(1)
  })

  it("resolves when an RPC throws, recording it, and moves to the next row", async () => {
    const queue = [[row(1), row(2)], []]
    let prepares = 0
    stubRpc({
      claim_email_batch: () => ok(queue.shift() ?? []),
      prepare_email_send: () => {
        prepares += 1
        if (prepares === 1) throw new Error("network down")
        return ok([{ outcome: "ready", address: "ana@example.com" }])
      },
      mark_email_sent: () => ok(true),
      mark_email_failed: () => ok(true),
    })

    await expect(
      drainOutbox({ transport: createSinkTransport() })
    ).resolves.toMatchObject({ claimed: 2, sent: 1, failed: 1 })
    expect(rpc).toHaveBeenCalledWith("mark_email_failed", {
      outbox_id: row(1).id,
      attempt: 1,
      error: "email.prepare_error",
    })
    expect(recordErrorEvent).toHaveBeenCalledTimes(1)
  })

  it("resolves with what it did when the claim itself fails", async () => {
    stubRpc({
      claim_email_batch: () => ({ data: null, error: { code: "42501" } }),
    })

    await expect(drainOutbox()).resolves.toEqual({
      claimed: 0,
      sent: 0,
      dropped: 0,
      failed: 0,
      gone: 0,
      faulted: true,
    })
    expect(recordErrorEvent).toHaveBeenCalledExactlyOnceWith(
      { code: "42501" },
      { route: "email drain" }
    )
  })

  it("stops starting batches once the deadline has passed", async () => {
    stubRpc({ claim_email_batch: () => ok([]) })

    await drainOutbox({ deadlineMs: 0 })

    expect(rpc).not.toHaveBeenCalled()
  })

  it("loops over batches until a claim returns nothing", async () => {
    const queue = [[row(1)], [row(2)], [row(3)], []]
    stubRpc({
      claim_email_batch: () => ok(queue.shift() ?? []),
      prepare_email_send: () =>
        ok([{ outcome: "ready", address: "ana@example.com" }]),
      mark_email_sent: () => ok(true),
    })

    const result = await drainOutbox({
      transport: createSinkTransport(),
      maxRows: 1,
    })

    expect(result.sent).toBe(3)
    expect(
      rpc.mock.calls.filter(([name]) => name === "claim_email_batch")
    ).toHaveLength(4)
  })
})
