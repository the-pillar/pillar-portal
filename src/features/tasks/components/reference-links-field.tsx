"use client"

import { Plus, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import {
  useWatch,
  type Control,
  type FieldErrors,
  type UseFormClearErrors,
  type UseFormSetValue,
  type UseFormTrigger,
} from "react-hook-form"

import { Button } from "@/components/ui/button"
import { FieldError, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import {
  LINKS_MAX,
  linkError,
  normalizeLink,
  placeLinks,
  shortLink,
  splitLinks,
} from "../links"
import { siteLabel } from "../site-label"
import type { TaskFormValues } from "./task-form"

type Focus = { row: number } | "add"

function plural(count: number): string {
  return count === 1 ? "1 link" : `${count} links`
}

/**
 * The Reference links field (EXPERIENCE.md › Reference links field): a
 * fieldset of one input per link, up to five. Links pasted together, with
 * spaces or new lines between them, are split on paste and again on blur, the
 * first staying in its row and the rest filling the empty rows below, then
 * new rows; a filled row is never overwritten. On blur a row shows its
 * cleaned address and its error. Empty rows are dropped on save, by the form's
 * resolver, not here.
 *
 * `loaded` is the edit form's links as saved: one left unchanged is never
 * cleaned or refused.
 */
export function ReferenceLinksField({
  idPrefix,
  control,
  setValue,
  trigger,
  clearErrors,
  errors,
  loaded = [],
}: {
  idPrefix: string
  control: Control<TaskFormValues>
  setValue: UseFormSetValue<TaskFormValues>
  trigger: UseFormTrigger<TaskFormValues>
  clearErrors: UseFormClearErrors<TaskFormValues>
  errors: FieldErrors<TaskFormValues>
  loaded?: readonly string[]
}) {
  const rows: string[] = useWatch({ control, name: "referenceUrls" }) ?? []
  const inputs = useRef<(HTMLInputElement | null)[]>([])
  const addButton = useRef<HTMLButtonElement | null>(null)
  // Where focus goes once the render that adds or removes a row has landed.
  const pendingFocus = useRef<Focus | null>(null)
  const [announcement, setAnnouncement] = useState("")
  const [note, setNote] = useState("")

  const helperId = `${idPrefix}-reference-links-helper`
  const rootError = errors.referenceUrls?.root
  const rootId = `${idPrefix}-reference-links-error`
  const noteId = `${idPrefix}-reference-links-note`

  useEffect(() => {
    const target = pendingFocus.current
    if (target === null) return
    pendingFocus.current = null
    if (target === "add") addButton.current?.focus()
    else inputs.current[target.row]?.focus()
  })

  function write(next: string[], validate: number[] = []) {
    setValue("referenceUrls", next, { shouldDirty: true })
    if (validate.length > 0) {
      void trigger(validate.map((index) => `referenceUrls.${index}` as const))
    }
  }

  function spread(index: number, links: string[]) {
    const { rows: next, placed, leftOut } = placeLinks(rows, index, links)
    write(
      next,
      next.flatMap((row, i) => (row !== "" ? [i] : []))
    )
    setAnnouncement(`Added ${plural(placed)}.`)
    setNote(
      leftOut.length === 0
        ? ""
        : `${plural(leftOut.length)} didn't fit: ${leftOut
            .map(shortLink)
            .join(", ")}. A task holds up to ${LINKS_MAX}.`
    )
  }

  function change(index: number, value: string) {
    const next = [...rows]
    next[index] = value
    setValue("referenceUrls", next, { shouldDirty: true })
    // Once a row has an error it re-checks as it is typed in.
    if (errors.referenceUrls?.[index]) {
      void trigger(`referenceUrls.${index}`)
    }
  }

  function paste(index: number, event: React.ClipboardEvent<HTMLInputElement>) {
    const field = event.currentTarget
    const text = event.clipboardData.getData("text")
    const value = rows[index] ?? ""
    const start = field.selectionStart ?? value.length
    const end = field.selectionEnd ?? value.length
    const links = splitLinks(value.slice(0, start) + text + value.slice(end))
    if (links.length < 2) return
    event.preventDefault()
    spread(index, links)
  }

  // Voice input and keyboard clipboard chips send no paste event, so a blur
  // splits too; a single link is cleaned.
  function blur(index: number) {
    const value = rows[index] ?? ""
    // A link that loaded with the form and is unchanged is left exactly as is.
    if (loaded.includes(value)) return
    const links = splitLinks(value)
    if (links.length > 1) {
      spread(index, links)
      return
    }
    if (value.trim() === "") {
      if (value !== "") write(rows.map((row, i) => (i === index ? "" : row)))
      return
    }
    const cleaned = normalizeLink(value)
    write(
      rows.map((row, i) => (i === index ? cleaned : row)),
      [index]
    )
  }

  function add() {
    setNote("")
    write([...rows, ""])
    pendingFocus.current = { row: rows.length }
  }

  function remove(index: number) {
    const next = rows.filter((_, i) => i !== index)
    // Errors are read by index: clear them and re-check the rows that had
    // one, at their new places.
    const errored = rows.flatMap((_, i) =>
      i !== index && errors.referenceUrls?.[i] ? [i > index ? i - 1 : i] : []
    )
    setNote("")
    clearErrors("referenceUrls")
    write(next, errored)
    pendingFocus.current =
      index < next.length
        ? { row: index }
        : index > 0
          ? { row: index - 1 }
          : "add"
  }

  return (
    <FieldSet aria-describedby={helperId}>
      <FieldLegend>
        Reference links{" "}
        <span className="font-normal text-muted-foreground">(optional)</span>
      </FieldLegend>
      <p
        id={helperId}
        className="-mt-1.5 text-sm leading-normal text-muted-foreground"
      >
        Links to the brief, photos or drafts. Up to {LINKS_MAX}.
      </p>

      {rows.map((row, index) => {
        const error = errors.referenceUrls?.[index]
        const errorId = `${idPrefix}-reference-link-${index}-error`
        const cleaned = normalizeLink(row)
        const label =
          row.trim() !== "" && !/\s/.test(row.trim()) && !linkError(cleaned)
            ? siteLabel(cleaned)
            : null
        return (
          <div key={index} className="flex flex-col gap-1">
            <div className="flex items-start gap-2">
              <Input
                ref={(element) => {
                  inputs.current[index] = element
                }}
                id={`${idPrefix}-reference-link-${index}`}
                value={row}
                aria-label={`Reference link ${index + 1}`}
                aria-describedby={`${helperId}${error ? ` ${errorId}` : ""}${note ? ` ${noteId}` : ""}${rootError ? ` ${rootId}` : ""}`}
                aria-invalid={!!error}
                placeholder="Paste a link"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) => change(index, event.target.value)}
                onPaste={(event) => paste(index, event)}
                onBlur={() => blur(index)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove reference link ${index + 1}`}
                // Keeps the row's own blur from validating a row that is
                // about to go, which would land its error after the removal.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => remove(index)}
                className="size-11 shrink-0 text-muted-foreground"
              >
                <X aria-hidden="true" />
              </Button>
            </div>
            {label !== null && (
              <p className="text-sm text-muted-foreground">{label}</p>
            )}
            <FieldError id={errorId} errors={[error]} />
          </div>
        )
      })}

      {rows.length >= LINKS_MAX ? (
        <p className="text-sm text-muted-foreground">
          {LINKS_MAX} of {LINKS_MAX} links
        </p>
      ) : (
        <Button
          ref={addButton}
          type="button"
          variant="ghost"
          onClick={add}
          className="h-11 w-fit text-navy"
        >
          <Plus aria-hidden="true" />
          Add a link
        </Button>
      )}

      <FieldError id={rootId} errors={[rootError]} />

      <p role="status" className="sr-only">
        {announcement}
      </p>
      <p
        id={noteId}
        role="status"
        className="text-sm text-muted-foreground empty:hidden"
      >
        {note}
      </p>
    </FieldSet>
  )
}
