import { monthWeeks, phtDayLabel } from "@/lib/time"
import { cn } from "@/lib/utils"

import { tasksByDay } from "../planner"
import type { PlannerCard } from "../queries/planner"
import { NewTaskLink } from "./new-task-button"
import { PlannerChip } from "./planner-chip"

const WEEKDAYS = [
  ["Sun", "Sunday"],
  ["Mon", "Monday"],
  ["Tue", "Tuesday"],
  ["Wed", "Wednesday"],
  ["Thu", "Thursday"],
  ["Fri", "Friday"],
  ["Sat", "Saturday"],
] as const

/**
 * The Planner's month grid (`md` and up): a table labelled by the month
 * heading, weeks starting on Sunday, each task as a chip on its Manila due
 * date, every chip shown (no "+n more"). Days outside the month are blank
 * cells in the page color. Each day is a white cell at least 112px tall that
 * grows to fit its chips; today's cell is `aria-current="date"` and its number
 * sits on a filled navy circle.
 * The layout is fixed, so a long title truncates instead of widening its
 * column. For a caller who can create tasks each day has a **+** in its
 * reserved header row (shown on hover or focus, always in the tab order) that
 * opens the New task sheet due that day. No directive and no members imports.
 */
export function PlannerGrid({
  month,
  today,
  tasks,
  labelledBy,
  canCreate = false,
  highlightId = null,
}: {
  /** `YYYY-MM`, a Manila month. */
  month: string
  /** Today's Manila date, `YYYY-MM-DD`. */
  today: string
  /** The month's tasks, ordered by due date then id. */
  tasks: PlannerCard[]
  /** The id of the heading that names the month. */
  labelledBy: string
  /** `can_create_task()`: each day gets a **+** that opens the New task sheet. */
  canCreate?: boolean
  /** The task just created, whose chip highlights once. */
  highlightId?: string | null
}) {
  const byDay = tasksByDay(tasks)

  return (
    <table
      aria-labelledby={labelledBy}
      className="w-full table-fixed border-collapse"
    >
      <thead>
        <tr>
          {WEEKDAYS.map(([short, long]) => (
            <th
              key={short}
              scope="col"
              abbr={long}
              className="pb-2 text-left text-xs font-semibold text-muted-foreground"
            >
              {short}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {monthWeeks(month).map((week) => (
          <tr key={week.find((day) => day !== null)}>
            {week.map((day, index) => {
              if (day === null) {
                return (
                  <td key={`blank-${index}`} className="border bg-background" />
                )
              }
              const isToday = day === today
              const dayTasks = byDay.get(day) ?? []
              return (
                <td
                  key={day}
                  aria-current={isToday ? "date" : undefined}
                  className="group/day h-28 border bg-card p-1.5 align-top"
                >
                  <div className="flex items-start justify-between">
                    <time
                      dateTime={day}
                      className={cn(
                        "flex size-6 items-center justify-center rounded-full text-xs font-semibold text-muted-foreground",
                        isToday && "bg-navy text-white"
                      )}
                    >
                      {Number(day.slice(8))}
                    </time>
                    {canCreate && (
                      <NewTaskLink
                        due={day}
                        ariaLabel={`Add a task due ${phtDayLabel(day)}`}
                        className="flex size-6 items-center justify-center rounded-full text-sm font-semibold text-navy opacity-0 group-hover/day:opacity-100 hover:bg-navy-tint focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        <span aria-hidden="true">+</span>
                      </NewTaskLink>
                    )}
                  </div>
                  {dayTasks.length > 0 && (
                    <ul className="mt-1 flex flex-col gap-1">
                      {dayTasks.map((task) => (
                        <li
                          key={task.id}
                          data-highlight={
                            task.id === highlightId ? "" : undefined
                          }
                        >
                          <PlannerChip task={task} />
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
