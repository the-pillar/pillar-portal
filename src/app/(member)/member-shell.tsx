import { AppHeader } from "@/components/app-header"
import { type CurrentMember, MemberMenu } from "@/features/members"

import { DashboardTabs } from "./dashboard-tabs"

/**
 * The member layout's chrome: the app header with the avatar menu and, from
 * `md`, the view tabs; below `md` the tabs are the bottom tab bar after the
 * page. The page sits in a single column capped at 640px (EXPERIENCE.md ›
 * Responsive).
 *
 * The Board is the one view whose content goes wider, up to 1440px. The
 * layout can't know which view a page is, so a view that wants the width
 * renders an element with `data-wide-view`, and `<main>` widens when it
 * `:has()` one, so the cap changes with the page's own skeleton, not after it
 * loads. The header's contents stay in the 640px column on every view, so the
 * logo, tabs and avatar never move when switching tabs.
 *
 * While the bar is fixed (below `md`, at least 480px tall) `<main>` keeps
 * the bar's height plus 8px of bottom padding, so nothing sits under it; the
 * scrollers' `scroll-padding-bottom` is globals.css's.
 */
export function MemberShell({
  member,
  newTask,
  onboarding,
  children,
}: {
  member: Pick<CurrentMember, "name" | "role">
  /** The New task button, passed only for a caller who can create tasks. */
  newTask?: React.ReactNode
  /** Which onboarding item the avatar menu offers (`my_onboarding()`'s answer). */
  onboarding?: "tour" | "tips"
  children: React.ReactNode
}) {
  return (
    <>
      <AppHeader
        homeHref="/dashboard"
        tabs={<DashboardTabs variant="header" />}
        action={newTask}
        hasBottomBar
      >
        <MemberMenu
          name={member.name}
          onboarding={onboarding}
          extraLinks={
            member.role === "editorial_admin"
              ? [{ label: "Admin", href: "/admin" }]
              : []
          }
        />
      </AppHeader>
      <main className="mx-auto w-full max-w-160 px-page-margin-mobile py-8 has-[[data-wide-view]]:max-w-[1440px] md:px-page-margin-desktop tabbar-fixed:pb-(--bottom-tab-bar-clear)">
        {children}
      </main>
      <DashboardTabs variant="bar" />
    </>
  )
}
