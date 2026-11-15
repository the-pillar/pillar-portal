"use client"

import { useRef, useState } from "react"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

export type FilterChipData = {
  /** The chip's key and what `onChange` receives. */
  value: string
  label: string
  count: number
}

/**
 * Filter chips (EXPERIENCE.md › Filter chips): one row of pills in a radio
 * group named "Filter tasks", each named like "Layout, 4 tasks". The active
 * chip is navy with a check. Choosing one calls `onChange` on the same frame,
 * and a polite status then reads "Showing 4 tasks in Layout." Focus is a
 * roving tabindex: Tab enters on the active chip, the arrow keys (and Home
 * and End) move focus between chips, and Space or Enter chooses the focused
 * one, so passing over a chip adds no history entry. Below `lg` the row
 * scrolls sideways with a fade at its right edge; from `lg` it wraps.
 * Client-safe and free of Board code, so the Planner (8.7) can reuse it.
 */
export function BoardFilterChips({
  chips,
  value,
  onChange,
}: {
  chips: readonly FilterChipData[]
  value: string
  onChange: (value: string) => void
}) {
  const [status, setStatus] = useState("")
  const refs = useRef(new Map<string, HTMLButtonElement>())
  const tabStop = chips.some((chip) => chip.value === value)
    ? value
    : chips[0]?.value

  function choose(chip: FilterChipData) {
    onChange(chip.value)
    const tasks = `${chip.count} ${chip.count === 1 ? "task" : "tasks"}`
    setStatus(
      chip.label === "All"
        ? `Showing ${tasks}.`
        : `Showing ${tasks} in ${chip.label}.`
    )
  }

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const last = chips.length - 1
    const target =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? Math.min(index + 1, last)
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? Math.max(index - 1, 0)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null
    if (target === null) return
    event.preventDefault()
    refs.current.get(chips[target].value)?.focus()
  }

  return (
    <div>
      <div
        role="radiogroup"
        aria-label="Filter tasks"
        className="flex gap-2 overflow-x-auto [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] p-row-padding pr-8 lg:flex-wrap lg:overflow-visible lg:[mask-image:none] lg:pr-1"
      >
        {chips.map((chip, index) => {
          const active = chip.value === value
          return (
            <button
              key={chip.value}
              ref={(node) => {
                if (node) refs.current.set(chip.value, node)
                else refs.current.delete(chip.value)
              }}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={chip.value === tabStop ? 0 : -1}
              onClick={() => choose(chip)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                "relative inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border-[1.5px] px-3 text-sm font-medium transition-transform duration-(--motion-press) ease-(--ease-out) after:absolute after:inset-x-0 after:-inset-y-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-(--motion-press-scale-chip)",
                active
                  ? "border-navy bg-navy text-white"
                  : "border-chip-edge bg-white text-navy"
              )}
            >
              {active && <Check aria-hidden className="size-4" />}
              <span>{chip.label}</span>
              <span aria-hidden className="tabular-nums opacity-70">
                {chip.count}
              </span>
              <span className="sr-only">
                , {chip.count} {chip.count === 1 ? "task" : "tasks"}
              </span>
            </button>
          )
        })}
      </div>
      <p role="status" className="sr-only">
        {status}
      </p>
    </div>
  )
}
