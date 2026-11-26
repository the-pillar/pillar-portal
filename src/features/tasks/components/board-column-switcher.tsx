"use client"

import { cn } from "@/lib/utils"

import { TASK_COLUMN_LABELS, TASK_COLUMNS, type TaskColumn } from "../status"

/**
 * The Board's column switcher, below `lg` (EXPERIENCE.md › Column switcher):
 * one pill per column, named like "Doing, 3 tasks". The pill of the column in
 * view carries `aria-current`; tapping one asks the Board to scroll there.
 */
export function BoardColumnSwitcher({
  counts,
  active,
  onSelect,
}: {
  counts: Record<TaskColumn, number>
  active: TaskColumn
  onSelect: (column: TaskColumn) => void
}) {
  return (
    <nav aria-label="Jump to column" className="lg:hidden">
      <ul className="flex gap-2 overflow-x-auto p-row-padding">
        {TASK_COLUMNS.map((column) => {
          const current = column === active
          const count = counts[column]
          return (
            <li key={column} className="shrink-0">
              <button
                type="button"
                aria-current={current ? "true" : undefined}
                onClick={() => onSelect(column)}
                className={cn(
                  "relative inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-transform duration-(--motion-press) ease-(--ease-out) after:absolute after:inset-x-0 after:-inset-y-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-(--motion-press-scale-chip)",
                  current ? "bg-navy text-white" : "bg-muted text-list-ink"
                )}
              >
                <span>{TASK_COLUMN_LABELS[column]}</span>
                <span aria-hidden className="tabular-nums">
                  {count}
                </span>
                <span className="sr-only">
                  , {count} {count === 1 ? "task" : "tasks"}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
