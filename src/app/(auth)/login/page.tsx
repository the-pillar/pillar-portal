import type { Metadata } from "next"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

import Image from "next/image"

import { AppHeader } from "@/components/app-header"
import {
  ACCOUNT_STATE_COPY,
  AccountStateNotice,
  detectInAppBrowser,
  getCurrentMember,
  GoogleSignIn,
  InAppBrowserNotice,
  LOGIN_ERROR_SIGN_IN,
  LOGIN_SIGNED_OUT_IDLE,
  loginPath,
  memberErrorMessage,
  PersonaSignIn,
  safeReturnPath,
  SharedComputerProvider,
} from "@/features/members"
import { clientEnv } from "@/lib/env.client"
import { personasEnabled } from "@/lib/env.server"
import { checkIdle } from "@/lib/supabase/idle"
import { createClient } from "@/lib/supabase/server"

// The title names what the page shows (WCAG 2.4.2): a member who isn't
// active sees their state's title, everyone else "Sign in" (an active member
// is sent on before this matters). getCurrentMember is cached per request,
// so this and the page share one query.
export async function generateMetadata(): Promise<Metadata> {
  const member = await getCurrentMember()
  const title =
    member && member.state !== "active"
      ? ACCOUNT_STATE_COPY[member.state].title
      : "Sign in"
  return { title }
}

// Sign-in and account states (UX-DR52, AD-7).
//
// `next` is where the visitor was going; src/proxy.ts sets it when it sends a
// signed-out visitor here, and every use goes through safeReturnPath. The
// caller's own members row decides what renders:
// - an active member goes straight to `next` (or /dashboard), so there's no
//   redirect loop with the member and admin pages' state check;
// - a pending, declined or deactivated member sees their state and Sign out,
//   which keeps `next` for the account they switch to;
// - anyone else gets Sign in with Google, or, inside Messenger's or
//   Facebook's in-app browser (from the user agent), the hand-off to the
//   phone's browser, since Google refuses sign-in there. `error=sign-in`
//   (from a sign-in that didn't finish) adds the "didn't finish" line, and
//   `signed_out=idle` (or a shared session found idle here) the idle line.
// Persona buttons render below whenever PROTOTYPE_PERSONAS is on.
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error, signed_out } = await searchParams
  const returnPath = safeReturnPath(next)

  // A signed-in visitor whose shared session has idled out is signed out: this
  // page can't write cookies, so it just renders as signed out (the next
  // sign-in overwrites them) with the idle line.
  let member = await getCurrentMember()
  let idleOut = signed_out === LOGIN_SIGNED_OUT_IDLE
  if (member) {
    try {
      if ((await checkIdle(await createClient())).kind === "expired") {
        member = null
        idleOut = true
      }
    } catch {
      // The proxy and the authenticated Route Handlers enforce the limit; render as usual.
    }
  }
  if (member?.state === "active") redirect(returnPath)

  let content: React.ReactNode
  if (member) {
    content = <AccountStateNotice state={member.state} next={returnPath} />
  } else {
    const inApp = detectInAppBrowser((await headers()).get("user-agent"))
    content = (
      <>
        <h1 className="font-heading text-heading text-navy">Sign in</h1>
        {inApp ? (
          <InAppBrowserNotice
            browser={inApp}
            loginUrl={
              new URL(
                loginPath({ next: returnPath }),
                clientEnv.NEXT_PUBLIC_SITE_URL
              ).href
            }
          />
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {idleOut && (
              <p role="status" className="text-sm text-muted-foreground">
                You were signed out after 30 minutes on a shared computer.
              </p>
            )}
            {error === LOGIN_ERROR_SIGN_IN && (
              <p role="alert" className="text-sm text-status-attention-text">
                {memberErrorMessage("auth.sign_in_failed")}
              </p>
            )}
            <GoogleSignIn next={returnPath} />
          </div>
        )}
      </>
    )
  }

  return (
    <SharedComputerProvider>
      <AppHeader />
      <main className="mx-auto flex min-h-[calc(100svh-var(--app-header-height))] w-full max-w-md flex-col justify-center gap-4 px-page-margin-mobile py-8 pb-16 md:px-page-margin-desktop">
        <div className="flex flex-col items-center gap-2 text-center">
          <Image
            src="/thepillar-logo.png"
            alt=""
            width={56}
            height={56}
            priority
            className="rounded-full ring-2 ring-navy"
          />
          <p className="font-heading text-2xl font-bold text-navy">
            The Pillar Portal
          </p>
          <p className="text-sm text-muted-foreground">
            Critical. Fearless. Unapologetic.
          </p>
        </div>
        <div className="rounded-lg bg-card p-card-padding shadow-card">
          {content}
          {personasEnabled && (
            <div className="mt-8 border-t border-border pt-6">
              <p className="mb-4 text-muted-foreground">
                Prototype: choose who to sign in as.
              </p>
              <PersonaSignIn next={returnPath} />
            </div>
          )}
        </div>
      </main>
    </SharedComputerProvider>
  )
}
