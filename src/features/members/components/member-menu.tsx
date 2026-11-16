"use client"

import Link from "next/link"

import { HEADER_FOCUS } from "@/components/app-header"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { MenuSheet, MenuSheetItem } from "@/components/ui/menu-sheet"
import { cn } from "@/lib/utils"

import { showTipsAgainAction, signOutAction } from "../actions"
import { initialsOf } from "../initials"

export type MemberMenuExtraLink = { label: string; href: string }

/**
 * The avatar menu in the app header (UX-DR10): the member's name, any
 * `extraLinks` (such as "Admin" for an editorial_admin, or "My dashboard" in
 * the admin shell — the caller decides, this component stays presentation
 * only), then Sign out. It opens as a bottom sheet on phones and touch-first
 * screens and as a dropdown elsewhere (`MenuSheet`). The trigger is a 44px
 * target around a 32px avatar, named for screen readers as "<name>, account".
 *
 * `onboarding` (Story 8.9) adds, after the extra links and before Sign out,
 * **Show the tour again** (`"tour"`: a link that replays the Admin home tour)
 * or **Show tips again** (`"tips"`: a button that resets the staff card). The
 * caller passes it from `my_onboarding()`, never from a role.
 */
export function MemberMenu({
  name,
  extraLinks = [],
  onboarding,
}: {
  name: string
  extraLinks?: MemberMenuExtraLink[]
  onboarding?: "tour" | "tips"
}) {
  return (
    <MenuSheet
      title={name}
      trigger={
        <button
          type="button"
          aria-label={`${name}, account`}
          data-tour="my-dashboard"
          className={cn(
            "inline-flex size-11 shrink-0 items-center justify-center rounded-full",
            HEADER_FOCUS
          )}
        >
          <Avatar aria-hidden className="size-8 after:border-transparent">
            <AvatarFallback className="bg-white text-xs font-semibold text-navy">
              {initialsOf(name)}
            </AvatarFallback>
          </Avatar>
        </button>
      }
    >
      {extraLinks.map((link) => (
        <MenuSheetItem key={link.href} asChild>
          <Link href={link.href}>{link.label}</Link>
        </MenuSheetItem>
      ))}
      {onboarding === "tour" && (
        <MenuSheetItem asChild>
          <Link href="/admin?tour=again">Show the tour again</Link>
        </MenuSheetItem>
      )}
      {onboarding === "tips" && (
        <MenuSheetItem asChild>
          <button type="button" onClick={() => void showTipsAgainAction()}>
            Show tips again
          </button>
        </MenuSheetItem>
      )}
      <form action={signOutAction}>
        {/* Keep the menu open on select: closing it would unmount this
            form before the browser submits it. The redirect to /login
            replaces the page. */}
        <MenuSheetItem asChild keepOpen>
          <button type="submit">Sign out</button>
        </MenuSheetItem>
      </form>
    </MenuSheet>
  )
}
