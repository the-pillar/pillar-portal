import type { Metadata } from "next"

import { recordCopiedTaskAction } from "@/features/members"
import {
  canCreateTask,
  getHandedBackQueue,
  getReassignOptions,
  getReviewQueue,
  getTaskFormOptions,
  HandedBackQueue,
  ReviewQueue,
  NewTaskLink,
} from "@/features/tasks"

import { requireAdmin } from "../../require-admin"

export const metadata: Metadata = {
  title: "Tasks",
}

const HEADING_ID = "admin-tasks-heading"

// Tasks (spec-1-5-admin-task-creation.md, spec-3-6, spec-3-8): the viewer's
// Needs reassignment queue, then their review queue, then a New task button
// that opens the layout's sheet (Story 8.8). The admin check comes first, as in the layout,
// which doesn't stop this page rendering; the commands themselves are the
// actual authority (AD-4). Both queues and the form options are read
// together, with no Suspense boundary, so a queue never streams in above
// the button, and no Realtime, so a refresh can't
// pull a row and its open dialog away mid-note. The reassign picker's
// members are built only when there is a slot to reassign, from the form
// options already read, adding just the load counts. The h1 is the focus
// target when a reviewed or reassigned row leaves the page.
export default async function AdminTasksPage() {
  await requireAdmin()
  const [handedBack, reviewQueue, options, canCreate] = await Promise.all([
    getHandedBackQueue(),
    getReviewQueue(),
    getTaskFormOptions(),
    canCreateTask(),
  ])
  const reassignOptions =
    handedBack.length > 0 ? await getReassignOptions(options) : null

  return (
    <>
      <h1
        id={HEADING_ID}
        tabIndex={-1}
        className="rounded-sm font-heading text-display text-navy outline-offset-2 focus-visible:outline-2"
      >
        Tasks
      </h1>
      <HandedBackQueue
        slots={handedBack}
        options={reassignOptions}
        focusTargetId={HEADING_ID}
        onCopied={recordCopiedTaskAction}
      />
      <ReviewQueue tasks={reviewQueue} focusTargetId={HEADING_ID} />
      {canCreate && (
        <NewTaskLink
          label="New task"
          className="mt-8 inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
      )}
    </>
  )
}
