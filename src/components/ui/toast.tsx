"use client"

import { type ReactNode, useEffect, useRef, useState } from "react"
import { CircleAlert, X } from "lucide-react"
import { Toaster as Sonner, toast as sonner } from "sonner"

import { prefersReducedMotion } from "@/lib/reduced-motion"
import { cn } from "@/lib/utils"

/*
 * The toast API every caller imports (never `sonner`; ESLint enforces it) and
 * the toaster the root layout mounts. Sonner keeps the stacking, positioning
 * and edge motion; each toast is a `toast.custom` with `duration: Infinity`
 * whose view owns its timer, so pause-on-hover, pause-on-focus and the undo
 * countdown share one clock (Sonner has no pause-on-focus).
 * EXPERIENCE.md › Toast sets the kinds and timings.
 */

export type ToastKind =
  "info" | "success" | "undo" | "action" | "error" | "notice"

export type ToastAction = { label: string; onClick: () => void | Promise<void> }

export type ToastOptions = {
  /** A stable id replaces the toast already showing under it. */
  id?: string
  /** A second line under the message (the Messenger text to copy by hand). */
  description?: string
  /** At most one action, in tan. */
  action?: ToastAction
}

type ToastId = string | number

// Milliseconds a toast stays: information and success 4s, a toast with an
// action 8s, the undo toast 5s, errors and a redirect's explanation until
// closed. DESIGN.md's `undo-window` is the same 5s as `undo` here.
export const TOAST_DURATIONS: Record<ToastKind, number> = {
  info: 4000,
  success: 4000,
  action: 8000,
  undo: 5000,
  error: Infinity,
  notice: Infinity,
}

// The toasts on screen, oldest first: Escape dismisses the last.
const active: ToastId[] = []

let nonce = 0

function show(kind: ToastKind, message: string, options: ToastOptions = {}) {
  // A plain or success toast that carries an action is an action toast.
  const effective: ToastKind =
    options.action && (kind === "info" || kind === "success") ? "action" : kind
  const key = ++nonce
  return sonner.custom(
    (id) => (
      <ToastView
        key={key}
        id={id}
        kind={effective}
        message={message}
        description={options.description}
        action={options.action}
      />
    ),
    { id: options.id, duration: Infinity }
  )
}

export const toast = Object.assign(
  (message: string, options?: ToastOptions) => show("info", message, options),
  {
    success: (message: string, options?: ToastOptions) =>
      show("success", message, options),
    /** Moves the user can reverse: a 5 second window and a countdown bar. */
    undo: (message: string, options?: ToastOptions) =>
      show("undo", message, options),
    error: (message: string, options?: ToastOptions) =>
      show("error", message, options),
    /** The explanation of a redirect: stays until closed. */
    notice: (message: string, options?: ToastOptions) =>
      show("notice", message, options),
    dismiss: (id?: ToastId) => sonner.dismiss(id),
  }
)

function useDocumentHidden() {
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    const update = () => setHidden(document.visibilityState === "hidden")
    update()
    document.addEventListener("visibilitychange", update)
    return () => document.removeEventListener("visibilitychange", update)
  }, [])
  return hidden
}

/**
 * Runs `onExpire` once `duration` of unpaused time has passed. While
 * `stepped` (reduced motion) it also reports whole seconds left, once a
 * second, for the countdown bar.
 */
function useClock({
  duration,
  paused,
  stepped,
  onExpire,
}: {
  duration: number
  paused: boolean
  stepped: boolean
  onExpire: () => void
}) {
  const remaining = useRef(duration)
  const expire = useRef(onExpire)
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(duration / 1000))

  useEffect(() => {
    expire.current = onExpire
  })

  useEffect(() => {
    if (!Number.isFinite(duration) || paused) return
    const startedAt = Date.now()
    const timeout = setTimeout(() => expire.current(), remaining.current)
    const interval = stepped
      ? setInterval(() => {
          const left = remaining.current - (Date.now() - startedAt)
          setSecondsLeft(Math.max(0, Math.ceil(left / 1000)))
        }, 1000)
      : undefined
    return () => {
      remaining.current -= Date.now() - startedAt
      clearTimeout(timeout)
      clearInterval(interval)
    }
  }, [duration, paused, stepped])

  return secondsLeft
}

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-on-dark"

