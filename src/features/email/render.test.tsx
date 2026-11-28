import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://portal.pillar.example" },
}))

import { EmailRenderError, renderEmail } from "./render"
import { EmailShell } from "./shell"
import { templates } from "./templates"

describe("renderEmail", () => {
  it("registers the reminder template", () => {
    expect(Object.keys(templates)).toEqual(["reminder"])
  })

  it("maps an unknown template to email.unknown_template", async () => {
    await expect(renderEmail("nope", {})).rejects.toMatchObject({
      name: "EmailRenderError",
      code: "email.unknown_template",
    })
    await expect(renderEmail("toString", {})).rejects.toBeInstanceOf(
      EmailRenderError
    )
  })

  it("renders a registered template to a subject, html and text", async () => {
    const registry = {
      sample: {
        subject: (p: Record<string, unknown>) => `Hello ${String(p.name)}`,
        element: (p: Record<string, unknown>) => (
          <EmailShell preview="p" heading="Hi" audience="staff">
            {String(p.name)}
          </EmailShell>
        ),
      },
    }
    const rendered = await renderEmail("sample", { name: "Ana" }, registry)

    expect(rendered.subject).toBe("Hello Ana")
    expect(rendered.html).toContain("Ana")
    expect(rendered.text).toContain("Ana")
  })

  it("turns a template's own throw into email.render_failed, without its message", async () => {
    const registry = {
      broken: {
        subject: () => "x",
        element: () => {
          throw new Error("secret detail a@b.com")
        },
      },
    }
    const error = await renderEmail("broken", {}, registry).catch(
      (thrown: unknown) => thrown
    )

    expect(error).toMatchObject({ code: "email.render_failed" })
    expect((error as Error).message).not.toContain("a@b.com")
  })
})
