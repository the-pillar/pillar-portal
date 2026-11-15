import { getMyHomeScope } from "@/features/members"
import {
  getBoard,
  getBoardOwners,
  ownerFilterParam,
  parseOwnerFilterParam,
  TaskBoard,
  type OwnerFilter,
} from "@/features/tasks"

// The Board's whole window and what the client needs to filter it: the owners,
// the viewer's id (for Mine's highlights) and the home scope, which applies
// when the URL's `owner` is missing or not a filter. The home scope goes
// through the same check, so one naming no listed section or desk falls back
// to All rather than leaving the filter blank.
export async function BoardColumns({ viewerId }: { viewerId: string }) {
  const [owners, scope, cards] = await Promise.all([
    getBoardOwners(),
    getMyHomeScope(),
    getBoard(),
  ])
  const homeFilter: OwnerFilter = parseOwnerFilterParam(
    ownerFilterParam(scope),
    owners
  ) ?? { kind: "all" }

  return (
    <TaskBoard
      cards={cards}
      owners={owners}
      viewerId={viewerId}
      homeFilter={homeFilter}
    />
  )
}
