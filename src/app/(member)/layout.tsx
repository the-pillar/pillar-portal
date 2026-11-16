import { Suspense } from "react"

import { requireActiveMember, SharedSessionWatcher } from "@/features/members"
import {
  getNewTaskLayoutData,
  NewTaskButton,
  NewTaskSheet,
} from "@/features/tasks"

import { MemberShell } from "./member-shell"
import { NoticeToast } from "../notice-toast"
import { OfflineToast } from "../offline-toast"

// Member routes need an active member: requireActiveMember sends anyone else
// (signed out, pending, declined, deactivated) to /login. Each page makes the
// same check first, since a layout doesn't stop its page rendering. This is
// routing only: RLS decides what any caller can read (AD-7). Reading the
// session cookies makes every page under here dynamic. A page that throws
// shows error.tsx inside this shell, so the header and tabs stay. The New task
// button and sheet mount only for a caller can_create_task() allows (one
// cached read); the sheet opens from the URL, so it sits in Suspense.
export default async function MemberLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const member = await requireActiveMember()
  const newTask = await getNewTaskLayoutData()

  return (
    <MemberShell
      member={member}
      newTask={newTask ? <NewTaskButton /> : undefined}
    >
      <Suspense fallback={null}>
        <NoticeToast />
      </Suspense>
      {newTask && (
        <Suspense fallback={null}>
          <NewTaskSheet
            options={newTask.options}
            homeOwner={newTask.homeOwner}
          />
        </Suspense>
      )}
      <OfflineToast />
      <SharedSessionWatcher />
      {children}
    </MemberShell>
  )
}
