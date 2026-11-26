import type { Metadata } from "next"

import {
  recordCopiedTaskAction,
  requireActiveMember,
  safeReturnPath,
} from "@/features/members"
import {
  getReassignOptions,
  getTaskDetail,
  TaskChangesRefresher,
  TaskDetailView,
  returnLink,
  TaskNotFound,
} from "@/features/tasks"

export const metadata: Metadata = {
  title: "Task",
}

// Task detail, where a Messenger link lands (spec-1-6). The state check comes
// first. A malformed id, a missing task and one the caller can't read all
// look the same: getTaskDetail returns null for each, and RLS and the
// commands decide everything else. A read that fails throws instead, to
// (member)/error.tsx. The reassign picker's members are read only when
// task_capabilities offers Reassign.
//
// `from` is the view the member came from (What's mine, the Board, the
// Planner, admin Tasks); it goes through safeReturnPath, then a labeler that
// names only views it knows, so a missing or hostile value reads "What's
// mine".
export default async function TaskPage({
  params,
  searchParams,
}: PageProps<"/dashboard/tasks/[id]">) {
  await requireActiveMember()
  const [{ id }, { from }] = await Promise.all([params, searchParams])
  const task = await getTaskDetail(id)

  if (!task) return <TaskNotFound />

  const reassignOptions = task.canReassign
    ? await getReassignOptions()
    : undefined

  return (
    <>
      {/* Links others add or remove show up without a reload. */}
      <TaskChangesRefresher deliverableLinks />
      <TaskDetailView
        task={task}
        reassignOptions={reassignOptions}
        onCopied={recordCopiedTaskAction}
        returnLink={returnLink(safeReturnPath(from))}
      />
    </>
  )
}
