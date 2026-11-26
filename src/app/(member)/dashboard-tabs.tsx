"use client"

import { CalendarDays, Inbox, SquareKanban } from "lucide-react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"

import { HEADER_FOCUS } from "@/components/app-header"
import { cn } from "@/lib/utils"

import { parseDashboardView, type DashboardView } from "./dashboard-views"

// What's mine · Board · Planner. Imports nothing from @/features, so the
// header stays light.
const TABS: {
  label: string
  href: string
  view: DashboardView
  icon: typeof Inbox
}[] = [
  { label: "What's mine", href: "/dashboard", view: "whats-mine", icon: Inbox },
  {
    label: "Board",
    href: "/dashboard?view=board",
    view: "board",
    icon: SquareKanban,
  },
  {
    label: "Planner",
    href: "/dashboard?view=planner",
    view: "planner",
    icon: CalendarDays,
  },
]

/**
 * The member's view tabs (EXPERIENCE.md › Navigation; DESIGN.md › View tabs
 * and › Bottom tab bar), a `nav` named "Views" in either of two places:
 *
 * - `header`, from `md`: in the header's row, idle tabs in
 *   `tab-idle-on-navy`, the current one a white pill with navy text.
 * - `bar`, below `md`: the bottom tab bar, three equal tabs, each an icon
 *   over a label that may wrap to two lines. The current tab's icon is white
 *   on a 56×32 navy pill and its label navy and bold. It is fixed with the
 *   home-indicator inset, and flows at the end of the page below 480px of
 *   viewport height.
 *
 * Each places itself with CSS, so the server renders both and the layout is
 * right before any script. A client component only for `usePathname` and
 * `useSearchParams`. The current tab is the one whose view `/dashboard` is
 * showing, read as the page reads it (a repeated `view` is What's mine); on a
 * task's page no tab is current.
 */
export function DashboardTabs({ variant }: { variant: "header" | "bar" }) {
  const pathname = usePathname()
  const views = useSearchParams().getAll("view")
  const view = parseDashboardView(views.length === 1 ? views[0] : views)
  const isBar = variant === "bar"

  return (
    <nav
      aria-label="Views"
      data-bottom-tab-bar={isBar ? "" : undefined}
      className={
        isBar
          ? "z-30 grid grid-cols-3 border-t border-border bg-white pb-[env(safe-area-inset-bottom)] md:hidden tabbar-fixed:fixed tabbar-fixed:inset-x-0 tabbar-fixed:bottom-0"
          : "flex gap-1"
      }
    >
      {TABS.map((tab) => {
        const current = pathname === "/dashboard" && view === tab.view
        return (
          <Link
            key={tab.view}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            className={
              isBar
                ? cn(
                    "flex h-18 flex-col items-center justify-center gap-0.5 px-1 py-1 text-center text-xs leading-tight text-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                    current && "font-bold text-navy"
                  )
                : cn(
                    "flex min-h-11 items-center justify-center rounded-md px-3 text-sm font-semibold whitespace-nowrap text-tab-idle-on-navy hover:text-white",
                    current && "bg-white text-navy hover:text-navy",
                    HEADER_FOCUS
                  )
            }
          >
            {isBar ? (
              <>
                <span
                  className={cn(
                    "flex h-8 w-14 items-center justify-center rounded-full",
                    current && "bg-navy text-white"
                  )}
                >
                  <tab.icon aria-hidden className="size-5" />
                </span>
                {tab.label}
              </>
            ) : (
              tab.label
            )}
          </Link>
        )
      })}
    </nav>
  )
}
