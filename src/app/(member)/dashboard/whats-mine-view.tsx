import {
  FirstRunCard,
  getMyOnboarding,
  recordOnboardingAction,
} from "@/features/members"
import { EmptyState } from "@/components/empty-state"
import { getWhatsMine, WhatsMineTasks } from "@/features/tasks"

const HEADING_ID = "whats-mine-heading"

// What's mine (EXPERIENCE.md). Reads as the viewer on every request. The h1
// is the focus target when an answered Waiting item leaves the page.
// dashboard/page.tsx renders it under its own Suspense boundary. The staff
// first-run card (Story 8.9) shows above the lists while `my_onboarding()`
// says this member gets it (not the tour and checklist) and hasn't closed it;
// a failed onboarding read shows no card.
export async function WhatsMineView() {
  const [whatsMine, onboarding] = await Promise.all([
    getWhatsMine(),
    getMyOnboarding(),
  ])
  const showFirstRun =
    onboarding !== null &&
    !onboarding.tourAndChecklist &&
    !onboarding.firstRunClosed
  const empty = whatsMine.waiting.length === 0 && whatsMine.tasks.length === 0

  return (
    <>
      <h1
        id={HEADING_ID}
        tabIndex={-1}
        className="rounded-sm font-heading text-display text-navy outline-offset-2 focus-visible:outline-2"
      >
        What&apos;s mine
      </h1>
      {showFirstRun && (
        <FirstRunCard
          shown={onboarding.firstRunShown}
          record={recordOnboardingAction}
          fallbackHeadingId={HEADING_ID}
        />
      )}
      {empty ? (
        <EmptyState title="Nothing on your plate right now." className="mt-6">
          <p className="text-muted-foreground">
            New assignments will show up here — your editor or head will also
            message you.
          </p>
        </EmptyState>
      ) : (
        <WhatsMineTasks whatsMine={whatsMine} focusTargetId={HEADING_ID} />
      )}
    </>
  )
}
