import "server-only"

import { z } from "zod"

import { initialsOf, WRITERS_DESK_ID } from "@/features/members"
import type { createClient } from "@/lib/supabase/server"

import type { OwnerFilter, TaskOwnerOption } from "../board"
import { isTaskOverdue, type SlotState, type TaskColumn } from "../status"

// What more than one view's reads share. index.ts exports only the card types
// from here; the helpers stay inside queries/.

/**
 * Every content section, then every desk but Writers (which owns no task):
 * the one owner list the task form and the Board's filter share.
 */
export function ownerOptions(
  sections: { id: string; name: string }[],
  desks: { id: string; name: string }[]
): TaskOwnerOption[] {
  return [
    ...sections.map((section) => ({
      kind: "section" as const,
      id: section.id,
      name: section.name,
    })),
    ...desks
      .filter((desk) => desk.id !== WRITERS_DESK_ID)
      .map((desk) => ({ kind: "desk" as const, id: desk.id, name: desk.name })),
  ]
}

export const FORMER_MEMBER = "Former member"

// A malformed id would make Postgres raise invalid_text_representation, so
// it never gets that far: it reads as "not found", like a missing task.
export const taskIdSchema = z.uuid()

export type TaskCardAssignee = {
  id: string
  name: string
  initials: string
  /**
   * Every slot they hold on the task is Needs reassignment: they handed it
   * all back, and the card dims their avatar.
   */
  handedBack: boolean
}

/** Everything a task card shows, computed on the server. */
export type TaskCardData = {
  id: string
  title: string
  ownerName: string
  /** UTC ISO timestamp; shown in PHT. */
  dueAt: string
  column: TaskColumn
  overdue: boolean
  /**
   * The task's revision note stands (it was sent back and hasn't moved
   * since), so its status reads "Sent back".
   */
  sentBack: boolean
  /** Any slot on the task, anyone's, is in that state. */
  hasAwaitingResponse: boolean
  hasNeedsReassignment: boolean
  /**
   * Distinct slot members in slot order, each marked when they handed back
   * every slot they hold on the task.
   */
  assignees: TaskCardAssignee[]
  /**
   * The owning section's or desk's id, which colors the owner label
   * (`data-owner`). Empty for a read that doesn't select it.
   */
  ownerId?: string
  /** The viewer holds an open slot on it (Board reads only; default false). */
  yours?: boolean
  /** When it was marked Done, as PostgREST returned it; null before then. */
  doneAt?: string | null
}

export function byDueThenId(
  a: { dueAt: string; id: string },
  b: { dueAt: string; id: string }
) {
  const diff = new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
  if (diff !== 0) return diff
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

type CardTask = {
  id: string
  title: string
  due_at: string
  column: TaskColumn
  revision_note_at: string | null
  sections: { name: string } | null
  desks: { name: string } | null
  // Only the Board's and the Planner's select carry these.
  owning_section_id?: string | null
  owning_desk_id?: string | null
  done_at?: string | null
}

/** One task card's data, from the task, its slots (in slot order) and the names. */
export function toTaskCard(
  task: CardTask,
  slots: { member_id: string; state: SlotState }[],
  nameById: Map<string, string>,
  now: Date
): TaskCardData {
  // Each member's entry, in the order of their first slot; any slot of theirs
  // in another state clears handedBack.
  const byMember = new Map<string, TaskCardAssignee>()
  for (const slot of slots) {
    const handedBack = slot.state === "needs_reassignment"
    const seen = byMember.get(slot.member_id)
    if (seen !== undefined) {
      seen.handedBack &&= handedBack
      continue
    }
    const name = nameById.get(slot.member_id) ?? FORMER_MEMBER
    byMember.set(slot.member_id, {
      id: slot.member_id,
      name,
      initials: initialsOf(name),
      handedBack,
    })
  }
  const assignees = [...byMember.values()]
  return {
    id: task.id,
    title: task.title,
    ownerName: task.sections?.name ?? task.desks?.name ?? "",
    dueAt: task.due_at,
    column: task.column,
    overdue: isTaskOverdue(task.due_at, task.column, now),
    sentBack: task.revision_note_at !== null,
    hasAwaitingResponse: slots.some(
      (slot) => slot.state === "awaiting_response"
    ),
    hasNeedsReassignment: slots.some(
      (slot) => slot.state === "needs_reassignment"
    ),
    assignees,
    ownerId: task.owning_section_id ?? task.owning_desk_id ?? "",
    doneAt: task.done_at ?? null,
  }
}

export function nameMap(rows: { id: string | null; name: string | null }[]) {
  const nameById = new Map<string, string>()
  for (const member of rows) {
    if (member.id !== null && member.name !== null) {
      nameById.set(member.id, member.name)
    }
  }
  return nameById
}

type ServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * Tasks as card rows, the Board's and the Planner's one select: each with its
 * owner's name and its slots embedded in slot order (created_at, then id),
 * the tasks by due date then id.
 */
export function taskCardsQuery(supabase: ServerClient) {
  return supabase
    .from("tasks")
    .select(
      "id, title, due_at, column, revision_note_at, owning_section_id, owning_desk_id, moved_at, moved_by, created_by, done_at, sections(name), desks(name), task_assignments(member_id, state)"
    )
    .order("due_at")
    .order("id")
    .order("created_at", { referencedTable: "task_assignments" })
    .order("id", { referencedTable: "task_assignments" })
}

type TaskCardsQuery = ReturnType<typeof taskCardsQuery>

/**
 * Narrows a card query to the tasks an owner filter names. `mine` is decided
 * by the viewer's open slots, never by a column of `tasks`, so only the Board
 * (which filters in the client) uses it and this takes the owner kinds only.
 */
export function withOwnerFilter(
  query: TaskCardsQuery,
  filter: Exclude<OwnerFilter, { kind: "mine" }>
): TaskCardsQuery {
  switch (filter.kind) {
    case "section":
      return query.eq("owning_section_id", filter.id)
    case "desk":
      return query.eq("owning_desk_id", filter.id)
    case "articles":
      return query.not("owning_section_id", "is", null)
    case "all":
      return query
  }
}
