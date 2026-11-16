"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { Plus } from "lucide-react"

import { cn } from "@/lib/utils"

import { openNewTask } from "../new-task-url"

// A focused text field takes the floating button's place below `md` (the
// keyboard would sit on top of it). An open sheet, menu or dialog hides it in
// CSS (globals.css), so it is back on screen the moment that dialog leaves the
// DOM and Radix returns focus to it.
const NON_TEXT_INPUT = /^(checkbox|radio|button|submit|reset|file|image|range)$/

function isTextField(element: EventTarget | null): boolean {
  if (!(element instanceof HTMLElement)) return false
  if (element instanceof HTMLInputElement) {
    return !NON_TEXT_INPUT.test(element.type)
  }
  return (
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    element.isContentEditable
  )
}

/**
 * The **New task** pill (DESIGN.md › New task button), the app header's
 * `action`: a white pill in the header from `md`, a 44px navy pill floating
 * above the tab bar below it. It only sets the URL (`new=task`); the sheet
 * opens from there, prefilled by the page's own `owner`, else the caller's
 * home scope. Below `md` it hides on Task detail, while a sheet, menu or
 * dialog is open (by CSS), and while a text field has focus.
 */
export function NewTaskButton() {
  const pathname = usePathname()
  const [typing, setTyping] = useState(false)

  useEffect(() => {
    const focusIn = (event: FocusEvent) => setTyping(isTextField(event.target))
    const focusOut = () => setTyping(false)
    document.addEventListener("focusin", focusIn)
    document.addEventListener("focusout", focusOut)
    return () => {
      document.removeEventListener("focusin", focusIn)
      document.removeEventListener("focusout", focusOut)
    }
  }, [])

  const onTaskDetail = pathname.startsWith("/dashboard/tasks/")
  const hiddenBelowMd = onTaskDetail || typing

  return (
    <button
      type="button"
      data-new-task-button=""
      data-tour="new-task"
      data-hidden={hiddenBelowMd ? "" : undefined}
      onClick={() => openNewTask()}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full bg-navy px-4 text-sm font-semibold text-white shadow-lift focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:min-h-9 md:bg-white md:text-navy md:shadow-none md:focus-visible:outline-ring-on-dark",
        hiddenBelowMd && "max-md:hidden"
      )}
    >
      <Plus aria-hidden="true" className="size-4" />
      New task
    </button>
  )
}

/**
 * A page's own "+ Add a task" (the Board's To Do, a Planner day): sets the
 * same URL with a prefill. Only rendered for a caller who can create tasks.
 */
export function NewTaskLink({
  owner,
  due,
  label = "+ Add a task",
  ariaLabel,
  className,
  children,
}: {
  owner?: string
  /** A `YYYY-MM-DD` day. */
  due?: string
  label?: string
  ariaLabel?: string
  className?: string
  children?: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={() => openNewTask({ owner, due })}
      className={className}
    >
      {children ?? label}
    </button>
  )
}
