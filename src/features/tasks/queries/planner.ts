import "server-only"

import { createClient } from "@/lib/supabase/server"
import { phtMonthBounds } from "@/lib/time"

import {
  byDueThenId,
  MAX_ROWS,
  nameMap,
  taskCardsQuery,
  toTaskCard,
  type TaskCardData,
} from "./shared"

/** A task in the Planner's month: the card, whose it is and whether it is the viewer's. */
export type PlannerCard = TaskCardData & {
  ownerId: string
  ownerKind: "section" | "desk"
  /** The viewer holds an open slot on it (its id is in my_open_slots()). */
  yours: boolean
}

/**
 * The Planner's month (`YYYY-MM`, a Manila month): every task due inside it,
 * Done included, ordered by due date then id. It is read once, unfiltered:
 * the client filters with the Board's chips, so a tap needs no round trip.
 * The month window keeps the read below PostgREST's row cap; at the cap it
 * throws rather than show a month that might be missing tasks. With no tasks
 * it stops there; otherwise my_open_slots (which cards are `yours`) and the
 * names from the whole member_directory (never `members`) are read together.
 * No task_capabilities: the Planner moves nothing. Throws on any query error.
 */
export async function getPlanner(month: string): Promise<PlannerCard[]> {
  const { start, end } = phtMonthBounds(month)
  const supabase = await createClient()

  const tasksResult = await taskCardsQuery(supabase)
    .gte("due_at", start.toISOString())
    .lt("due_at", end.toISOString())
  if (tasksResult.error) {
    throw new Error("getPlanner: reading tasks failed", {
      cause: tasksResult.error,
    })
  }
  const tasks = tasksResult.data ?? []
  if (tasks.length >= MAX_ROWS) {
    throw new Error("getPlanner: the month reached PostgREST's max_rows")
  }
  if (tasks.length === 0) return []

  const [openResult, membersResult] = await Promise.all([
    supabase.rpc("my_open_slots"),
    supabase.from("member_directory").select("id, name"),
  ])
  if (openResult.error) {
    throw new Error("getPlanner: reading my_open_slots failed", {
      cause: openResult.error,
    })
  }
  if (membersResult.error) {
    throw new Error("getPlanner: reading member_directory failed", {
      cause: membersResult.error,
    })
  }

  const nameById = nameMap(membersResult.data ?? [])
  const yoursTaskIds = new Set(
    (openResult.data ?? []).map((slot) => slot.task_id)
  )
  const now = new Date()
  return tasks
    .map((task) => ({
      ...toTaskCard(task, task.task_assignments, nameById, now),
      ownerId: task.owning_section_id ?? task.owning_desk_id ?? "",
      ownerKind: (task.owning_section_id !== null ? "section" : "desk") as
        "section" | "desk",
      yours: yoursTaskIds.has(task.id),
    }))
    .sort(byDueThenId)
}
