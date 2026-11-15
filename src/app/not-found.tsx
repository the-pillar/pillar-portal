import { FileQuestionMark } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { after } from "next/server"

import { AppHeader } from "@/components/app-header"
import { getCurrentMember } from "@/features/members"
import { recordErrorEvent } from "@/lib/record-error-event"

export const metadata: Metadata = { title: "Page not found" }

type Way = { href: string; label: string }

// Where "home" is for the visitor (EXPERIENCE.md › State Patterns › Not
// found): What's mine for an active member, Admin home for an active admin,
// sign-in for anyone else. A failed lookup shows the sign-in link rather than
// turning a wrong URL into a 500.
async function wayHome(): Promise<Way> {
  try {
    const member = await getCurrentMember()
    if (member?.state === "active") {
      return member.role === "editorial_admin"
        ? { href: "/admin", label: "Go to Admin home" }
        : { href: "/dashboard", label: "Go to What's mine" }
    }
  } catch (error) {
    after(() => recordErrorEvent(error, { route: "render not-found" }))
  }
  return { href: "/login", label: "Sign in" }
}

/**
 * The portal's own Not found page for any unknown URL: the app header, then
 * an empty state whose line is the h1 and whose one action leads home. Next
 * answers HTTP 404. No bar of tabs: the visitor may not be signed in.
 */
export default async function NotFound() {
  const way = await wayHome()

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-160 flex-col items-center gap-4 px-page-margin-mobile py-16 text-center md:px-page-margin-desktop">
        <FileQuestionMark
          aria-hidden
          strokeWidth={1.5}
          className="size-11 text-input [stroke-dasharray:3_3]"
        />
        <h1 className="font-heading text-heading-sm">
          This page doesn&apos;t exist.
        </h1>
        <Link
          href={way.href}
          className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {way.label}
        </Link>
      </main>
    </>
  )
}
