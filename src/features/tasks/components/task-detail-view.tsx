import { Check, Clock } from "lucide-react"
import Link from "next/link"

import { StatusBadge } from "@/components/status-badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { avatarSlot } from "@/components/ui/avatar-slot"
import { clientEnv } from "@/lib/env.client"
import { formatInPht } from "@/lib/time"
import { cn } from "@/lib/utils"

import { buildCalendarEvent, googleCalendarUrl } from "../calendar"
import { buildMessengerMessage } from "../messenger"
import type { ReassignOptions } from "../queries/reassign"
import type { TaskDetail } from "../queries/task-detail"
import { DEFAULT_RETURN_LINK, type ReturnLink } from "../return-link"
import {
  isTaskOverdue,
  SLOT_STATE_FAMILIES,
  SLOT_STATE_LABELS,
} from "../status"
import { AddToCalendarMenu } from "./calendar-menu"
import { CopyForMessenger } from "./copy-for-messenger"
import { HandBack } from "./hand-back"
import { LinkRow } from "./link-row"
import { ReassignSlot } from "./reassign-slot"
import { SlotResponse } from "./slot-response"
import { TaskColumnControl } from "./task-column-control"
import { TaskManage } from "./task-manage"
import { TaskReview } from "./task-review"
import { TASK_STATUS_ID } from "./task-status-id"

const DUE_FORMAT = "EEE, MMM d, yyyy 'at' h:mm a"
const DONE_FORMAT = "MMM d"
const NOTE_DATE_FORMAT = "EEE, MMM d, yyyy"

/**
 * Task detail (EXPERIENCE.md › Task detail; the Corkboard mock's order):
 * the return link, the owner label, the title, the due chip (PHT) and column
 * with the viewer's actions after them (below md, one fixed action bar while
 * the viewer holds exactly one open slot), the revision note while the task
 * stands sent back, the description, the approver's actions, one white row
 * per role slot, the reference links, then Add to Google Calendar and Copy
 * for Messenger. Which actions appear
 * comes only from `task.allowedMoves`, `task.respondableSlotIds`,
 * `task.handBackSlotIds`, `task.canReview`, `task.canReopen`,
 * `task.canManage` and `task.canReassign` (task_capabilities, AD-4); nothing
 * here looks at roles, positions, slot states or who holds a slot.
 * `reassignOptions`, the picker's members, comes with `canReassign`: each
 * slot's Reassign needs both.
 */
