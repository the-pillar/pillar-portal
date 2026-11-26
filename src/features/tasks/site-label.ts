// The name a link shows (EXPERIENCE.md › Link row), from the host and path.
// Pure and total: it never throws, and an address that doesn't parse comes
// back as typed. Nothing is fetched from the linked page.

const HOST_LABELS: Record<string, string> = {
  "drive.google.com": "Google Drive",
  "forms.gle": "Google Forms",
  "canva.com": "Canva",
  "canva.link": "Canva",
  "facebook.com": "Facebook",
  "m.facebook.com": "Facebook",
  "fb.com": "Facebook",
  "fb.watch": "Facebook",
  "youtube.com": "YouTube",
  "youtu.be": "YouTube",
  "instagram.com": "Instagram",
  "tiktok.com": "TikTok",
  "vm.tiktok.com": "TikTok",
  "m.me": "Messenger",
  "messenger.com": "Messenger",
  "t.me": "Telegram",
  "telegram.me": "Telegram",
}

const GOOGLE_DOCS_PATHS: [string, string][] = [
  ["/document", "Google Docs"],
  ["/spreadsheets", "Google Sheets"],
  ["/presentation", "Google Slides"],
  ["/forms", "Google Forms"],
]

export function siteLabel(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return url
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "")
  if (host === "") return url
  if (host === "docs.google.com") {
    const match = GOOGLE_DOCS_PATHS.find(
      ([prefix]) =>
        parsed.pathname === prefix || parsed.pathname.startsWith(`${prefix}/`)
    )
    if (match) return match[1]
  }
  return HOST_LABELS[host] ?? host
}
