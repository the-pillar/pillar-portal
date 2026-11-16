import "server-only"

import { after } from "next/server"
import { cache } from "react"

import { getMyHomeScope } from "@/features/members"
import { recordErrorEvent } from "@/lib/record-error-event"
import { createClient } from "@/lib/supabase/server"

import { ownerFilterParam, parseOwnerFilterParam } from "../board"
import { getReassignOptions } from "./reassign"
import {
  getTaskFormOptions,
  type SlotMemberOption,
  type TaskFormOptions,
} from "./task-form"

/**
 * Whether the caller may create tasks, from `can_create_task()` (spine AD-4),
 * the one check behind the New task button, the sheet and every entry point.
 * Cached per request, so the layout and the Board and Planner pages share one
 * read. A failed read counts as no.
 */
export const canCreateTask = cache(async (): Promise<boolean> => {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("can_create_task")
  if (error) {
    after(() => recordErrorEvent(error, { route: "render can-create-task" }))
    return false
  }
  return data === true
})

/**
 * The form options with each member's open slots added (the reassign
 * picker's read, `member_open_slot_counts`), so the member rows can show
 * "Kai · 0 active". Throws on any query error.
 */
export async function getTaskFormOptionsWithLoad(
  base?: TaskFormOptions
): Promise<TaskFormOptions> {
  const options = base ?? (await getTaskFormOptions())
  const loaded = await getReassignOptions(options)
  const load = new Map(loaded.allMembers.map((m) => [m.id, m.openSlots]))
  const withLoad = (member: SlotMemberOption): SlotMemberOption => ({
    ...member,
    openSlots: load.get(member.id) ?? 0,
  })

  const slotMembersByRole: TaskFormOptions["slotMembersByRole"] = {}
  for (const [role, members] of Object.entries(options.slotMembersByRole)) {
    slotMembersByRole[role as keyof typeof slotMembersByRole] = (
      members ?? []
    ).map(withLoad)
  }
  return {
    ...options,
    slotMembersByRole,
    allMembers: options.allMembers.map(withLoad),
  }
}

export type NewTaskLayoutData = {
  options: TaskFormOptions
  /** The caller's home scope as `section:<id>` / `desk:<id>`, or null. */
  homeOwner: string | null
}

/**
 * What the layouts mount the New task sheet with, or null when the caller
 * can't create tasks (or the read fails): no sheet, no button, no entry point.
 */
export async function getNewTaskLayoutData(): Promise<NewTaskLayoutData | null> {
  if (!(await canCreateTask())) return null
  try {
    const [base, scope] = await Promise.all([
      getTaskFormOptions(),
      getMyHomeScope(),
    ])
    const options = await getTaskFormOptionsWithLoad(base)
    const home = parseOwnerFilterParam(ownerFilterParam(scope), base.owners)
    const homeOwner =
      home?.kind === "section" || home?.kind === "desk"
        ? ownerFilterParam(home)
        : null
    return { options, homeOwner }
  } catch (error) {
    after(() =>
      recordErrorEvent(error, { route: "render new-task-layout-data" })
    )
    return null
  }
}
