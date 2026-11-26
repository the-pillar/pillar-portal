import { render } from "react-email"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://portal.pillar.example" },
}))

import { EmailShell, EmailText, siteUrl } from "./shell"
import { emailTokens } from "./tokens"

const SITE = "https://portal.pillar.example"

function staffEmail() {
  return (
    <EmailShell
      preview="Two tasks are due tomorrow"
      heading="Two tasks are due tomorrow"
      cta={{ label: "Open the board", path: "/board" }}
      audience="staff"
    >
      <EmailText>Your Feature story is due at 5:00 PM.</EmailText>
    </EmailShell>
  )
}

describe("EmailShell", () => {
  it("links only to absolute URLs on the site, and loads nothing else", async () => {
    const html = await render(staffEmail())
    const urls = [...html.matchAll(/(?:href|src)="([^"]*)"/g)].map((m) => m[1])

    expect(urls).toContain(`${SITE}/email-logo.png`)
    expect(urls).toContain(`${SITE}/board`)
    for (const url of urls) {
      expect(url.startsWith(`${SITE}/`), url).toBe(true)
    }
  })

  it("uses no web font: no @font-face and no font link", async () => {
    const html = await render(staffEmail())

    expect(html).not.toMatch(/@font-face/i)
    expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/i)
    expect(html).not.toMatch(/<link[^>]+stylesheet/i)
    expect(html).toContain("Georgia")
  })

  it("draws the navy header with the logo, the 3px gold rule and the navy button", async () => {
    const html = await render(staffEmail())

    expect(html).toContain(emailTokens.navy)
    expect(html).toContain(`3px solid ${emailTokens.brandGold}`)
    expect(html).toContain(`background-color:${emailTokens.canvas}`)
    expect(html).toMatch(/width="96"/)
    expect(html).toMatch(
      new RegExp(`background-color:${emailTokens.primary}[^"]*"`)
    )
  })

  it("has no sign-off in the staff email", async () => {
    const html = await render(staffEmail())
    const text = await render(staffEmail(), { plainText: true })

    expect(html).not.toContain("For an empowered press.")
    expect(text).not.toContain("empowered press")
    expect(text).toContain("Your Feature story is due at 5:00 PM.")
  })

  it('ends the applicant email with "For an empowered press."', async () => {
    const text = await render(
      <EmailShell preview="p" heading="Thank you" audience="applicant">
        <EmailText>We got your application.</EmailText>
      </EmailShell>,
      { plainText: true }
    )

    expect(text.trim()).toMatch(/For an empowered press\.[\s\S]{0,200}$/)
    expect(text.indexOf("For an empowered press.")).toBeGreaterThan(
      text.indexOf("We got your application.")
    )
  })

  it.each([
    "//evil.example/x",
    "https://evil.example",
    "board",
    "/a\\b",
    "/\t/evil.example/x",
    "/\n/evil.example/x",
  ])("refuses the button path %j", (path) => {
    expect(() => siteUrl(path)).toThrow("email.invalid_path")
  })
})
