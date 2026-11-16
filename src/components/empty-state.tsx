import { cn } from "@/lib/utils"

/**
 * DESIGN.md › Empty state: centered, a 44px dashed outline glyph in `input`,
 * one line in heading-sm (the page's or section's heading, so it takes the
 * level the caller passes), one body line in `muted-foreground`, and at most
 * one action as `children`.
 */
export function EmptyState({
  title,
  headingLevel = 2,
  className,
  children,
}: {
  title: string
  headingLevel?: 1 | 2
  className?: string
  children?: React.ReactNode
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2"
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1.5 px-2 py-6 text-center",
        className
      )}
    >
      <span
        aria-hidden="true"
        className="mb-1 size-11 rounded-lg border-2 border-dashed border-input"
      />
      <Heading className="font-heading text-heading-sm">{title}</Heading>
      {children}
    </div>
  )
}
