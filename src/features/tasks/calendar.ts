import { siteLabel } from "./site-label"

/** The event's length: a deadline marker, not a block of work. */
export const EVENT_MINUTES = 15

/** The whole Google Calendar URL stays within this many characters. */
export const GOOGLE_URL_MAX = 4000

export type CalendarTask = {
  id: string
  title: string
  description: string | null
  dueAt: string
  referenceUrls: string[]
}

export type CalendarEvent = {
  uid: string
  title: string
  start: Date
  end: Date
  /** Every part, in order: the file carries all of it. */
  details: string
  /**
   * The parts `details` is joined from, so the Google URL can cut the
   * description and drop links to fit (see `googleCalendarUrl`).
   */
  parts: {
    description: string | null
    /** One "• <site>: <url>" per reference link. */
    linkLines: string[]
    /** "Task: <link>", never cut. */
    taskLine: string
  }
}

function joinDetails(
  description: string | null,
  linkLines: string[],
  taskLine: string
): string {
  return [
    ...(description ? [description] : []),
    ...(linkLines.length > 0 ? [linkLines.join("\n")] : []),
    taskLine,
  ].join("\n\n")
}

/**
 * The one event both the file and the Google URL are built from. `siteUrl`
 * is `NEXT_PUBLIC_SITE_URL`, passed in so this module stays client-safe and
 * never reads a request's Host.
 */
export function buildCalendarEvent(
  task: CalendarTask,
  siteUrl: string
): CalendarEvent {
  const start = new Date(task.dueAt)
  const end = new Date(start.getTime() + EVENT_MINUTES * 60_000)
  const link = new URL(`/dashboard/tasks/${task.id}`, siteUrl).href
  const parts = {
    description: task.description,
    linkLines: task.referenceUrls.map((url) => `• ${siteLabel(url)}: ${url}`),
    taskLine: `Task: ${link}`,
  }

  return {
    uid: `task-${task.id}@pillar-portal`,
    title: `Due: ${task.title}`,
    start,
    end,
    details: joinDetails(parts.description, parts.linkLines, parts.taskLine),
    parts,
  }
}

/** `YYYYMMDDTHHmmssZ`, in UTC. */
function googleDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
}

function googleUrlFor(event: CalendarEvent, details: string): string {
  const params = [
    ["action", "TEMPLATE"],
    ["text", event.title],
    ["dates", `${googleDate(event.start)}/${googleDate(event.end)}`],
    ["details", details],
  ]
  // Hand-joined: URLSearchParams would write spaces as "+", and the dates'
  // slash must stay literal.
  const query = params
    .map(([key, value]) =>
      key === "dates"
        ? `${key}=${value}`
        : `${key}=${encodeURIComponent(value)}`
    )
    .join("&")
  return `https://calendar.google.com/calendar/render?${query}`
}

/**
 * Google's prefilled link, the whole URL within `GOOGLE_URL_MAX` characters.
 * Whatever doesn't fit is cut in this order: the description first, on a code
 * point boundary with "…" (never a split surrogate pair), and only when even
 * none of it would let every link fit, links dropped whole from the last. The
 * task's link is always kept.
 */
export function googleCalendarUrl(event: CalendarEvent): string {
  const { description, linkLines, taskLine } = event.parts
  const fits = (url: string) => url.length <= GOOGLE_URL_MAX
  const build = (text: string | null, lines: string[]) =>
    googleUrlFor(event, joinDetails(text, lines, taskLine))

  const whole = build(description, linkLines)
  if (fits(whole)) return whole

  for (let count = linkLines.length; count >= 0; count -= 1) {
    const lines = linkLines.slice(0, count)
    if (!fits(build(null, lines))) continue
    const uncut = build(description, lines)
    if (fits(uncut)) return uncut

    const points = description ? Array.from(description) : []
    const cut = (length: number) => `${points.slice(0, length).join("")}…`
    // The longest description that still fits, by bisection: a longer one is
    // never shorter once encoded.
    let low = 0
    let high = points.length - 1
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (fits(build(cut(mid), lines))) low = mid
      else high = mid - 1
    }
    return low > 0 && fits(build(cut(low), lines))
      ? build(cut(low), lines)
      : build(null, lines)
  }
  return build(null, [])
}

/** The one route: the file, or with "google" a redirect to Google. */
export function calendarRoutePath(id: string, to?: "google"): string {
  const base = `/api/tasks/${id}/ics`
  return to === "google" ? `${base}?to=google` : base
}
