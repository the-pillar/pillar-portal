import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://portal.pillar.example" },
}))

import { renderEmail } from "./render"
import { templates } from "./templates"

const TASK = "00000000-0000-4000-a100-000000000001"
// 2026-12-02 08:30 in Manila (UTC+8) is 00:30 UTC.
const payload = (roles: string[]) => ({
  task_id: TASK,
  title: "Feature page layout",
  due_at: "2026-12-02T00:30:00.000Z",
  roles,
})

describe("the reminder template", () => {
  it("is registered as `reminder`", () => {
    expect(Object.keys(templates)).toContain("reminder")
  })

  it("renders one role, the due line, the link and no sign-off", async () => {
    const email = await renderEmail("reminder", payload(["layout_artist"]))

    expect(email.subject).toBe("Due Wed 8:30 AM: Feature page layout")
    expect(email.html).toContain(
      "Feature page layout is due Wed, Dec 2, 8:30 AM."
    )
    expect(email.html).toContain("Your role: Layout Artist.")
    expect(email.html).toContain("Open the task")
    expect(email.html).toContain(
      `href="https://portal.pillar.example/dashboard/tasks/${TASK}"`
    )
    expect(email.html).not.toContain("For an empowered press.")
    expect(email.text).toContain("Your role: Layout Artist.")
  })

  it("joins two roles with a comma", async () => {
    const email = await renderEmail(
      "reminder",
      payload(["layout_artist", "writer"])
    )
    expect(email.html).toContain("Your role: Layout Artist, Writer.")
  })
})
