import Link from "next/link"
import {
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDot,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"

import {
  plannerChipLabel,
  plannerChipStatus,
  type PlannerChipStatusKind,
} from "../planner"
import type { PlannerCard } from "../queries/planner"

// Each status's glyph and color, at least 3:1 on the card. To Do takes
// muted-foreground: the neutral dot's gray is only 2.5:1 on white.
const GLYPHS: Record<
  PlannerChipStatusKind,
  { icon: LucideIcon; className: string }
> = {
  to_do: { icon: Circle, className: "text-muted-foreground" },
  doing: { icon: CircleDot, className: "text-status-progress" },
  for_review: { icon: CircleDot, className: "text-status-progress" },
  done: { icon: CircleCheck, className: "text-status-positive" },
  overdue: { icon: CircleAlert, className: "text-status-attention" },
  sent_back: { icon: CircleAlert, className: "text-status-attention" },
}

/**
 * One task in the Planner (DESIGN.md › Planner chip): a white card with the
 * card shadow, `rounded-xs`, a 3px stripe in the owner's color (`data-owner`),
 * a status glyph, then the title on one line. Tasks where the viewer holds an
 * open slot fill with `navy-tint` and set the title in semibold. A link to
 * Task detail, since opening a task is navigation (so it also opens in a new
 * tab); its name carries the owner, the title, the status and the PHT due
 * time. At least 24px tall in the month grid; the `row` variant is the day
 * list's full-width 44px row, with a muted owner prefix. No directive and no
 * members imports.
 */
export function PlannerChip({
  task,
  variant = "grid",
}: {
  task: PlannerCard
  variant?: "grid" | "row"
}) {
  const { icon: Glyph, className } = GLYPHS[plannerChipStatus(task).kind]
  const row = variant === "row"

  return (
    <Link
      href={`/dashboard/tasks/${task.id}`}
      aria-label={plannerChipLabel(task)}
      data-owner={task.ownerId}
      data-yours={task.yours ? "" : undefined}
      className={cn(
        "flex min-w-0 items-center gap-1.5 rounded-xs border-l-[3px] border-l-(--owner) px-2 text-xs shadow-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        task.yours ? "bg-navy-tint" : "bg-card",
        row ? "min-h-11 w-full gap-2 text-sm" : "min-h-6 py-0.5"
      )}
    >
      <Glyph
        aria-hidden="true"
        className={cn("shrink-0", row ? "size-4" : "size-3", className)}
      />
      {row && task.ownerName && (
        <span aria-hidden="true" className="shrink-0 text-muted-foreground">
          {task.ownerName} ·
        </span>
      )}
      <span
        className={cn("truncate", task.yours ? "font-semibold" : "font-medium")}
      >
        {task.title}
      </span>
    </Link>
  )
}
