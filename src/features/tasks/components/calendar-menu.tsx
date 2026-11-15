"use client"

import { CalendarPlus, EllipsisVertical } from "lucide-react"
import { toast } from "@/components/ui/toast"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import { MenuSheet, MenuSheetItem } from "@/components/ui/menu-sheet"

import { calendarRoutePath } from "../calendar"
import { TASK_COLUMN_LABELS, type TaskColumn } from "../status"

const ITEM = "min-h-11 w-full"
const DOWNLOADED = "Calendar file downloaded."

/**
 * Task detail's menu. `googleUrl` is built on the server from the task, so
 * Google opens straight from a link (a link, not window.open: iPhone in-app
 * browsers block popups).
 */
export function AddToCalendarMenu({
  taskId,
  googleUrl,
}: {
  taskId: string
  googleUrl: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex min-h-11 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden">
        <CalendarPlus aria-hidden className="size-4" />
        Add to Google Calendar
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuItem asChild>
          <a
            href={googleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={ITEM}
          >
            Open in Google Calendar
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a
            href={calendarRoutePath(taskId)}
            className={ITEM}
            onClick={() => toast(DOWNLOADED)}
          >
            Download .ics
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * A card's overflow menu, a MenuSheet titled with the task: a bottom sheet
 * on phones and touch-first screens, a menu elsewhere. Its first rows are
 * "Move to <column>" for each of `moves` (the Board's card offers the moves
 * task_capabilities returned; nothing else decides them), then the calendar
 * rows. It sits above the title link's stretched area (`z-10`), so opening
 * it never opens the card. The wrapper stops `mousedown`/`touchstart`, which
 * also covers the menu's portal (React events bubble through it), so on the
 * Board it never starts a drag.
 */
export function TaskCardMenu({
  taskId,
  title,
  moves = [],
  onMove,
}: {
  taskId: string
  title: string
  moves?: readonly TaskColumn[]
  onMove?: (toColumn: TaskColumn) => void
}) {
  const stop = (event: React.SyntheticEvent) => event.stopPropagation()

  return (
    <div
      className="absolute top-0 right-0 z-10"
      onMouseDown={stop}
      onTouchStart={stop}
    >
      <MenuSheet
        title={title}
        trigger={
          <button
            type="button"
            aria-label={`More actions, ${title}`}
            className="inline-flex size-11 items-center justify-center rounded-full text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
          >
            <EllipsisVertical aria-hidden className="size-5" />
          </button>
        }
      >
        {onMove &&
          moves.map((toColumn) => (
            <MenuSheetItem key={toColumn} onSelect={() => onMove(toColumn)}>
              Move to {TASK_COLUMN_LABELS[toColumn]}
            </MenuSheetItem>
          ))}
        <MenuSheetItem asChild>
          <a
            href={calendarRoutePath(taskId, "google")}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in Google Calendar
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </MenuSheetItem>
        <MenuSheetItem asChild>
          <a href={calendarRoutePath(taskId)} onClick={() => toast(DOWNLOADED)}>
            Download .ics
          </a>
        </MenuSheetItem>
      </MenuSheet>
    </div>
  )
}
