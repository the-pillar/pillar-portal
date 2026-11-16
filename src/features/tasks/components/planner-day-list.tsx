import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { monthWeeks, phtDayLabel } from "@/lib/time"

import { deadlineCount, tasksByDay } from "../planner"
import type { PlannerCard } from "../queries/planner"
import { NewTaskLink } from "./new-task-button"
import { PlannerChip } from "./planner-chip"

/**
 * The Planner below `md` and on touch-first screens: one card per day of the
 * month, in date order. A day with deadlines is an accordion item (several
 * may be open; only today starts open) whose serif header reads the day,
 * " · Today" on today, and a count pill; its tasks are full-width 44px chip
 * rows. A day with nothing is one plain line, "Sun, Nov 15 · No deadlines".
 * The 44px trigger is named "<day>, <n deadlines>"; the day's h3 is Radix's
 * accordion header. For a caller who can create tasks, "+ Add a task" ends
 * each open day and sits on each empty day's line. No directive: the Accordion
 * is the client part.
 */
export function PlannerDayList({
  month,
  today,
  tasks,
  canCreate = false,
  highlightId = null,
  from,
}: {
  /** `YYYY-MM`, a Manila month. */
  month: string
  /** Today's Manila date, `YYYY-MM-DD`. */
  today: string
  /** The month's tasks under the active filter, ordered by due date then id. */
  tasks: PlannerCard[]
  /** `can_create_task()`: "+ Add a task" at the foot of each open day and on empty days. */
  canCreate?: boolean
  /** The task just created, whose chip highlights once. */
  highlightId?: string | null
  /** The Planner's own URL, passed to each chip for Task detail's return link. */
  from?: string
}) {
  const byDay = tasksByDay(tasks)
  const days = monthWeeks(month)
    .flat()
    .filter((day): day is string => day !== null)

  return (
    <Accordion
      key={`${month}:${byDay.has(today)}`}
      type="multiple"
      defaultValue={byDay.has(today) ? [today] : []}
      className="gap-2"
    >
      {days.map((day) => {
        const dayTasks = byDay.get(day) ?? []
        const label = `${phtDayLabel(day)}${day === today ? " · Today" : ""}`
        const add = canCreate && (
          <NewTaskLink
            due={day}
            ariaLabel={`Add a task due ${phtDayLabel(day)}`}
            className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-medium text-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        )
        if (dayTasks.length === 0) {
          return (
            <div
              key={day}
              className="flex items-center justify-between gap-2 rounded-lg bg-card px-3 py-0.5 text-sm text-muted-foreground shadow-card"
            >
              <p className="py-2">{label} · No deadlines</p>
              {add}
            </div>
          )
        }
        const count = deadlineCount(dayTasks.length)
        return (
          <AccordionItem
            key={day}
            value={day}
            className="rounded-lg bg-card px-3 shadow-card not-last:border-b-0"
          >
            {/* Named explicitly: the day and its count are two spans, which
                accessible-name rules may run together without a pause. */}
            <AccordionTrigger
              aria-label={`${label}, ${count}`}
              className="min-h-11 items-center gap-2 rounded-lg py-2 outline-hidden hover:no-underline focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span className="flex flex-1 items-center justify-between gap-2">
                <span className="font-heading text-heading-sm">{label}</span>
                <span className="rounded-full bg-navy-tint px-2 text-xs font-semibold">
                  {dayTasks.length}
                </span>
              </span>
            </AccordionTrigger>
            {/* Undoes the panel defaults a chip can't take: the fixed height
                and underlined links; the padding leaves room for a chip's focus outline,
            which the panel's overflow would clip. */}
            <AccordionContent className="h-auto px-1 pt-1 pb-3 [&_a]:no-underline">
              <ul className="flex flex-col gap-2">
                {dayTasks.map((task) => (
                  <li
                    key={task.id}
                    data-highlight={task.id === highlightId ? "" : undefined}
                  >
                    <PlannerChip task={task} variant="row" from={from} />
                  </li>
                ))}
              </ul>
              {add}
            </AccordionContent>
          </AccordionItem>
        )
      })}
    </Accordion>
  )
}
