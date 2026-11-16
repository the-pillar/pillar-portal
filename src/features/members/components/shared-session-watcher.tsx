"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DEADLINE_GRACE_MS,
  SHARED_UNTIL_COOKIE,
  WARNING_LEAD_MS,
} from "@/lib/supabase/shared-session"

const POLL_MS = 5000
const ACTIVITY_MIN_GAP_MS = 60_000
// A reload that lands back here (the proxy let the request through) must not
// loop: reload only once the page has been up this long.
const MIN_PAGE_AGE_MS = 10_000
const INPUT_EVENTS = ["keydown", "pointerdown", "wheel", "touchstart"] as const

function readDeadline(): number | null {
  const entry = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${SHARED_UNTIL_COOKIE}=`))
  if (!entry) return null
  const value = Number(entry.slice(SHARED_UNTIL_COOKIE.length + 1))
  return Number.isFinite(value) ? value : null
}

/**
 * The shared-computer watcher (AD-22), mounted in the member and admin
 * layouts. A no-op unless the `pillar-shared-until` deadline cookie exists:
 * that cookie is the only state it reads, and the idle clock itself is in
 * Postgres.
 *
 * - It polls the cookie every 5 s and on focus or visibility change, so every
 *   open tab follows a renewal made in another.
 * - Trusted input (key, pointer, wheel, touch; never a script's synthetic
 *   event) posts to /api/session/activity, at most once a minute. Nothing
 *   else does: no timer, refetch or refresh renews the session.
 * - 2 minutes before the deadline it shows "Signing out soon"; Stay signed in
 *   or any trusted input renews and closes it in every tab.
 * - 2 s past the deadline it reloads, and the proxy sends the tab to /login
 *   with the idle line. A 401 from the activity post goes there directly.
 * - A shared session's page restored from the back/forward cache reloads, so
 *   Back after a sign-out never shows the last person's page.
 */
export function SharedSessionWatcher() {
  const [deadline, setDeadline] = useState<number | null>(null)
  const [warning, setWarning] = useState(false)
  const lastPost = useRef(0)
  const warningRef = useRef(false)
  const seenShared = useRef(false)

  const evaluate = useCallback(() => {
    const next = readDeadline()
    if (next !== null) seenShared.current = true
    setDeadline(next)
    if (next === null) {
      warningRef.current = false
      setWarning(false)
      return
    }
    const now = Date.now()
    if (
      now >= next + DEADLINE_GRACE_MS &&
      performance.now() >= MIN_PAGE_AGE_MS
    ) {
      window.location.reload()
      return
    }
    const show = now >= next - WARNING_LEAD_MS
    warningRef.current = show
    setWarning(show)
  }, [])

  const postActivity = useCallback(async () => {
    lastPost.current = Date.now()
    try {
      const response = await fetch("/api/session/activity", {
        method: "POST",
        credentials: "same-origin",
      })
      if (response.status === 401) {
        window.location.replace("/login?signed_out=idle")
        return
      }
    } catch {
      // Offline or a server fault: the next input tries again.
    }
    evaluate()
  }, [evaluate])

  // Poll the cookie, and follow focus and visibility.
  useEffect(() => {
    const first = window.setTimeout(evaluate, 0)
    const interval = window.setInterval(evaluate, POLL_MS)
    function onVisible() {
      if (document.visibilityState === "visible") evaluate()
    }
    window.addEventListener("focus", evaluate)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(interval)
      window.removeEventListener("focus", evaluate)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [evaluate])

  // Back after a sign-out can restore this page from the back/forward cache,
  // showing the last person's page with no session behind it. A restored page
  // that belonged to a shared session reloads, so the proxy decides.
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted && seenShared.current) window.location.reload()
    }
    window.addEventListener("pageshow", onPageShow)
    return () => window.removeEventListener("pageshow", onPageShow)
  }, [])

  // Trusted input renews, at most once a minute (at once while warning).
  useEffect(() => {
    if (deadline === null) return
    function onInput(event: Event) {
      if (!event.isTrusted) return
      const gap = Date.now() - lastPost.current
      if (gap < ACTIVITY_MIN_GAP_MS && !warningRef.current) return
      if (gap < 1000) return
      void postActivity()
    }
    for (const type of INPUT_EVENTS) {
      window.addEventListener(type, onInput, { capture: true, passive: true })
    }
    return () => {
      for (const type of INPUT_EVENTS) {
        window.removeEventListener(type, onInput, { capture: true })
      }
    }
  }, [deadline === null, postActivity]) // eslint-disable-line react-hooks/exhaustive-deps

  // Wake exactly at the next boundary, since a timer can't be trusted to be
  // read again soon enough in a busy or backgrounded tab.
  useEffect(() => {
    if (deadline === null) return
    const now = Date.now()
    const boundaries = [
      deadline - WARNING_LEAD_MS - now,
      deadline + DEADLINE_GRACE_MS - now,
    ].filter((ms) => ms > 0)
    if (boundaries.length === 0) return
    const timer = window.setTimeout(evaluate, Math.min(...boundaries) + 50)
    return () => window.clearTimeout(timer)
  }, [deadline, evaluate])

  if (deadline === null) return null

  return (
    <AlertDialog open={warning}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Signing out soon</AlertDialogTitle>
          <AlertDialogDescription>
            You&apos;ll be signed out in 2 minutes because this is a shared
            computer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault()
              void postActivity()
            }}
          >
            Stay signed in
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
