"use client"

import { useRef, type PointerEvent as ReactPointerEvent } from "react"

// The New task sheet is a bottom sheet only below `md`; from `md` it is a
// panel from the right, which a downward swipe shouldn't move.
const BOTTOM_SHEET_QUERY = "(max-width: 767px)"
// A release past this share of the sheet's height closes it…
const CLOSE_SHARE = 0.25
// …and so does a flick: this fast (px/ms) in its last moment, and this far.
const FLICK_SPEED = 0.5
const FLICK_MIN = 24

type Drag = {
  pointerId: number
  startY: number
  lastY: number
  lastT: number
  speed: number
  dy: number
}

/**
 * Swipe down to close a bottom sheet (Story 8.8): the handlers go on the
 * sheet's grab strip (handle and header), the ref on the sheet itself. The
 * sheet follows the finger downward; a release past a quarter of its height,
 * or a quick flick down, calls `onSwipe`, which answers whether the sheet is
 * closing (false when it asks to discard first). Otherwise the sheet springs
 * back. A press that starts on a button (the close button) is left alone.
 * The transform is written straight to the element, so a drag never
 * re-renders the form.
 */
export function useSwipeDown<T extends HTMLElement>(onSwipe: () => boolean) {
  const sheetRef = useRef<T | null>(null)
  const drag = useRef<Drag | null>(null)

  function springBack() {
    const sheet = sheetRef.current
    if (!sheet) return
    sheet.style.transition =
      "transform var(--motion-sheet-out) var(--ease-drawer)"
    sheet.style.transform = ""
  }

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return
    if (event.target instanceof Element && event.target.closest("button")) {
      return
    }
    if (!window.matchMedia(BOTTOM_SHEET_QUERY).matches) return
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      lastT: event.timeStamp,
      speed: 0,
      dy: 0,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    if (sheetRef.current) sheetRef.current.style.transition = "none"
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    // A pause or a move back up cancels a flick.
    const delta = event.clientY - current.lastY
    const elapsed = event.timeStamp - current.lastT
    if (delta <= 0) current.speed = 0
    else if (elapsed > 0) current.speed = delta / elapsed
    current.lastY = event.clientY
    current.lastT = event.timeStamp
    current.dy = Math.max(0, event.clientY - current.startY)
    if (sheetRef.current) {
      sheetRef.current.style.transform =
        current.dy > 0 ? `translateY(${current.dy}px)` : ""
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    drag.current = null
    const height = sheetRef.current?.offsetHeight ?? 0
    const far = height > 0 && current.dy > height * CLOSE_SHARE
    const flick = current.speed > FLICK_SPEED && current.dy > FLICK_MIN
    // Closing leaves the sheet where the finger left it: its exit animation
    // runs on from there to the bottom edge.
    if ((far || flick) && onSwipe()) return
    springBack()
  }

  function onPointerCancel(event: ReactPointerEvent<HTMLElement>) {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    springBack()
  }

  return {
    sheetRef,
    swipeHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    },
  }
}
