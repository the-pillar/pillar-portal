import "server-only"

import { getCurrentMember } from "@/features/members"
import { createClient } from "@/lib/supabase/server"

/**
 * Whether the viewer has created a task: Admin home's "Create a task"
 * checklist item (Story 8.9). A head count of `tasks` whose `created_by` is
 * the viewer, limited to one row; RLS decides which tasks the caller can read.
 * A caller who isn't active gets false without a query. Throws on any query
 * error.
 */
export async function hasCreatedTaskForViewer(): Promise<boolean> {
  const member = await getCurrentMember()
  if (member?.state !== "active") return false

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("tasks")
    .select("id")
    .eq("created_by", member.id)
    .limit(1)
  if (error) {
    throw new Error("hasCreatedTaskForViewer: reading tasks failed", {
      cause: error,
    })
  }
  return (data?.length ?? 0) > 0
}
