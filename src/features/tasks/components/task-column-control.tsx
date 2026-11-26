"use client"

import { useEffect, useOptimistic, useRef, useState } from "react"

import { StatusDot } from "@/components/status-badge"
import { useCommand } from "@/lib/use-command"
import { cn } from "@/lib/utils"

import { moveTaskAction } from "../actions"
import { taskErrorMessage } from "../errors"
import { taskStatus, type TaskColumn } from "../status"
import { MoveToSelect } from "./move-to-select"
import { TASK_STATUS_ID } from "./task-status-id"

// Task detail's sticky action bar (DESIGN.md › Sticky action bar). Below md,
// and at least 480px tall, it is fixed at the bottom with the home-indicator
// inset; shorter, and from md, it flows in place after the status row.
const BAR_CLASS =
  "grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center md:gap-3 tabbar-fixed:fixed tabbar-fixed:inset-x-0 tabbar-fixed:bottom-0 tabbar-fixed:z-30 tabbar-fixed:max-h-[70svh] tabbar-fixed:overflow-y-auto tabbar-fixed:border-t tabbar-fixed:border-border tabbar-fixed:bg-card tabbar-fixed:px-3 tabbar-fixed:pt-2.5 tabbar-fixed:pb-[calc(10px+env(safe-area-inset-bottom))]"

/**
 * The task's column as a status dot with its label, plus a "Move to…" select
 * listing exactly `allowedMoves` (task_capabilities' answer for this viewer)
 * when there are any. A move shows at once and rolls back, with a toast and
 * a refresh, if the database refuses it; the status is a polite live region,
 * so a screen reader hears both. A sent-back task reads "Sent back" until a
 * move is shown: every move clears the note.
 *
 * The status is `#task-status` (TASK_STATUS_ID), where the review controls
 * put focus once their command is saved.
 *
 * `children` are the viewer's slot controls (I'm on it / Can't take this, or
 * "You're on it." and Hand back), passed only while the viewer holds exactly
 * one open slot; with them and Move to… they form one action group after
 * the status row. `barred` marks that group `data-action-bar`, which
 * globals.css fixes at the bottom below md (hiding the bottom tab bar, one
 * fixed bar at most) and this component sizes into `--action-bar-height`
 * for the content's clearance (`pairMove` seats Move to… beside Hand back).
 * `lead` sits before the status (the due chip).
 *
 * While a move is saving the select stays focusable (`aria-disabled`, not
 * `disabled`, which would drop focus to the page) and ignores input. If the
 * select goes away with focus on it (a move that leaves no further moves),
 * focus goes to the status instead.
 */
export function TaskColumnControl({
  taskId,
  column,
  sentBack,
  allowedMoves,
  movedAt,
  lead,
  children,
  barred = false,
  pairMove = false,
}: {
  taskId: string
  column: TaskColumn
  /** The task's revision note stands (task detail's revisionNote). */
  sentBack: boolean
  allowedMoves: readonly TaskColumn[]
  /**
   * The task's `moved_at`, the version a move passes back. A saved move
   * returns the new one, which replaces it until the page re-reads.
   */
  movedAt: string
  lead?: React.ReactNode
  children?: React.ReactNode
  barred?: boolean
  /** Move to… takes the cell beside the first control instead of its own row. */
  pairMove?: boolean
}) {
  const { isPending, run } = useCommand({
    errorMessage: taskErrorMessage,
    thrownCode: "tasks.save_failed",
  })
  const [shownColumn, setShownColumn] = useOptimistic(column)
  // The version the next move passes, per page read: a new `movedAt` prop
  // (after a refresh) wins over what an earlier move returned.
  const [saved, setSaved] = useState({ from: movedAt, movedAt })
  const version = saved.from === movedAt ? saved.movedAt : movedAt
  const statusRef = useRef<HTMLParagraphElement>(null)
  const status = taskStatus(shownColumn, sentBack && shownColumn === column)
  const hasMoves = allowedMoves.length > 0
  const hadMoves = useRef(hasMoves)
  const barRef = useRef<HTMLDivElement>(null)

  // The bar's height, for the content and scroll padding that clear it.
  useEffect(() => {
    const bar = barRef.current
    if (!barred || !bar || typeof ResizeObserver === "undefined") return
    const root = document.documentElement
    const measure = () =>
      root.style.setProperty("--action-bar-height", `${bar.offsetHeight}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(bar)
    return () => {
      observer.disconnect()
      root.style.removeProperty("--action-bar-height")
    }
  }, [barred])

  useEffect(() => {
    const lostFocus =
      document.activeElement === null ||
      document.activeElement === document.body
    if (hadMoves.current && !hasMoves && lostFocus) {
      statusRef.current?.focus()
    }
    hadMoves.current = hasMoves
  }, [hasMoves])

  function move(toColumn: TaskColumn) {
    run(
      () => {
        setShownColumn(toColumn)
        return moveTaskAction({ taskId, toColumn, expectedMovedAt: version })
      },
      {
        onSuccess: (result) =>
          setSaved({ from: movedAt, movedAt: result.data.movedAt }),
      }
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2">
        {lead}
        <p
          ref={statusRef}
          id={TASK_STATUS_ID}
          tabIndex={-1}
          aria-live="polite"
          aria-atomic="true"
          className="flex items-center rounded-sm font-medium outline-offset-4 focus-visible:outline-2"
        >
          <span className="sr-only">Status: </span>
          <StatusDot family={status.family} label={status.label} />
        </p>
      </div>
      {(hasMoves || children) && (
        <div
          ref={barRef}
          data-action-bar={barred ? "" : undefined}
          className={cn(
            "flex flex-wrap items-center gap-3",
            barred && BAR_CLASS
          )}
        >
          {children}
          {hasMoves && (
            <MoveToSelect
              allowedMoves={allowedMoves}
              pending={isPending}
              onMove={move}
              className={
                barred
                  ? cn(
                      "w-full md:w-auto",
                      !pairMove && "col-span-2 md:col-span-1"
                    )
                  : undefined
              }
            />
          )}
        </div>
      )}
    </div>
  )
}
