"use client"

import { useState } from "react"

import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PENDING_STYLE } from "@/lib/pending-style"
import { cn } from "@/lib/utils"

import type { OfferedPosition, PositionGroup } from "../position-groups"

/**
 * What the picker is editing: the checked positions and the primary the
 * admin chose. Shared by the Pending card (Story 2.2) and the roster's
 * position editor (Story 5.4), so both pick the same way.
 *
 * `fixed` is a position that is held and can't be changed here (the
 * Editor-in-Chief, who moves only by transfer): it counts as checked, after
 * the offered ones. One checked position is primary by itself; with two or
 * more the chosen one is, until it is unchecked.
 */
export function usePositionChoice({
  groups,
  initialChecked = [],
  initialPrimary = null,
  fixed = null,
}: {
  groups: readonly PositionGroup[]
  initialChecked?: readonly string[]
  initialPrimary?: string | null
  fixed?: OfferedPosition | null
}) {
  const [checked, setChecked] = useState<readonly string[]>(initialChecked)
  const [chosenPrimary, setChosenPrimary] = useState<string | null>(
    initialPrimary
  )

  // The checked positions in the picker's order, whatever order they were
  // checked in.
  const checkedPositions: OfferedPosition[] = [
    ...groups
      .flatMap((group) => group.positions)
      .filter((position) => checked.includes(position.id)),
    ...(fixed ? [fixed] : []),
  ]
  const primary =
    checkedPositions.length === 1
      ? checkedPositions[0].id
      : (checkedPositions.find((position) => position.id === chosenPrimary)
          ?.id ?? null)

  function setPositionChecked(positionId: string, next: boolean) {
    setChecked((current) =>
      next
        ? current.includes(positionId)
          ? current
          : [...current, positionId]
        : current.filter((held) => held !== positionId)
    )
    if (!next && chosenPrimary === positionId) setChosenPrimary(null)
  }

  return {
    checked,
    checkedPositions,
    primary,
    setPositionChecked,
    setChosenPrimary,
  }
}

export type PositionChoice = ReturnType<typeof usePositionChoice>

/**
 * The grouped position picker: one fieldset per group, and a "Primary
 * position" select once two or more are checked. Controlled by
 * `usePositionChoice`. `popupOwner` marks the select's portaled list so the
 * owner's focus fallback treats it as inside. `fixed` shows a held
 * Editor-in-Chief checked and `aria-disabled`: "Moves only by transfer".
 * While `isPending` it changes nothing.
 */
export function PositionPicker({
  idPrefix,
  groups,
  choice,
  fixed = null,
  isPending,
  popupOwner,
}: {
  idPrefix: string
  groups: readonly PositionGroup[]
  choice: PositionChoice
  fixed?: OfferedPosition | null
  isPending: boolean
  popupOwner: string
}) {
  const [primarySelectOpen, setPrimarySelectOpen] = useState(false)
  const { checked, checkedPositions, primary } = choice
  const pending = isPending || undefined
  const primaryId = `${idPrefix}-primary`

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((group) => (
          <fieldset key={group.id} className="flex min-w-0 flex-col">
            <legend className="mb-1 text-sm font-semibold">
              {group.label}
            </legend>
            {group.positions.map((position) => {
              const checkboxId = `${idPrefix}-${position.id}`
              return (
                <div
                  key={position.id}
                  className="flex min-h-11 items-center gap-3"
                >
                  <Checkbox
                    id={checkboxId}
                    checked={checked.includes(position.id)}
                    aria-disabled={pending}
                    className={PENDING_STYLE}
                    onCheckedChange={(value) => {
                      if (!isPending)
                        choice.setPositionChecked(position.id, value === true)
                    }}
                  />
                  <Label
                    htmlFor={checkboxId}
                    className="min-h-11 flex-1 cursor-pointer leading-snug font-normal"
                  >
                    {position.title}
                  </Label>
                </div>
              )
            })}
          </fieldset>
        ))}
        {fixed && (
          <fieldset className="flex min-w-0 flex-col">
            <legend className="mb-1 text-sm font-semibold">
              {fixed.title}
            </legend>
            <div className="flex min-h-11 items-center gap-3">
              <Checkbox
                id={`${idPrefix}-${fixed.id}`}
                checked
                aria-disabled
                aria-describedby={`${idPrefix}-${fixed.id}-note`}
                className="pointer-events-none opacity-60"
              />
              <Label
                htmlFor={`${idPrefix}-${fixed.id}`}
                className="min-h-11 flex-1 leading-snug font-normal"
              >
                {fixed.title}
              </Label>
            </div>
            <p
              id={`${idPrefix}-${fixed.id}-note`}
              className="text-sm text-muted-foreground"
            >
              Moves only by transfer
            </p>
          </fieldset>
        )}
      </div>

      {checkedPositions.length === 1 && (
        <p className="text-sm">Primary position: {checkedPositions[0].title}</p>
      )}
      {checkedPositions.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={primaryId}>Primary position</Label>
          <Select
            value={primary ?? ""}
            open={primarySelectOpen}
            onOpenChange={(next) => setPrimarySelectOpen(next && !isPending)}
            onValueChange={(value) => {
              if (!isPending) choice.setChosenPrimary(value)
            }}
          >
            <SelectTrigger
              id={primaryId}
              aria-disabled={pending}
              className={cn("min-h-11 w-full sm:w-80", PENDING_STYLE)}
            >
              <SelectValue placeholder="Choose one" />
            </SelectTrigger>
            <SelectContent data-popup-owner={popupOwner}>
              {checkedPositions.map((position) => (
                <SelectItem
                  key={position.id}
                  value={position.id}
                  className="min-h-11"
                >
                  {position.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </>
  )
}
