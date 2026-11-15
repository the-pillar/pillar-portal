import "server-only"

import { createClient } from "@/lib/supabase/server"

import { boardDoneCutoff, type TaskOwnerOption } from "../board"
import type { TaskColumn } from "../status"
import {
  nameMap,
  ownerOptions,
  taskCardsQuery,
  toTaskCard,
  FORMER_MEMBER,
  type TaskCardData,
} from "./shared"

/**
 * The Board's owner filter choices: the task form's owner list. Reads
 * `sections` and `desks` directly (every active member may). Throws on any
 * query error.
 */
export async function getBoardOwners(): Promise<TaskOwnerOption[]> {
  const supabase = await createClient()

  const [sectionsResult, desksResult] = await Promise.all([
    supabase.from("sections").select("id, name").order("sort_order"),
    supabase.from("desks").select("id, name").order("sort_order"),
  ])
  if (sectionsResult.error) {
    throw new Error("getBoardOwners: reading sections failed", {
      cause: sectionsResult.error,
    })
  }
  if (desksResult.error) {
    throw new Error("getBoardOwners: reading desks failed", {
      cause: desksResult.error,
    })
  }

  return ownerOptions(sectionsResult.data ?? [], desksResult.data ?? [])
}

/** PostgREST's `max_rows` (supabase/config.toml): a read that returns this many may be cut short. */
export const BOARD_MAX_ROWS = 1000

export type BoardCard = TaskCardData & {
  ownerId: string
  ownerKind: "section" | "desk"
  /**
   * Every column the viewer may put the card in, from task_capabilities and
   * nothing else (AD-4): its allowed_moves in enum order, then Done when its
   * can_review is true. allowed_moves never holds Done (move_task never
   * enters it), so Done stays last and only the approver of a For Review
   * card gets it.
   */
  moves: TaskColumn[]
  /** The viewer holds an open slot on it (its id is in my_open_slots()). */
  yours: boolean
  /**
   * The card's version: `moved_at` exactly as PostgREST returned it. Never
   * parsed: a `Date` keeps milliseconds only, so a round trip would always
   * read as stale (AD-21).
   */
  movedAt: string
  movedBy: string | null
  /** From member_directory; null when nobody is recorded as the mover. */
  movedByName: string | null
  createdBy: string | null
  doneAt: string | null
}

/**
 * Every task in the Board's window as cards ordered by due date then id: all
 * but Done, and Done within boardDoneCutoff (30 days back from one `now`,
 * which also dates each card's Overdue badge). It is read once, unfiltered:
 * the client filters, so the chips' counts and a tap's result need no round
 * trip. That window, in the query itself, keeps the read below PostgREST's
 * row cap however many tasks a semester finishes; at the cap it throws
 * rather than show a Board that might be missing cards. The slots come
 * embedded in the tasks query (a Board can hold hundreds of tasks, too many
 * for an `.in()` list); with no tasks it stops there, otherwise
 * task_capabilities (whose row gives each card its `moves`), my_open_slots
 * (which cards are `yours`) and the names from member_directory (never
 * `members`) are read together. The whole directory is read rather than an
 * `.in()` of slot members: over the years those ids could outgrow a URL,
 * while the directory holds only active members. Throws on any query error.
 */
export async function getBoard(): Promise<BoardCard[]> {
  const supabase = await createClient()
  const now = new Date()

  const tasksResult = await taskCardsQuery(supabase).or(
    `column.neq.done,done_at.gte.${boardDoneCutoff(now)}`
  )
  if (tasksResult.error) {
    throw new Error("getBoard: reading tasks failed", {
      cause: tasksResult.error,
    })
  }
  const tasks = tasksResult.data ?? []
  if (tasks.length >= BOARD_MAX_ROWS) {
    throw new Error("getBoard: the window reached PostgREST's max_rows")
  }
  if (tasks.length === 0) return []

  const [capabilitiesResult, openResult, membersResult] = await Promise.all([
    supabase.rpc("task_capabilities", { ids: tasks.map((task) => task.id) }),
    supabase.rpc("my_open_slots"),
    supabase.from("member_directory").select("id, name"),
  ])
  if (capabilitiesResult.error) {
    throw new Error("getBoard: reading task_capabilities failed", {
      cause: capabilitiesResult.error,
    })
  }
  if (openResult.error) {
    throw new Error("getBoard: reading my_open_slots failed", {
      cause: openResult.error,
    })
  }
  if (membersResult.error) {
    throw new Error("getBoard: reading member_directory failed", {
      cause: membersResult.error,
    })
  }

  const nameById = nameMap(membersResult.data ?? [])
  const capabilitiesByTask = new Map(
    (capabilitiesResult.data ?? []).map((row) => [row.task_id, row])
  )
  const yoursTaskIds = new Set(
    (openResult.data ?? []).map((slot) => slot.task_id)
  )

  return tasks.map((task) => {
    const capabilities = capabilitiesByTask.get(task.id)
    return {
      ...toTaskCard(task, task.task_assignments, nameById, now),
      ownerId: task.owning_section_id ?? task.owning_desk_id ?? "",
      ownerKind: task.owning_section_id !== null ? "section" : "desk",
      // The one place can_review becomes the Done target.
      moves: [
        ...(capabilities?.allowed_moves ?? []),
        ...(capabilities?.can_review ? (["done"] as const) : []),
      ],
      yours: yoursTaskIds.has(task.id),
      movedAt: task.moved_at,
      movedBy: task.moved_by,
      movedByName:
        task.moved_by === null
          ? null
          : (nameById.get(task.moved_by) ?? FORMER_MEMBER),
      createdBy: task.created_by,
      doneAt: task.done_at,
    }
  })
}