export function TaskDetailView({
  task,
  reassignOptions,
  onCopied,
  returnLink = DEFAULT_RETURN_LINK,
}: {
  task: TaskDetail
  reassignOptions?: ReassignOptions
  /** Called after any Copy for Messenger that worked (Story 8.9 records it). */
  onCopied?: () => void | Promise<unknown>
  /** Where "‹ <view>" goes, already checked and named by the page. */
  returnLink?: ReturnLink
}) {
  const respondable = new Set(task.respondableSlotIds)
  const handBackable = new Set(task.handBackSlotIds)
  const handBackSlots = task.slots.filter((slot) => handBackable.has(slot.id))
  // The slots the viewer may act on, from task_capabilities alone. Exactly
  // one puts its controls in the action bar; two stay in their rows.
  const openSlots = task.slots.filter(
    (slot) => respondable.has(slot.id) || handBackable.has(slot.id)
  )
  const barSlot = openSlots.length === 1 ? openSlots[0] : null
  const overdue = isTaskOverdue(task.dueAt, task.column)
  const googleUrl = googleCalendarUrl(
    buildCalendarEvent(
      {
        id: task.id,
        title: task.title,
        description: task.description,
        dueAt: task.dueAt,
        referenceUrls: task.referenceUrls,
      },
      clientEnv.NEXT_PUBLIC_SITE_URL
    )
  )

  const message = buildMessengerMessage(
    {
      id: task.id,
      title: task.title,
      roles: task.slots.map((slot) => slot.role),
      dueAt: task.dueAt,
      referenceUrls: task.referenceUrls,
    },
    clientEnv.NEXT_PUBLIC_SITE_URL,
    task.roleLabels
  )

  return (
    <article>
      <Link
        href={returnLink.href}
        className="-ml-1 inline-flex min-h-11 items-center rounded-sm px-1 font-medium text-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span aria-hidden="true">‹&nbsp;</span>
        {returnLink.label}
      </Link>

      <p
        data-owner={task.ownerId}
        className="mt-1 w-fit rounded-xs bg-(--owner) px-2 py-0.5 text-owner-label text-white"
      >
        <span className="sr-only">Owner: </span>
        {task.ownerName}
      </p>

      <h1 className="mt-2 font-heading text-display break-words text-navy">
        {task.title}
      </h1>

      <div className="mt-2">
        <TaskColumnControl
          taskId={task.id}
          column={task.column}
          sentBack={task.revisionNote !== null}
          allowedMoves={task.allowedMoves}
          movedAt={task.movedAt}
          barred={barSlot !== null}
          pairMove={barSlot !== null && !respondable.has(barSlot.id)}
          lead={
            <p
              data-due={
                task.column === "done" ? "done" : overdue ? "overdue" : "open"
              }
              className={cn(
                "inline-flex items-center gap-1 rounded-xs px-2 py-0.5 text-sm tabular-nums",
                task.column === "done"
                  ? "bg-positive-strong text-white"
                  : overdue
                    ? "bg-attention-strong text-white"
                    : "bg-chip-fill text-list-ink"
              )}
            >
              <Clock aria-hidden className="size-3.5 shrink-0" />
              {task.column === "done" ? (
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
                  <span className="sr-only">Due: </span>
                  {overdue && "Overdue · "}
                  <time dateTime={task.dueAt}>
                    {formatInPht(task.dueAt, DUE_FORMAT)}
                  </time>
                </span>
              )}
            </p>
          }
        >
          {barSlot !== null &&
            (respondable.has(barSlot.id) ? (
              <SlotResponse
                slotId={barSlot.id}
                slotLabel={task.roleLabels[barSlot.role]}
                rowId={`slot-${barSlot.id}`}
                className="col-span-2 mt-0"
              />
            ) : (
              <>
                <p className="col-span-2 flex items-center gap-2 font-bold">
                  <span
                    aria-hidden="true"
                    className="check-pop inline-flex size-6 items-center justify-center rounded-full bg-positive-strong text-white"
                  >
                    <Check className="size-3.5" strokeWidth={3} />
                  </span>
                  You&apos;re on it.
                </p>
                <HandBack
                  slotId={barSlot.id}
                  slotLabel={task.roleLabels[barSlot.role]}
                  rowId={`slot-${barSlot.id}`}
                  inBar
                />
              </>
            ))}
        </TaskColumnControl>
      </div>

      {handBackSlots.length > 0 && (
        <p className="mt-2 text-sm text-muted-foreground">
          Can&apos;t take this? Hand it back — your head will reassign it.
        </p>
      )}

      {task.revisionNote !== null && (
        <div className="mt-3 rounded-r-lg border-l-[3px] border-status-attention bg-status-attention-tint px-card-padding py-3">
          <p className="break-words whitespace-pre-line">
            {task.revisionNote.text}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="sr-only">Sent back by </span>
            {task.revisionNote.byName} ·{" "}
            <time dateTime={task.revisionNote.at}>
              {formatInPht(task.revisionNote.at, NOTE_DATE_FORMAT)}
            </time>
          </p>
        </div>
      )}

      {task.description !== null && task.description !== "" && (
        <p className="mt-4 break-words whitespace-pre-line">
          {task.description}
        </p>
      )}

      <TaskReview
        taskId={task.id}
        canReview={task.canReview}
        canReopen={task.canReopen}
        focusTargetId={TASK_STATUS_ID}
      />

      <TaskManage
        taskId={task.id}
        taskTitle={task.title}
        expectedUpdatedAt={task.updatedAt}
        canManage={task.canManage}
        focusTargetId={TASK_STATUS_ID}
      />

      <h2 className="mt-8 font-heading text-heading-sm text-navy">
        Role slots
      </h2>
      <ul className="mt-3 flex flex-col gap-2">
        {task.slots.map((slot) => {
          const roleLabel = task.roleLabels[slot.role]
          // Focus lands here once an answer is saved and SlotResponse goes
          // away, or Reassign goes, so it stays on this slot instead of
          // falling to the page.
          const rowId = `slot-${slot.id}`
          const inBar = barSlot?.id === slot.id
          return (
            <li
              key={slot.id}
              id={rowId}
              tabIndex={-1}
              className="rounded-lg bg-card px-2.5 py-2 shadow-card outline-offset-2 focus-visible:outline-2"
            >
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <Avatar
                  aria-hidden="true"
                  data-avatar={avatarSlot(slot.memberId)}
                  className="size-7"
                >
                  <AvatarFallback className="bg-(--avatar) text-[10px] font-semibold text-white">
                    {slot.initials}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 break-words">
                  <span className="font-semibold">{slot.memberName}</span>
                  <span aria-hidden="true" className="text-muted-foreground">
                    {" "}
                    ·{" "}
                  </span>
                  <span className="sr-only">, </span>
                  {roleLabel}
                </span>
                <StatusBadge
                  className="ml-auto"
                  family={SLOT_STATE_FAMILIES[slot.state]}
                  label={SLOT_STATE_LABELS[slot.state]}
                />
              </div>
              {slot.reason !== null && (
                <p className="mt-1 text-sm break-words text-muted-foreground">
                  Reason: {slot.reason}
                </p>
              )}
              {!inBar && respondable.has(slot.id) && (
                <SlotResponse
                  slotId={slot.id}
                  slotLabel={roleLabel}
                  rowId={rowId}
                />
              )}
              {!inBar && handBackable.has(slot.id) && (
                <div className="mt-3">
                  <HandBack
                    slotId={slot.id}
                    slotLabel={roleLabel}
                    rowId={rowId}
                  />
                </div>
              )}
              {task.canReassign && reassignOptions !== undefined && (
                <div className="mt-3">
                  <ReassignSlot
                    taskId={task.id}
                    taskTitle={task.title}
                    taskDueAt={task.dueAt}
                    taskReferenceUrls={task.referenceUrls}
                    slotId={slot.id}
                    role={slot.role}
                    memberId={slot.memberId}
                    memberName={slot.memberName}
                    stateLabel={SLOT_STATE_LABELS[slot.state]}
                    expectedUpdatedAt={slot.updatedAt}
                    options={reassignOptions}
                    focusTargetId={rowId}
                    fallbackFocusTargetId={TASK_STATUS_ID}
                    onCopied={onCopied}
                  />
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {task.referenceUrls.length > 0 && (
        <>
          <h2 className="mt-8 font-heading text-heading-sm text-navy">
            Reference links
          </h2>
          <ul className="mt-2 flex flex-col">
            {task.referenceUrls.map((url, index) => (
              <li key={`${index}-${url}`} className="min-w-0">
                <LinkRow url={url} />
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-6 flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:gap-3">
        <AddToCalendarMenu taskId={task.id} googleUrl={googleUrl} />
        <CopyForMessenger message={message} onCopied={onCopied} />
      </div>
    </article>
  )
}
