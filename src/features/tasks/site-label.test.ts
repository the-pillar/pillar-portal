import { describe, expect, it } from "vitest"

import { siteLabel } from "./site-label"

describe("siteLabel", () => {
  it.each([
    ["https://drive.google.com/drive/folders/1", "Google Drive"],
    ["https://docs.google.com/document/d/1/edit", "Google Docs"],
    ["https://docs.google.com/spreadsheets/d/1", "Google Sheets"],
    ["https://docs.google.com/presentation/d/1", "Google Slides"],
    ["https://docs.google.com/forms/d/1", "Google Forms"],
    ["https://forms.gle/abc", "Google Forms"],
    ["https://www.canva.com/design/DAF/edit", "Canva"],
    ["https://canva.link/x", "Canva"],
    ["https://facebook.com/x", "Facebook"],
    ["https://m.facebook.com/x", "Facebook"],
    ["https://fb.com/x", "Facebook"],
    ["https://fb.watch/x", "Facebook"],
    ["https://www.youtube.com/watch?v=1", "YouTube"],
    ["https://youtu.be/1", "YouTube"],
    ["https://instagram.com/p/1", "Instagram"],
    ["https://tiktok.com/@a", "TikTok"],
    ["https://vm.tiktok.com/a", "TikTok"],
    ["https://m.me/a", "Messenger"],
    ["https://messenger.com/t/a", "Messenger"],
    ["https://t.me/a", "Telegram"],
    ["https://telegram.me/a", "Telegram"],
  ])("%s is %s", (url, label) => {
    expect(siteLabel(url)).toBe(label)
  })

  it("matches a path on a segment, not a prefix", () => {
    expect(siteLabel("https://docs.google.com/documents-x")).toBe(
      "docs.google.com"
    )
    expect(siteLabel("https://docs.google.com/")).toBe("docs.google.com")
  })

  it("shows any other host without www.", () => {
    expect(siteLabel("https://www.Example.org/a")).toBe("example.org")
  })

  it("gives the text back when it doesn't parse", () => {
    expect(siteLabel("hello")).toBe("hello")
    expect(siteLabel("")).toBe("")
    expect(siteLabel("mailto:a@b.com")).toBe("mailto:a@b.com")
  })
})
