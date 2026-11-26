import type { ReactNode } from "react"
import { ExternalLink as ExternalLinkIcon } from "lucide-react"

import { ExternalLink } from "@/components/ui/external-link"
import { cn } from "@/lib/utils"

import { siteLabel } from "../site-label"

// How much of the address's end stays visible when the line is cut.
const TAIL_CHARACTERS = 16

/**
 * A link on Task detail (EXPERIENCE.md › Link row; DESIGN.md › Link row): the
 * site's name is the link and its stretched hit area is the whole row; the
 * address sits under it, outside the link. The address is in the page text
 * once, whole, and shows on one line cut in the middle by styling alone: the
 * head truncates, the tail never shrinks. Nothing is fetched from the page.
 *
 * `addedBy` is the "added by <name>" text that follows the site name, and
 * `action` the control at the row's right (a deliverable link's remove
 * button). The action sits above the stretched hit area, so it stays its own
 * target.
 */
export function LinkRow({
  url,
  className,
  addedBy,
  action,
}: {
  url: string
  className?: string
  addedBy?: string
  action?: ReactNode
}) {
  const points = Array.from(url)
  const head = points.slice(0, -TAIL_CHARACTERS).join("")
  const tail = points.slice(-TAIL_CHARACTERS).join("")

  return (
    <div
      className={cn(
        "relative flex min-h-11 min-w-0 items-start gap-1.5 py-1",
        className
      )}
    >
      <div className="flex min-h-9 min-w-0 flex-1 flex-col justify-center">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <ExternalLink
            href={url}
            className="w-fit max-w-full font-semibold text-navy no-underline after:absolute after:inset-0 hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span className="inline-flex items-center gap-1.5">
              {siteLabel(url)}
              <ExternalLinkIcon
                aria-hidden="true"
                className="size-3.5 shrink-0"
              />
            </span>
          </ExternalLink>
          {addedBy !== undefined && (
            <span className="text-sm text-muted-foreground">
              added by {addedBy}
            </span>
          )}
        </div>
        <p className="flex min-w-0 text-[13px] text-muted-foreground">
          <span className="min-w-0 truncate">{head}</span>
          <span className="shrink-0">{tail}</span>
        </p>
      </div>
      {action !== undefined && (
        <div className="relative z-10 -my-1 -mr-1.5 shrink-0">{action}</div>
      )}
    </div>
  )
}
