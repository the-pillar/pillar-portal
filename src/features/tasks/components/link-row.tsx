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
 */
export function LinkRow({
  url,
  className,
}: {
  url: string
  className?: string
}) {
  const points = Array.from(url)
  const head = points.slice(0, -TAIL_CHARACTERS).join("")
  const tail = points.slice(-TAIL_CHARACTERS).join("")

  return (
    <div
      className={cn(
        "relative flex min-h-11 min-w-0 flex-col justify-center py-1",
        className
      )}
    >
      <ExternalLink
        href={url}
        className="w-fit max-w-full font-semibold text-navy no-underline after:absolute after:inset-0 hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="inline-flex items-center gap-1.5">
          {siteLabel(url)}
          <ExternalLinkIcon aria-hidden="true" className="size-3.5 shrink-0" />
        </span>
      </ExternalLink>
      <p className="flex min-w-0 text-[13px] text-muted-foreground">
        <span className="min-w-0 truncate">{head}</span>
        <span className="shrink-0">{tail}</span>
      </p>
    </div>
  )
}
