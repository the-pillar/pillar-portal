import { Suspense } from "react"

import {
  getMyOnboarding,
  recordCopiedTaskAction,
  SharedSessionWatcher,
  StepUpProvider,
} from "@/features/members"
import {
  getNewTaskLayoutData,
  NewTaskButton,
  NewTaskSheet,
} from "@/features/tasks"

import { NoticeToast } from "../notice-toast"
import { OfflineToast } from "../offline-toast"
import { AdminBannerSlot } from "./admin-banners"
import { AdminShell } from "./admin-shell"
import { requireAdmin } from "./require-admin"

// Admin routes need an active editorial_admin (requireAdmin): anyone not
// active goes to /login, an active staff member back to /dashboard with a
// notice. Each page makes the same check first, since a layout doesn't stop
// its page rendering. This is routing only: RLS and create_task still decide
// access (spec-1-5-admin-task-creation.md). The banner slot reads its sources
// only after the check, whenever the layout renders. The notice-toast reader
// shows a `?notice=` a command's navigation set, such as Task detail's
// Delete landing on /admin/tasks; the offline toast, a dropped connection. A
// page that throws shows error.tsx inside this shell. The New task button and
// sheet mount only for a caller can_create_task() allows; the sheet opens from
// the URL, so it sits in Suspense.
export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const member = await requireAdmin()
  const [newTask, onboarding] = await Promise.all([
    getNewTaskLayoutData(),
    getMyOnboarding(),
  ])

  return (
    <AdminShell
      member={member}
      banners={<AdminBannerSlot />}
      newTask={newTask ? <NewTaskButton /> : undefined}
      onboarding={
        onboarding === null
          ? undefined
          : onboarding.tourAndChecklist
            ? "tour"
            : "tips"
      }
    >
      <Suspense fallback={null}>
        <NoticeToast />
      </Suspense>
      {newTask && (
        <Suspense fallback={null}>
          <NewTaskSheet
            options={newTask.options}
            homeOwner={newTask.homeOwner}
            onCopied={recordCopiedTaskAction}
          />
        </Suspense>
      )}
      <OfflineToast />
      <SharedSessionWatcher />
      <StepUpProvider>{children}</StepUpProvider>
    </AdminShell>
  )
}
