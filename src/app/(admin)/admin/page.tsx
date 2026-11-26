import { Suspense } from "react"
import type { Metadata } from "next"
import { after } from "next/server"

import { getEmailQuotaStatus, QuotaMeter } from "@/features/email"
import {
  countPendingApprovalsForViewer,
  getMyOnboarding,
  OnboardingChecklist,
  OnboardingTour,
  recordOnboardingAction,
} from "@/features/members"
import {
  canCreateTask,
  hasCreatedTaskForViewer,
  NewTaskTrigger,
} from "@/features/tasks"
import { recordErrorEvent } from "@/lib/record-error-event"

import { requireAdmin } from "../require-admin"
import { AdminHomeCards, type AdminHomeCard } from "./admin-home"
import { ADMIN_HOME_COUNTS, type AdminHomeCount } from "./admin-home-counts"
import { AdminHomeSkeleton } from "./admin-home-skeleton"

export const metadata: Metadata = {
  title: "Admin home",
}

const HEADING_ID = "admin-home-heading"

// Admin home (Story 2.3): what needs an admin right now, one card per count.
// The admin check comes first, before the Suspense boundary: a redirect
// thrown inside a streamed boundary would arrive as a client-side meta
// refresh, and no count is read for anyone it turns away. The layout's own
// check doesn't stop this page rendering. The h1 is the focus target when
// the onboarding tour ends (Story 8.9). `?tour=again` replays the tour.
export default async function AdminHomePage({
  searchParams,
}: PageProps<"/admin">) {
  await requireAdmin()
  const { tour } = await searchParams

  return (
    <>
      <h1
        id={HEADING_ID}
        tabIndex={-1}
        className="rounded-sm font-heading text-display text-navy outline-offset-2 focus-visible:outline-2"
      >
        Admin home
      </h1>
      <Suspense fallback={<AdminHomeSkeleton />}>
        <AdminHomeBody tourAgain={tour === "again"} />
      </Suspense>
    </>
  )
}

// Reads every link card's count and every list card's rows in parallel on
// each request (no cache), inside the boundary so the skeleton shows while
// they load, along with what the onboarding surfaces need. A throwing count
// or list read reaches (admin)/error.tsx, which replaces the page inside the
// admin shell. `my_onboarding` alone decides who gets the tour and checklist
// (its read failing shows neither); a failed created-task read is recorded
// and leaves that item to do. A failed quota read is recorded and leaves the
// Email section out.
async function AdminHomeBody({ tourAgain }: { tourAgain: boolean }) {
  const [cards, onboarding, createdTask, pending, canCreate, quota] =
    await Promise.all([
      Promise.all(ADMIN_HOME_COUNTS.map(readCard)),
      getMyOnboarding(),
      hasCreatedTaskForViewer().catch((error: unknown) => {
        after(() => recordErrorEvent(error, { route: "render (admin)/admin" }))
        return false
      }),
      countPendingApprovalsForViewer(),
      canCreateTask(),
      getEmailQuotaStatus().catch((error: unknown) => {
        after(() => recordErrorEvent(error, { route: "render (admin)/admin" }))
        return null
      }),
    ])

  const onboard = onboarding?.tourAndChecklist ? onboarding : null

  // One grid: "Needs you" and, from lg, the checklist beside it, then the
  // Email section across both. The tour is a portal, so it takes no cell.
  return (
    <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
      <AdminHomeCards cards={cards} />
      {onboard && !onboard.checklistDone && (
        <OnboardingChecklist
          className="max-w-xl lg:mt-11"
          items={{
            twoFactor: onboard.twoFactor,
            createdTask,
            copiedTask: onboard.copiedTask,
            approvedMember: onboard.approvedMember || pending === 0,
          }}
          pending={pending}
          createTask={canCreate ? <NewTaskTrigger /> : null}
          record={recordOnboardingAction}
          fallbackHeadingId={HEADING_ID}
        />
      )}
      {onboard && (tourAgain || !onboard.tourSeen) && (
        <OnboardingTour
          // A new key remounts the tour for ?tour=again, even when the first
          // showing ended on this same page and the component stayed mounted.
          key={tourAgain ? "again" : "first"}
          replay={onboard.tourSeen}
          record={recordOnboardingAction}
          returnFocusId={HEADING_ID}
        />
      )}
      {quota && (
        <section aria-labelledby="email-heading" className="lg:col-span-2">
          <h2
            id="email-heading"
            className="font-heading text-heading-sm text-navy"
          >
            Email
          </h2>
          <QuotaMeter status={quota} now={new Date()} className="mt-3" />
        </section>
      )}
    </div>
  )
}

// A link card's count, or a list card's rows, counted, as its preview.
async function readCard(source: AdminHomeCount): Promise<AdminHomeCard> {
  if ("rows" in source) {
    const { rows, linkLabel, ...card } = source
    const read = await rows()
    return { ...card, count: read.length, preview: { rows: read, linkLabel } }
  }
  const { count, ...card } = source
  return { ...card, count: await count() }
}
