import type { Ref } from "react"
import { Clock, CornerUpLeft } from "lucide-react"
import Link from "next/link"

import { StatusBadge, StatusDot } from "@/components/status-badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { avatarSlot } from "@/components/ui/avatar-slot"
import { formatInPht } from "@/lib/time"
import { cn } from "@/lib/utils"

import type { TaskCardData } from "../queries/shared"
import { taskHref } from "../return-link"
import {
  SENT_BACK_LABEL,
  SLOT_STATE_FAMILIES,
  SLOT_STATE_LABELS,
  taskStatus,
  type TaskColumn,
} from "../status"
import { TaskCardMenu } from "./calendar-menu"

const DUE_FORMAT = "EEE, MMM d, h:mm a"
const DONE_FORMAT = "MMM d"
const MAX_AVATARS = 3

/**
 * Extra props for the title link, so the Board can make it the keyboard drag
 * activator (its ref, dnd-kit's `aria-describedby`, `draggable={false}`).
 * Without them nothing changes.
 */
export type TitleLinkProps = {
  ref?: Ref<HTMLAnchorElement>
  "aria-describedby"?: string
  draggable?: boolean
}

/**
 * A task card (EXPERIENCE.md › Task card, DESIGN.md › Task card). Top to
 * bottom: the owner label, the title (the card's one link, its box stretched
 * over the card's upper block so a tap anywhere there opens Task detail),
 * state badges, then the due chip and the assignees' avatars. `children` sit
 * below that block, outside the link's reach, so their buttons don't
 * navigate. The Yours tag follows the title in reading order and sits top
 * right, beside the overflow menu; with the Yours bar it marks a card where
 * the viewer holds an open slot. Badges reflect the slots' states: display
 * only, they decide no action. An assignee who handed back every slot they
 * hold keeps an opaque avatar with a dashed ring and a return badge, and the
 * names read out mark them "(handed back)", so the ring never carries that
 * alone. `showStatus` adds the status dot with its label wherever no column
 * names the state (everywhere but the Board). Keyboard focus shows as the
 * card's ring. The link has `outline-hidden`, not `outline-none`:
 * forced-colors mode drops the ring (a box-shadow) but paints that
 * transparent outline. No directive and no members imports, so the Board can
 * reuse it; `moves` and `onMove` feed the overflow menu's Move to rows.
 */
