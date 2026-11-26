import Link from "next/link"

import { StatusDot, type StatusFamily } from "@/components/status-badge"

/** One row of a list card's preview, its text already built. */
export type AdminHomeRow = {
  id: string
  text: string
  /** Shown under the row as "Reason: <reason>" when given. */
  reason: string | null
}

/** One Admin home card's data: a count already read for the viewer. */
export type AdminHomeCard = {
  id: string
  label: string
  href: string
  count: number
  /** The status family the count belongs to: its dot's color (default progress). */
  family?: StatusFamily
  /**
   * Makes it a list card: the first rows under its heading and a link with
   * this label to `href`, in place of the one link.
   */
  preview?: { rows: readonly AdminHomeRow[]; linkLabel: string }
}

/** A list card shows at most this many rows; its heading counts them all. */
export const ADMIN_HOME_PREVIEW_ROWS = 5

/**
 * Admin home's "Needs you" (Story 2.3; Corkboard restyle): only what the
 * admin can act on, so a count row shows only while its count is above 0.
 * Each row is a white card with a status dot of the family it counts, the
 * label, and the count right-aligned in serif (the count also reads as
 * "(n)" to a screen reader, never color alone); a link row is one link to
 * where the work is. A list card (Story 3.8) instead heads its first rows
 * the same way and ends in a link. Each card keeps its own height
 * (`items-start`), so a link row beside a taller list card doesn't grow into
 * a large, mostly empty link. With nothing to show, the all-clear heading.
 */
export function AdminHomeCards({ cards }: { cards: readonly AdminHomeCard[] }) {
  const actionable = cards.filter((card) => card.count > 0)

  if (actionable.length === 0) {
    return (
      <h2
        data-tour="counts"
        className="font-heading text-heading-sm text-muted-foreground"
      >
        Nothing needs you right now.
      </h2>
    )
  }

  return (
    <section aria-labelledby="needs-you-heading">
      <h2
        id="needs-you-heading"
        className="font-heading text-heading-sm text-navy"
      >
        Needs you
      </h2>
      <ul data-tour="counts" className="mt-3 grid items-start gap-2">
        {actionable.map((card) => (
          <li key={card.id} className="flex">
            {card.preview === undefined ? (
              <Link
                href={card.href}
                aria-label={`${card.label} (${card.count})`}
                className="flex min-h-11 w-full items-center gap-3 rounded-lg bg-card p-card-padding font-semibold shadow-card hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
              >
                <CardLabel card={card} />
              </Link>
            ) : (
              <AdminHomeListCard card={card} preview={card.preview} />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

// The status dot with the label, then the count right-aligned in serif. The
// link or heading carries the name "<label> (<n>)", so the count never
// relies on the figure alone.
function CardLabel({ card }: { card: AdminHomeCard }) {
  return (
    <>
      <StatusDot family={card.family ?? "progress"} label={card.label} />
      <span
        aria-hidden="true"
        className="ml-auto font-heading text-xl text-navy tabular-nums"
      >
        {card.count}
      </span>
    </>
  )
}

function AdminHomeListCard({
  card,
  preview,
}: {
  card: AdminHomeCard
  preview: NonNullable<AdminHomeCard["preview"]>
}) {
  return (
    <div className="flex w-full min-w-0 flex-col rounded-lg bg-card p-card-padding shadow-card">
      <h3
        aria-label={`${card.label} (${card.count})`}
        className="flex items-center gap-3 font-semibold"
      >
        <CardLabel card={card} />
      </h3>
      <ul className="mt-2 flex flex-col gap-2 text-sm">
        {preview.rows.slice(0, ADMIN_HOME_PREVIEW_ROWS).map((row) => (
          <li key={row.id} className="break-words">
            <p>{row.text}</p>
            {row.reason !== null && (
              <p className="text-muted-foreground">Reason: {row.reason}</p>
            )}
          </li>
        ))}
      </ul>
      <Link
        href={card.href}
        className="mt-1 inline-flex min-h-11 items-center self-start rounded-sm text-navy underline underline-offset-4 hover:no-underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
      >
        {preview.linkLabel}
      </Link>
    </div>
  )
}
