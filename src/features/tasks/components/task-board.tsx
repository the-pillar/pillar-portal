"use client"

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
} from "react"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { Ban } from "lucide-react"
import { useSearchParams } from "next/navigation"

import { toast } from "@/components/ui/toast"
import { scrollBehavior } from "@/lib/reduced-motion"
import { useCommand, type CommandParams } from "@/lib/use-command"
import { cn } from "@/lib/utils"

import {
  markDoneAction,
  moveTaskAction,
  reopenTaskAction,
  type MarkDoneState,
  type MoveTaskState,
} from "../actions"
import {
  BOARD_ROW_HEIGHT,
  boardEmptyMessage,
  boardFilterChips,
  matchesFilter,
  ownerFilterParam,
  parseOwnerFilterParam,
  type OwnerFilter,
  type TaskOwnerOption,
} from "../board"
import {
  BOARD_KEYBOARD_CODES,
  BOARD_SCREEN_READER_INSTRUCTIONS,
  boardCollisionDetection,
  columnJumpCoordinates,
  createBoardAnnouncements,
  dropColumn,
} from "../board-dnd"
import { highlightedIds } from "../board-highlights"
import { pushBoardParams, replaceBoardParams } from "../board-url"
import {
  taskErrorMessage,
  undoStaleMessage,
  type TaskErrorCode,
} from "../errors"
import type { BoardCard } from "../queries/board"
import { TASK_COLUMN_LABELS, TASK_COLUMNS, type TaskColumn } from "../status"
import { BoardColumnSwitcher } from "./board-column-switcher"
import { BoardFilterChips } from "./board-filter-chips"
import { TaskCard } from "./task-card"

type HowMoved = "menu" | "drag" | "keyboard"

const EMPTY_COLUMN: Record<TaskColumn, { line: string; hint?: string }> = {
  to_do: { line: "Nothing to start." },
  doing: { line: "Nobody's working on anything here." },
  for_review: {
    line: "Nothing waiting for review.",
    hint: "Cards land here when someone finishes a draft.",
  },
  done: { line: "Nothing done in the last 30 days." },
}

const columnLabel = (column: TaskColumn) => TASK_COLUMN_LABELS[column]

/**
 * The Board in Corkboard: filter chips, the column switcher (below `lg`) and
 * four tan columns in one row. The whole window is loaded once and filtered
 * here, so a chip's counts and result change on the tap's frame; the choice is
 * `owner=` in the URL, written with the native history API and read back with
 * useSearchParams, the server's home scope applying when it is missing or not
 * a filter. Below `lg` each column is 288px and the row snaps column by
 * column; from `lg` the four share the width.
 *
 * A card moves two ways, both offering only its `moves` (AD-4): dragging it
 * (mouse after 8px, touch after a 250ms hold, keyboard with Space on its title
 * link) and "Move to <column>" in its overflow menu (WCAG 2.5.7). Every move
 * is versioned: it passes the `movedAt` the card rendered with, so a stale
 * card is refused. A move to Done (the approver's, a For Review card only)
 * calls `markDoneAction` and toasts "Marked done." with Reopen; any other
 * move toasts "Moved to <column>." with Undo for 5 seconds, which moves the
 * card back carrying the version that move returned. The card changes column
 * at once; a refusal puts it back, toasts why and refreshes. One move saves at
 * a time: meanwhile no card offers a move and drag is off.
 *
 * Someone else's move or new task highlights once, found by comparing each
 * refetch with the last (never from a Realtime payload). Focus follows the
 * object: after a move it stays on the card in its new column, after a refetch
 * it returns to the focused card by id, or to its neighbor with a polite
 * message when the card left the filter. Opening a card first writes
 * `column=<col>&focus=<id>` to the URL, so Back restores both.
 *
 * dnd-kit stops the click that ends a mouse or touch drag from propagating,
 * but not its default action: released over the card's own title link, the
 * browser would still follow it. So a pointer drag swallows that one click.
 */
