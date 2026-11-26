// The task form's due presets (Story 8.8): one tap sets the due field to a
// Philippine wall-clock 5:00 PM. Client-safe; every day computation goes
// through src/lib/time.ts.
import { dayOfWeek, phtDayKey, shiftDay } from "@/lib/time"

export type DuePreset = {
  label: string
  /** A `datetime-local` value in PHT. */
  value: string
}

const FRIDAY = 5

/**
 * Today 5 PM, Tomorrow 5 PM and the coming Friday 5 PM, which becomes Next
 * Friday 5 PM when today or tomorrow is itself a Friday (so it never repeats
 * one of the first two).
 */
export function duePresets(now: Date): DuePreset[] {
  const today = phtDayKey(now)
  const weekday = dayOfWeek(today)
  const at = (day: string) => `${day}T17:00`

  const clash = weekday === FRIDAY || weekday === FRIDAY - 1
  const ahead = clash ? 7 + (FRIDAY - weekday) : (FRIDAY - weekday + 7) % 7
  return [
    { label: "Today 5 PM", value: at(today) },
    { label: "Tomorrow 5 PM", value: at(shiftDay(today, 1)) },
    {
      label: clash ? "Next Friday 5 PM" : "Friday 5 PM",
      value: at(shiftDay(today, ahead)),
    },
  ]
}
