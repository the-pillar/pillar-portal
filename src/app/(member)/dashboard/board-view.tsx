import { Suspense } from "react"

import { BoardColumnsSkeleton } from "./board-skeleton"
import { BoardColumns } from "./board-columns"
import { TaskChangesRefresher } from "@/features/tasks"

// The Board (EXPERIENCE.md › Board column). The title and the live refresher
// sit outside the data's Suspense boundary, so an empty Board still updates
// live. The whole window loads once and the client filters it, so there is no
// per-filter boundary. `data-wide-view` widens the shell.
export function BoardView({ viewerId }: { viewerId: string }) {
  return (
    <div data-wide-view>
      <h1 className="font-heading text-display text-navy">Board</h1>
      <TaskChangesRefresher />
      <div className="mt-4">
        <Suspense fallback={<BoardColumnsSkeleton />}>
          <BoardColumns viewerId={viewerId} />
        </Suspense>
      </div>
    </div>
  )
}