export function TaskBoard({
  cards,
  owners,
  viewerId,
  homeFilter,
}: {
  cards: BoardCard[]
  owners: TaskOwnerOption[]
  viewerId: string
  /** The server-resolved home scope, used when `owner` is missing or invalid. */
  homeFilter: OwnerFilter
}) {
  const searchParams = useSearchParams()
  const urlOwner = searchParams.get("owner")
  const [ownerParam, setOwnerParam] = useState(urlOwner)
  const [seenOwner, setSeenOwner] = useState(urlOwner)
  if (urlOwner !== seenOwner) {
    // Back, Forward or a link changed the URL.
    setSeenOwner(urlOwner)
    setOwnerParam(urlOwner)
  }
  const filter = useMemo(
    () => parseOwnerFilterParam(ownerParam, owners) ?? homeFilter,
    [ownerParam, owners, homeFilter]
  )

  // The mode decides which stale copy a refusal gets.
  const mode = useRef<"move" | "undo">("move")
  const { isPending, run } = useCommand<TaskErrorCode>({
    errorMessage: (code, params?: CommandParams) =>
      mode.current === "undo" && code === "tasks.stale"
        ? undoStaleMessage(params)
        : taskErrorMessage(code, params),
    thrownCode: "tasks.save_failed",
  })
  const runRef = useRef(run)
  useEffect(() => {
    runRef.current = run
  })

  const [shownCards, applyMove] = useOptimistic(
    cards,
    (
      state: BoardCard[],
      move: { taskId: string; toColumn: TaskColumn }
    ): BoardCard[] =>
      state.map((card) =>
        card.id === move.taskId
          ? {
              ...card,
              column: move.toColumn,
              overdue: move.toColumn === "done" ? false : card.overdue,
              // Every move clears the revision note.
              sentBack: false,
            }
          : card
      )
  )
  const visible = useMemo(
    () => shownCards.filter((card) => matchesFilter(card, filter)),
    [shownCards, filter]
  )
  const chips = useMemo(
    () =>
      boardFilterChips(
        shownCards,
        owners,
        filter,
        homeFilter.kind === "articles"
      ),
    [shownCards, owners, filter, homeFilter]
  )

  const [activeId, setActiveId] = useState<string | null>(null)
  const [overColumn, setOverColumn] = useState<TaskColumn | null>(null)
  const [landedId, setLandedId] = useState<string | null>(null)
  const [inView, setInView] = useState<TaskColumn>(TASK_COLUMNS[0])
  const [message, setMessage] = useState("")
  const rootRef = useRef<HTMLDivElement>(null)
  const lastMoved = useRef<string | null>(null)
  const releaseClickGuard = useRef<(() => void) | null>(null)
  const restoringUntil = useRef(0)

  // Highlights: compare each refetch with the one before (never the first
  // render, never an optimistic change, never a payload).
  const [previousCards, setPreviousCards] = useState(cards)
  const [highlighted, setHighlighted] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  // A filter change drops pending highlights: they were for cards the new
  // filter may show only later.
  const filterKey = ownerFilterParam(filter)
  const [seenFilterKey, setSeenFilterKey] = useState(filterKey)
  if (filterKey !== seenFilterKey) {
    setSeenFilterKey(filterKey)
    setHighlighted(new Set())
  }
  if (cards !== previousCards) {
    setPreviousCards(cards)
    const ids = highlightedIds(previousCards, cards, viewerId).filter((id) =>
      cards.some((card) => card.id === id && matchesFilter(card, filter))
    )
    if (ids.length > 0) setHighlighted(new Set([...highlighted, ...ids]))
  }

  // Focus: the card that holds focus, and who is next to it.
  const focused = useRef<{
    id: string
    title: string
    column: TaskColumn | null
    neighbor: string | null
  } | null>(null)

  useEffect(() => () => releaseClickGuard.current?.(), [])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      keyboardCodes: BOARD_KEYBOARD_CODES,
      coordinateGetter: columnJumpCoordinates,
    })
  )

  const announcements = useMemo(
    () =>
      createBoardAnnouncements(
        (id) => shownCards.find((card) => card.id === id)?.title ?? "the task"
      ),
    [shownCards]
  )

  const cardLink = (id: string) =>
    rootRef.current?.querySelector<HTMLElement>(
      `[data-card-id="${id}"] a[href^="/dashboard/tasks/"]`
    )

  // No dependency list on purpose: it runs after every commit, and the one
  // state update inside is guarded by the lost focus it just repaired.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const active = document.activeElement
    const lostFocus = !active || active === document.body

    const moved = lastMoved.current
    if (moved && lostFocus) cardLink(moved)?.focus()
    // Once a render with nothing saving has run the check, the move is over:
    // the remount into the new column and the rollback remount are both done.
    if (moved && !isPending) lastMoved.current = null

    const last = focused.current
    if (!last || moved || !lostFocus) return
    if (cardLink(last.id)) {
      cardLink(last.id)?.focus()
      return
    }
    // The card left the filter (or the window): its neighbor takes focus.
    const neighbor = last.neighbor ? cardLink(last.neighbor) : null
    if (neighbor) neighbor.focus()
    else rootRef.current?.focus()
    const now = shownCards.find((card) => card.id === last.id)
    if (now && now.column !== last.column) {
      // Once per lost focus: the next render finds focus on the neighbor.
      setMessage(
        `${last.title} moved to ${columnLabel(now.column)} by ${now.movedByName ?? "someone"}.`
      )
    }
  })

  function noteFocus(event: React.FocusEvent) {
    const item = (event.target as HTMLElement).closest<HTMLElement>(
      "li[data-card-id]"
    )
    if (!item) {
      focused.current = null
      return
    }
    const neighbor = (item.nextElementSibling ??
      item.previousElementSibling) as HTMLElement | null
    focused.current = {
      id: item.dataset.cardId ?? "",
      title: item.querySelector("h3")?.textContent ?? "the task",
      column:
        shownCards.find((card) => card.id === item.dataset.cardId)?.column ??
        null,
      neighbor: neighbor?.dataset.cardId ?? null,
    }
  }

  function noteBlur(event: React.FocusEvent) {
    const target = event.target
    const next = event.relatedTarget as Node | null
    if (next !== null) {
      // Focus left the Board for a chip, a link or a toast.
      if (!rootRef.current?.contains(next)) focused.current = null
      return
    }
    // A removed element is still "blurred"; only a real blur clears.
    queueMicrotask(() => {
      if (target.isConnected) focused.current = null
    })
  }

  // The column in view, below lg: the leftmost one fully visible.
  function updateInView() {
    const row = rootRef.current
    if (!row) return
    const padding = parseFloat(getComputedStyle(row).paddingLeft) || 0
    let found: TaskColumn = TASK_COLUMNS[0]
    for (const section of row.querySelectorAll<HTMLElement>("[data-column]")) {
      if (section.offsetLeft - padding >= row.scrollLeft - 4) {
        found = section.dataset.column as TaskColumn
        break
      }
    }
    if (found === inView) return
    setInView(found)
    if (Date.now() > restoringUntil.current) {
      replaceBoardParams({ column: found })
    }
  }

  function scrollToColumn(column: TaskColumn) {
    const row = rootRef.current
    const section = row?.querySelector<HTMLElement>(`[data-column="${column}"]`)
    if (!row || !section) return
    const padding = parseFloat(getComputedStyle(row).paddingLeft) || 0
    restoringUntil.current = Date.now() + 800
    row.scrollTo?.({
      left: section.offsetLeft - padding,
      behavior: scrollBehavior(),
    })
    setInView(column)
    replaceBoardParams({ column })
    return section
  }

  // Back from Task detail: the column in view, and the card that was opened.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const column = params.get("column") as TaskColumn | null
    if (column && (TASK_COLUMNS as readonly string[]).includes(column)) {
      const row = rootRef.current
      const section = row?.querySelector<HTMLElement>(
        `[data-column="${column}"]`
      )
      if (row && section) {
        const padding = parseFloat(getComputedStyle(row).paddingLeft) || 0
        restoringUntil.current = Date.now() + 800
        row.scrollTo?.({
          left: section.offsetLeft - padding,
          behavior: scrollBehavior(),
        })
        setInView(column)
      }
    }
    const id = params.get("focus")
    if (id) {
      cardLink(id)?.focus()
      replaceBoardParams({ focus: null })
    }
    // Once, on arrival.
  }, [])

  function chooseFilter(value: string) {
    if (value === ownerFilterParam(filter)) return
    setOwnerParam(value)
    pushBoardParams({ owner: value })
  }

  function rememberOpenedCard(event: React.MouseEvent) {
    const link = (event.target as HTMLElement).closest<HTMLElement>(
      'a[href^="/dashboard/tasks/"]'
    )
    const id = link?.closest<HTMLElement>("li[data-card-id]")?.dataset.cardId
    const card = shownCards.find((c) => c.id === id)
    if (card) replaceBoardParams({ column: card.column, focus: card.id })
  }

  // The target decides the command, never who is moving: move_task never
  // enters Done, so mark_done is its only way in.
  function move(card: BoardCard, toColumn: TaskColumn, how: HowMoved) {
    const taskId = card.id
    const from = card.column
    const quiet = how === "keyboard" ? ({ announce: false } as const) : {}
    runRef.current<MoveTaskState | MarkDoneState>(
      () => {
        mode.current = "move"
        lastMoved.current = taskId
        setLandedId(taskId)
        applyMove({ taskId, toColumn })
        return toColumn === "done"
          ? markDoneAction({ taskId })
          : moveTaskAction({
              taskId,
              toColumn,
              expectedMovedAt: card.movedAt,
            })
      },
      {
        onSuccess: (result) => {
          if (toColumn === "done") {
            toast.success("Marked done.", {
              ...quiet,
              action: { label: "Reopen", onClick: () => reopen(taskId) },
            })
          } else if ("movedAt" in result.data) {
            const movedAt = result.data.movedAt
            toast.undo(`Moved to ${columnLabel(toColumn)}.`, {
              ...quiet,
              action: {
                label: "Undo",
                onClick: () => undo(taskId, from, movedAt),
              },
            })
          }
        },
      }
    )
  }

  // Undo moves the card back through the same command, carrying the version
  // the move returned, so it never overwrites someone's later move.
  function undo(taskId: string, toColumn: TaskColumn, movedAt: string) {
    runRef.current<MoveTaskState>(
      () => {
        mode.current = "undo"
        lastMoved.current = taskId
        setLandedId(taskId)
        applyMove({ taskId, toColumn })
        return moveTaskAction({ taskId, toColumn, expectedMovedAt: movedAt })
      },
      {
        onSuccess: () => toast(`Moved back to ${columnLabel(toColumn)}.`),
      }
    )
  }

  function reopen(taskId: string) {
    runRef.current(
      () => {
        mode.current = "move"
        lastMoved.current = taskId
        setLandedId(taskId)
        applyMove({ taskId, toColumn: "doing" })
        return reopenTaskAction({ taskId })
      },
      { onSuccess: () => toast("Reopened.") }
    )
  }

  function guardClickAfterDrag() {
    const swallow = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener("click", swallow, { capture: true, once: true })
    releaseClickGuard.current = () =>
      window.removeEventListener("click", swallow, { capture: true })
  }

  // The closing click comes right after the drop, so the guard stays up a
  // moment longer (dnd-kit waits 50ms for the same reason).
  function releaseClickGuardSoon() {
    const release = releaseClickGuard.current
    releaseClickGuard.current = null
    if (release) setTimeout(release, 100)
  }

  function handleDragStart(event: DragStartEvent) {
    if (!(event.activatorEvent instanceof KeyboardEvent)) guardClickAfterDrag()
    setActiveId(String(event.active.id))
    setOverColumn(null)
  }

  function handleDragOver(event: DragOverEvent) {
    const card = shownCards.find((c) => c.id === event.active.id)
    setOverColumn(card ? dropColumn(card.moves, event.over?.id) : null)
  }

  function handleDragEnd(event: DragEndEvent) {
    releaseClickGuardSoon()
    const card = shownCards.find((c) => c.id === event.active.id)
    setActiveId(null)
    setOverColumn(null)
    if (!card) return
    const toColumn = dropColumn(card.moves, event.over?.id)
    if (toColumn) {
      move(
        card,
        toColumn,
        event.activatorEvent instanceof KeyboardEvent ? "keyboard" : "drag"
      )
    }
  }

  function handleDragCancel() {
    releaseClickGuardSoon()
    setActiveId(null)
    setOverColumn(null)
  }

  const activeCard = shownCards.find((card) => card.id === activeId)
  const counts = Object.fromEntries(
    TASK_COLUMNS.map((column) => [
      column,
      visible.filter((card) => card.column === column).length,
    ])
  ) as Record<TaskColumn, number>
  const emptyMessage = boardEmptyMessage(filter, owners)
  const firstRun = cards.length === 0
  const filterEmpty = !firstRun && visible.length === 0 && emptyMessage !== null

  return (
    <div>
      <BoardFilterChips
        chips={chips}
        value={ownerFilterParam(filter)}
        onChange={chooseFilter}
      />
      <BoardColumnSwitcher
        counts={counts}
        active={inView}
        onSelect={(column) =>
          scrollToColumn(column)
            ?.querySelector<HTMLElement>("h2")
            ?.focus({ preventScroll: true })
        }
      />
      <p role="status" className="sr-only">
        {message}
      </p>
      {firstRun ? (
        <BoardFirstRun />
      ) : filterEmpty ? (
        <div className="mt-4 text-muted-foreground">
          <h2 className="text-heading-sm">{emptyMessage}</h2>
          <button
            type="button"
            onClick={() => chooseFilter("all")}
            className="mt-1 inline-flex min-h-11 items-center rounded-sm text-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
          >
            Show all
          </button>
        </div>
      ) : (
        <DndContext
          id="task-board"
          sensors={sensors}
          collisionDetection={boardCollisionDetection}
          accessibility={{
            announcements,
            screenReaderInstructions: {
              draggable: BOARD_SCREEN_READER_INSTRUCTIONS,
            },
          }}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div
            ref={rootRef}
            role="region"
            aria-label="Board columns"
            tabIndex={0}
            onScroll={updateInView}
            onFocus={noteFocus}
            onBlur={noteBlur}
            onClickCapture={rememberOpenedCard}
            className={cn(
              // relative: the row must be the containing block of the
              // absolutely positioned sr-only text inside it, or that text
              // escapes the row's clipping and widens the whole page.
              "relative mt-2 flex gap-column-gap overflow-x-auto overscroll-x-contain rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden focus-visible:ring-inset",
              BOARD_ROW_HEIGHT,
              // Below lg the row bleeds to the screen edge and snaps column
              // by column (not while dragging, so auto-scroll isn't snapped
              // back).
              "-mx-page-margin-mobile scroll-px-page-margin-mobile px-page-margin-mobile md:-mx-page-margin-desktop md:scroll-px-page-margin-desktop md:px-page-margin-desktop",
              activeId ? "snap-none" : "snap-x snap-mandatory",
              "lg:mx-0 lg:snap-none lg:scroll-px-0 lg:px-0"
            )}
          >
            {TASK_COLUMNS.map((column) => (
              <BoardColumn
                key={column}
                column={column}
                cards={visible.filter((card) => card.column === column)}
                activeCard={activeCard}
                isOver={overColumn === column}
                isPending={isPending}
                landedId={landedId}
                highlighted={highlighted}
                onMove={move}
                onAnimationEnd={(id) => {
                  setHighlighted((set) => {
                    if (!set.has(id)) return set
                    const next = new Set(set)
                    next.delete(id)
                    return next
                  })
                  setLandedId((was) => (was === id ? null : was))
                }}
              />
            ))}
          </div>

          <DragOverlay
            dropAnimation={null}
            className={overColumn ? "cursor-grabbing" : "cursor-not-allowed"}
          >
            {activeCard ? (
              // inert hit-tests like pointer-events: none, so the cursor
              // comes from the overlay wrapper above.
              <div inert className="card-dragging">
                <TaskCard task={activeCard} showStatus={false} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  )
}

function BoardFirstRun() {
  return (
    <div className="mt-4 flex flex-col items-center gap-2 rounded-xl bg-muted px-4 py-10 text-center">
      <div
        aria-hidden="true"
        className="w-full max-w-64 rounded-lg border-2 border-dashed border-input p-3 text-left"
      >
        <div className="h-3 w-16 rounded-xs bg-input/40" />
        <div className="mt-2 h-4 w-40 rounded-xs bg-input/40" />
        <div className="mt-3 h-3 w-24 rounded-xs bg-input/40" />
      </div>
      <h2 className="text-heading-sm">No tasks yet.</h2>
      <p className="text-muted-foreground">
        Tasks the Editorial Board creates show up here, one card per piece of
        work.
      </p>
    </div>
  )
}

function BoardColumn({
  column,
  cards,
  activeCard,
  isOver,
  isPending,
  landedId,
  highlighted,
  onMove,
  onAnimationEnd,
}: {
  column: TaskColumn
  cards: BoardCard[]
  activeCard: BoardCard | undefined
  isOver: boolean
  isPending: boolean
  landedId: string | null
  highlighted: ReadonlySet<string>
  onMove: (card: BoardCard, toColumn: TaskColumn, how: HowMoved) => void
  onAnimationEnd: (id: string) => void
}) {
  // A column takes a drop only while a card that may move there is held.
  const accepts = !!activeCard && activeCard.moves.includes(column)
  const refuses = !!activeCard && !accepts && activeCard.column !== column
  const { setNodeRef } = useDroppable({ id: column, disabled: !accepts })
  const headingId = `board-column-${column}`
  const empty = EMPTY_COLUMN[column]

  return (
    <section
      ref={setNodeRef}
      data-column={column}
      aria-labelledby={headingId}
      className={cn(
        "flex h-full w-72 shrink-0 snap-start flex-col rounded-xl bg-muted lg:w-auto lg:min-w-0 lg:flex-1",
        accepts &&
          "outline-2 -outline-offset-2 outline-navy " +
            (isOver ? "outline-solid" : "outline-dashed")
      )}
    >
      <h2
        id={headingId}
        tabIndex={-1}
        className="flex items-center justify-between gap-2 px-3 pt-3 pb-2 font-heading text-column-head focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span>{TASK_COLUMN_LABELS[column]}</span>
        <span
          aria-hidden="true"
          className="rounded-full bg-white px-2 text-sm font-normal text-list-ink tabular-nums"
        >
          {cards.length}
        </span>
        <span className="sr-only">
          , {cards.length} {cards.length === 1 ? "task" : "tasks"}
        </span>
      </h2>
      {refuses && (
        <p className="flex items-center gap-1.5 px-3 pb-2 text-sm text-list-ink">
          <Ban aria-hidden className="size-4" />
          Can&apos;t move here
        </p>
      )}
      {cards.length === 0 ? (
        <div className="px-3 pb-3 text-sm text-muted-foreground">
          <p>{empty.line}</p>
          {empty.hint && <p>{empty.hint}</p>}
        </div>
      ) : (
        <ul
          className={cn(
            "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 pt-0",
            refuses && "opacity-50"
          )}
        >
          {cards.map((card) => (
            <BoardCardItem
              key={card.id}
              card={card}
              isPending={isPending}
              landed={landedId === card.id}
              highlighted={highlighted.has(card.id)}
              onMove={onMove}
              onAnimationEnd={onAnimationEnd}
            />
          ))}
        </ul>
      )}
      {column === "done" && (
        // getBoard reads only this window, so the count above is these cards.
        <p className="px-3 pb-3 text-sm text-muted-foreground">
          Showing tasks done in the last 30 days.
        </p>
      )}
    </section>
  )
}

function BoardCardItem({
  card,
  isPending,
  landed,
  highlighted,
  onMove,
  onAnimationEnd,
}: {
  card: BoardCard
  isPending: boolean
  landed: boolean
  highlighted: boolean
  onMove: (card: BoardCard, toColumn: TaskColumn, how: HowMoved) => void
  onAnimationEnd: (id: string) => void
}) {
  const movable = card.moves.length > 0
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } =
    useDraggable({ id: card.id, disabled: isPending || !movable })

  // Only the title link joins the drag wiring, and only on a movable card:
  // role="button"/tabIndex on the <li> would wrap a link and a button in a
  // focusable button (axe's nested-interactive).
  const titleLinkProps = movable
    ? {
        ref: setActivatorNodeRef,
        "aria-describedby": attributes["aria-describedby"],
        draggable: false,
      }
    : undefined

  return (
    <li
      ref={setNodeRef}
      data-card-id={card.id}
      data-highlight={highlighted ? "" : undefined}
      data-landed={landed ? "" : undefined}
      onAnimationEnd={(event) => {
        // Animation events bubble through portals (the card's menu).
        if (event.target === event.currentTarget) onAnimationEnd(card.id)
      }}
      {...listeners}
      className={cn(
        "touch-manipulation select-none [-webkit-touch-callout:none]",
        isDragging && "opacity-40"
      )}
    >
      <TaskCard
        task={card}
        showStatus={false}
        titleLinkProps={titleLinkProps}
        // A card saving offers no move.
        moves={isPending ? [] : card.moves}
        onMove={(toColumn) => onMove(card, toColumn, "menu")}
      />
    </li>
  )
}
