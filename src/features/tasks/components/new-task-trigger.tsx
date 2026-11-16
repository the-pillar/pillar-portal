"use client"

import { openNewTask } from "../new-task-url"

/**
 * A plain button that opens the New task sheet from the URL, for a page's own
 * entry point such as the onboarding checklist's **Create a task**. Only
 * rendered for a caller who can create tasks.
 */
export function NewTaskTrigger({
  className = "inline-flex min-h-11 items-center rounded-sm text-left font-medium text-navy underline underline-offset-4 hover:no-underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden",
  children = "Create a task",
}: {
  className?: string
  children?: React.ReactNode
}) {
  return (
    <button type="button" onClick={() => openNewTask()} className={className}>
      {children}
    </button>
  )
}
