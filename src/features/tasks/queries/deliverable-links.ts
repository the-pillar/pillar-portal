import "server-only"

import { createClient } from "@/lib/supabase/server"

import { FORMER_MEMBER, nameMap } from "./shared"

/** One deliverable link a slot's holder handed in (AD-25). */
export type DeliverableLink = {
  id: string
  slotId: string
  taskId: string
  url: string
  addedBy: string
  /** From member_directory; "Former member" when they're no longer listed. */
  addedByName: string
  /** UTC ISO timestamp, as PostgREST returned it; shown in PHT. */
  addedAt: string
}

/**
 * The deliverable links of the given tasks, in `seq` order (the order they
 * were pasted and added, never a position), through RLS: a deleted task's
 * links aren't returned, and neither are any for a caller who isn't an active
 * member. Names come from member_directory (never `members`). With no ids it
 * returns [] without a query. Throws on any query error.
 */
export async function getDeliverableLinks(
  taskIds: string[]
): Promise<DeliverableLink[]> {
  if (taskIds.length === 0) return []

  const supabase = await createClient()

  const linksResult = await supabase
    .from("task_deliverable_links")
    .select(
      "id, slot_id, url, added_by, added_at, task_assignments!inner(task_id)"
    )
    .in("task_assignments.task_id", taskIds)
    .order("seq")
  if (linksResult.error) {
    throw new Error("getDeliverableLinks: reading links failed", {
      cause: linksResult.error,
    })
  }
  const links = linksResult.data ?? []
  if (links.length === 0) return []

  const membersResult = await supabase
    .from("member_directory")
    .select("id, name")
    .in("id", [...new Set(links.map((link) => link.added_by))])
  if (membersResult.error) {
    throw new Error("getDeliverableLinks: reading member_directory failed", {
      cause: membersResult.error,
    })
  }

  const nameById = nameMap(membersResult.data ?? [])

  return links.map((link) => ({
    id: link.id,
    slotId: link.slot_id,
    taskId: link.task_assignments.task_id,
    url: link.url,
    addedBy: link.added_by,
    addedByName: nameById.get(link.added_by) ?? FORMER_MEMBER,
    addedAt: link.added_at,
  }))
}