function ToastView({
  id,
  kind,
  message,
  description,
  action,
}: {
  id: ToastId
  kind: ToastKind
  message: string
  description?: string
  action?: ToastAction
}) {
  const duration = TOAST_DURATIONS[kind]
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const hidden = useDocumentHidden()
  const paused = hovered || focused || hidden
  const rootRef = useRef<HTMLDivElement>(null)
  const [stepped] = useState(() => prefersReducedMotion())

  const secondsLeft = useClock({
    duration,
    paused,
    stepped,
    onExpire: () => sonner.dismiss(id),
  })

  // Sonner's <li> is itself focusable, so focus can sit on it, outside the
  // div's own focus events. Watch focus anywhere inside the li.
  useEffect(() => {
    const li = rootRef.current?.closest("[data-sonner-toast]")
    if (!li) return
    const onIn = () => setFocused(true)
    const onOut = (event: Event) => {
      const next = (event as FocusEvent).relatedTarget as Node | null
      if (!next || !li.contains(next)) setFocused(false)
    }
    li.addEventListener("focusin", onIn)
    li.addEventListener("focusout", onOut)
    return () => {
      li.removeEventListener("focusin", onIn)
      li.removeEventListener("focusout", onOut)
    }
  }, [])

  useEffect(() => {
    active.push(id)
    return () => {
      const at = active.lastIndexOf(id)
      if (at !== -1) active.splice(at, 1)
    }
  }, [id])

  const totalSeconds = Math.ceil(duration / 1000)

  return (
    <div
      ref={rootRef}
      role={kind === "error" ? "alert" : "status"}
      data-toast-kind={kind}
      className="relative flex w-full items-start gap-1 overflow-hidden rounded-lg bg-ink py-2 pr-1 pl-4 text-white shadow-lg"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {kind === "error" && (
        <CircleAlert aria-hidden className="mt-2.5 size-4 shrink-0" />
      )}
      <div className="min-w-0 flex-1 self-center py-1 text-sm">
        <p>{message}</p>
        {description && (
          <p className="mt-1 break-words text-white/80 select-text">
            {description}
          </p>
        )}
      </div>
      {action && (
        <button
          type="button"
          onClick={async () => {
            sonner.dismiss(id)
            await action.onClick()
          }}
          className={cn(
            "min-h-11 shrink-0 rounded-md px-3 text-sm font-semibold text-tan md:min-h-8",
            FOCUS
          )}
        >
          {action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => sonner.dismiss(id)}
        className={cn(
          "inline-flex size-11 shrink-0 items-center justify-center rounded-md text-white md:size-8",
          FOCUS
        )}
      >
        <X aria-hidden className="size-4" />
      </button>
      {kind === "undo" && (
        <span
          aria-hidden
          data-countdown={stepped ? "stepped" : "smooth"}
          className={cn(
            "absolute inset-x-0 bottom-0 h-1 origin-left bg-tan",
            !stepped && "toast-countdown"
          )}
          style={
            stepped
              ? { transform: `scaleX(${secondsLeft / totalSeconds})` }
              : {
                  animationDuration: `${duration}ms`,
                  animationPlayState: paused ? "paused" : "running",
                }
          }
        />
      )}
    </div>
  )
}

// Sonner's own position prop is one value, so the toaster tracks the `md`
// breakpoint itself: top below it, bottom-right from it.
const DESKTOP = "(min-width: 768px)"

function useDesktop() {
  const [desktop, setDesktop] = useState(false)
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return
    const query = window.matchMedia(DESKTOP)
    const update = () => setDesktop(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])
  return desktop
}

// An open dialog, sheet or menu owns Escape. Radix marks its own handled
// Escape as defaultPrevented, but a layer that is still animating out is
// gone from `[data-state="open"]`, so ask the DOM too.
const OPEN_LAYER =
  '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]'

/** The one toaster, mounted in the root layout. */
export function Toaster(): ReactNode {
  const desktop = useDesktop()

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return
      if (document.querySelector(OPEN_LAYER)) return
      const newest = active.at(-1)
      if (newest === undefined) return
      active.pop()
      sonner.dismiss(newest)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <Sonner
      theme="light"
      position={desktop ? "bottom-right" : "top-center"}
      visibleToasts={3}
    />
  )
}
