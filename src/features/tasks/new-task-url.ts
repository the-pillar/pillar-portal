// The New task sheet's URL (Story 8.8): `new=task`, `new_owner` (the owner
// filter's `section:<id>` / `desk:<id>`) and `new_due` (`YYYY-MM-DD`), apart
// from the Board's `owner`. Opening pushes a history entry so Back closes the
// sheet; closing goes back when this page pushed it, else rewrites the entry.
// The parsing is client-safe and pure; the writers are client only.
import { phtInputToUtc } from "@/lib/time"

import { parseOwnerFilterParam, type TaskOwnerOption } from "./board"
import { pushBoardParams, replaceBoardParams } from "./board-url"

export const NEW_PARAM = "new"
export const NEW_OWNER_PARAM = "new_owner"
export const NEW_DUE_PARAM = "new_due"

const DAY = /^[1-9]\d{3}-\d{2}-\d{2}$/

/** `new_due` as the form's due value (that day at 5:00 PM PHT), or null. */
export function parseNewDue(value: unknown): string | null {
  if (typeof value !== "string" || !DAY.test(value)) return null
  const input = `${value}T17:00`
  try {
    phtInputToUtc(input)
  } catch {
    return null
  }
  return input
}

/** A section or desk among `owners` as `kind:id`, or null (All, Mine, junk). */
export function parseOwnerChoice(
  value: unknown,
  owners: readonly TaskOwnerOption[]
): string | null {
  const filter = parseOwnerFilterParam(value, [...owners])
  if (filter?.kind === "section" || filter?.kind === "desk") {
    return `${filter.kind}:${filter.id}`
  }
  return null
}

export type NewTaskPrefill = {
  /** `section:<id>` / `desk:<id>`, or "" for none. */
  owner: string
  /** A `datetime-local` value, or "" for none. */
  dueAt: string
}

type Params = { get(name: string): string | null }

/** Whether the URL asks for the sheet. */
export function isNewTaskRequested(params: Params): boolean {
  return params.get(NEW_PARAM) === "task"
}

/**
 * What opens prefilled: the owner is a valid `new_owner`; else the URL's
 * `owner` when it names a section or desk among `owners`; else the viewer's
 * home scope when it is one; else none. A bad `new_due` is ignored.
 */
export function resolveNewTaskPrefill(
  params: Params,
  owners: readonly TaskOwnerOption[],
  homeOwner: string | null
): NewTaskPrefill {
  return {
    owner:
      parseOwnerChoice(params.get(NEW_OWNER_PARAM), owners) ??
      parseOwnerChoice(params.get("owner"), owners) ??
      parseOwnerChoice(homeOwner, owners) ??
      "",
    dueAt: parseNewDue(params.get(NEW_DUE_PARAM)) ?? "",
  }
}

// Whether this page, not a link or a refresh, pushed the sheet's entry.
let pushedHere = false

/** Opens the sheet: a new history entry carrying the prefills. */
export function openNewTask(prefill: { owner?: string; due?: string } = {}) {
  pushedHere = true
  pushBoardParams({
    [NEW_PARAM]: "task",
    [NEW_OWNER_PARAM]: prefill.owner ?? null,
    [NEW_DUE_PARAM]: prefill.due ?? null,
  })
}

/** Closes the sheet: back when this page pushed it, else the same entry without the parameters. */
export function closeNewTask() {
  if (pushedHere) {
    pushedHere = false
    window.history.back()
    return
  }
  replaceBoardParams({
    [NEW_PARAM]: null,
    [NEW_OWNER_PARAM]: null,
    [NEW_DUE_PARAM]: null,
  })
}

/** The sheet's entry was left (Back, Forward): nothing of ours remains to pop. */
export function noteNewTaskLeft() {
  pushedHere = false
}

/** Back while the form is dirty: put the entry back so the sheet stays and asks. */
export function restoreNewTaskEntry(raw: {
  owner: string | null
  due: string | null
}) {
  pushedHere = true
  pushBoardParams({
    [NEW_PARAM]: "task",
    [NEW_OWNER_PARAM]: raw.owner,
    [NEW_DUE_PARAM]: raw.due,
  })
}