export function TaskCard({
  task,
  children,
  titleLinkProps,
  headingLevel = 3,
  showStatus = true,
  moves,
  onMove,
  from,
}: {
  task: TaskCardData
  children?: React.ReactNode
  titleLinkProps?: TitleLinkProps
  /**
   * The title's heading level: 3 under a page's h2 sections (What's mine,
   * the Board), 4 where the cards sit under h3s (the Planner's day list).
   */
  headingLevel?: 3 | 4
  showStatus?: boolean
  moves?: readonly TaskColumn[]
  onMove?: (toColumn: TaskColumn) => void
  /**
   * The URL of the view this card sits in, which Task detail's return link
   * goes back to. Built by the view from its own state when the card renders.
   */
  from?: string
}) {
  const Heading = headingLevel === 4 ? "h4" : "h3"
  // The Sent back badge carries that state; the dot names the column.
  const status = taskStatus(task.column, false)
  const shown = task.assignees.slice(0, MAX_AVATARS)
  const extra = task.assignees.length - shown.length
  const done = task.column === "done"

  return (
    <article
      data-yours={task.yours ? "" : undefined}
      className="relative overflow-hidden rounded-lg bg-card p-card-padding shadow-card has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring"
    >
      {task.yours && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1 bg-navy"
        />
      )}
      <div className="relative flex flex-col gap-2">
        <TaskCardMenu
          taskId={task.id}
          title={task.title}
          moves={moves}
          onMove={onMove}
        />
        <p
          data-owner={task.ownerId ?? ""}
          className="w-fit max-w-[calc(100%-5.5rem)] rounded-xs bg-(--owner) px-2 py-0.5 text-owner-label text-white"
        >
          {task.ownerName}
        </p>
        <Heading className="pr-11 text-card-title break-words">
          <Link
            href={taskHref(task.id, from)}
            className="after:absolute after:inset-0 after:rounded-lg focus-visible:outline-hidden"
            {...titleLinkProps}
          >
            {task.title}
          </Link>
        </Heading>
        {task.yours && (
          <span className="absolute top-0.5 right-11 rounded-xs bg-navy px-2 text-owner-label text-white">
            Yours
          </span>
        )}

        {(task.hasAwaitingResponse ||
          task.hasNeedsReassignment ||
          task.sentBack) && (
          <div className="flex flex-wrap gap-2">
            {task.hasAwaitingResponse && (
              <StatusBadge
                family={SLOT_STATE_FAMILIES.awaiting_response}
                label={SLOT_STATE_LABELS.awaiting_response}
              />
            )}
            {task.hasNeedsReassignment && (
              <StatusBadge
                family={SLOT_STATE_FAMILIES.needs_reassignment}
                label={SLOT_STATE_LABELS.needs_reassignment}
              />
            )}
            {task.sentBack && (
              <StatusBadge family="attention" label={SENT_BACK_LABEL} />
            )}
          </div>
        )}

        {showStatus && (
          <StatusDot
            family={status.family}
            label={status.label}
            className="text-sm"
          />
        )}

        <div className="flex items-center justify-between gap-3">
          <p
            data-due={done ? "done" : task.overdue ? "overdue" : "open"}
            className={cn(
              "inline-flex min-w-0 items-center gap-1 rounded-xs px-2 py-0.5 text-xs tabular-nums",
              done
                ? "bg-positive-strong text-white"
                : task.overdue
                  ? "bg-attention-strong text-white"
                  : "bg-chip-fill text-list-ink"
            )}
          >
            <Clock aria-hidden className="size-3 shrink-0" />
            {done ? (
              <span>
                Done{" "}
                {task.doneAt && (
                  <time dateTime={task.doneAt}>
                    {formatInPht(task.doneAt, DONE_FORMAT)}
                  </time>
                )}
              </span>
            ) : (
              <span>
                {task.overdue && "Overdue · "}
                <time dateTime={task.dueAt}>
                  {formatInPht(task.dueAt, DUE_FORMAT)}
                </time>
              </span>
            )}
          </p>
          {task.assignees.length > 0 && (
            <>
              <span className="sr-only">
                Assigned to{" "}
                {task.assignees
                  .map((a) =>
                    a.handedBack ? `${a.name} (handed back)` : a.name
                  )
                  .join(", ")}
              </span>
              <div aria-hidden="true" className="flex shrink-0 items-center">
                {shown.map((assignee) => (
                  <span
                    key={assignee.id}
                    className="relative -ml-1.5 first:ml-0"
                  >
                    <Avatar
                      data-avatar={avatarSlot(assignee.id)}
                      data-handed-back={assignee.handedBack ? "" : undefined}
                      className={cn(
                        "size-[26px] ring-2 ring-card",
                        assignee.handedBack &&
                          "outline-2 outline-offset-0 outline-status-attention outline-dashed"
                      )}
                    >
                      <AvatarFallback className="bg-(--avatar) text-[10px] font-semibold text-white">
                        {assignee.initials}
                      </AvatarFallback>
                    </Avatar>
                    {assignee.handedBack && (
                      <span className="absolute -right-0.5 -bottom-0.5 flex size-3.5 items-center justify-center rounded-full bg-status-attention-text text-white ring-1 ring-card">
                        <CornerUpLeft aria-hidden className="size-2.5" />
                      </span>
                    )}
                  </span>
                ))}
                {extra > 0 && (
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    +{extra}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {children}
    </article>
  )
}
