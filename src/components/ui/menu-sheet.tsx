"use client"

import {
  createContext,
  type ComponentProps,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  useContext,
  useRef,
  useState,
} from "react"
import { Slot } from "radix-ui"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

/** Phones, and any touch-first screen at any width (DESIGN.md › Layout). */
export const MENU_SHEET_QUERY = "(max-width: 767px), (any-pointer: coarse)"

type Mode = "sheet" | "menu"

// Decided each time the menu opens, so a window resized while it is closed
// opens the right one.
function chooseMode(): Mode {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return "menu"
  return window.matchMedia(MENU_SHEET_QUERY).matches ? "sheet" : "menu"
}

const ModeContext = createContext<{ mode: Mode; close: () => void }>({
  mode: "menu",
  close: () => {},
})

/**
 * One menu that opens as a bottom sheet on phones and touch-first screens
 * and as a dropdown elsewhere (DESIGN.md › Menu sheet). `title` names what
 * the menu acts on: the sheet's heading and the dropdown's first line. Fill it
 * with `MenuSheetItem`s, destructive last. `trigger` is the one element that
 * opens it; focus returns to it when the menu closes.
 *
 * The sheet is a modal dialog (Escape or a tap outside closes it), not an
 * ARIA menu, so its rows are plain buttons and links.
 */
export function MenuSheet({
  trigger,
  title,
  children,
}: {
  trigger: ReactElement<ComponentProps<"button">>
  title: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>("menu")
  const triggerRef = useRef<HTMLButtonElement>(null)

  function openAs(next: Mode) {
    setMode(next)
    setOpen(true)
  }

  // Radix asks to open from a pointer press in a mouse's menu, and from the
  // keyboard in both.
  function onMenuOpenChange(next: boolean) {
    if (next) openAs(chooseMode())
    else setOpen(false)
  }

  // A sheet opens on click, not on the press that Radix's trigger uses: the
  // sheet's backdrop would land under the finger that is still down.
  function onTriggerPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (chooseMode() === "sheet") event.preventDefault()
  }

  function onTriggerClick() {
    if (chooseMode() === "sheet") openAs("sheet")
  }

  return (
    <ModeContext.Provider value={{ mode, close: () => setOpen(false) }}>
      <DropdownMenu
        open={open && mode === "menu"}
        onOpenChange={onMenuOpenChange}
      >
        <DropdownMenuTrigger
          asChild
          ref={triggerRef}
          aria-haspopup={mode === "sheet" ? "dialog" : "menu"}
          aria-expanded={open}
          onPointerDown={onTriggerPointerDown}
          onClick={onTriggerClick}
        >
          {trigger}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-48">
          <DropdownMenuLabel className="text-sm text-foreground">
            {title}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
      <Sheet open={open && mode === "sheet"} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          onCloseAutoFocus={(event) => {
            // iPhone Safari doesn't focus a button on tap, so Radix's own
            // return would land on the page.
            event.preventDefault()
            triggerRef.current?.focus()
          }}
          className="gap-0 rounded-t-xl p-0 pb-[env(safe-area-inset-bottom)] [--tw-ease:var(--ease-drawer)] data-open:[--tw-animation-duration:var(--motion-sheet-in)] data-[side=bottom]:data-open:slide-in-from-bottom data-closed:[--tw-animation-duration:var(--motion-sheet-out)] data-[side=bottom]:data-closed:slide-out-to-bottom"
        >
          <SheetHeader className="px-4 pt-4 pb-2">
            <SheetTitle className="text-heading-sm">{title}</SheetTitle>
            <SheetDescription className="sr-only">
              Choose an action
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col pb-2">{children}</div>
        </SheetContent>
      </Sheet>
    </ModeContext.Provider>
  )
}

/**
 * A row of the menu: 48px in the sheet, a standard item in the dropdown.
 * `asChild` styles the child (a link, a button) as the row. Selecting a row
 * closes the menu unless `keepOpen`: use it for a row inside a form, which
 * must stay mounted until the browser has submitted it.
 */
export function MenuSheetItem({
  asChild,
  keepOpen,
  variant = "default",
  className,
  onSelect,
  children,
  ...props
}: Omit<ComponentProps<"button">, "onSelect"> & {
  asChild?: boolean
  keepOpen?: boolean
  variant?: "default" | "destructive"
  onSelect?: (event: Event) => void
}) {
  const { mode, close } = useContext(ModeContext)

  if (mode === "menu") {
    return (
      <DropdownMenuItem
        asChild
        variant={variant}
        onSelect={(event) => {
          if (keepOpen) event.preventDefault()
          onSelect?.(event)
        }}
      >
        {asChild ? (
          <Slot.Root className={cn("min-h-11 w-full", className)} {...props}>
            {children}
          </Slot.Root>
        ) : (
          <button
            type="button"
            className={cn("min-h-11 w-full", className)}
            {...props}
          >
            {children}
          </button>
        )}
      </DropdownMenuItem>
    )
  }

  const Comp = asChild ? Slot.Root : "button"
  return (
    <Comp
      {...(asChild ? {} : { type: "button" as const })}
      {...props}
      data-variant={variant}
      className={cn(
        "flex min-h-12 w-full items-center px-4 text-left text-base hover:bg-muted focus-visible:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring data-[variant=destructive]:text-destructive",
        className
      )}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        props.onClick?.(event)
        // A separate event, so a caller's preventDefault() keeps the sheet
        // open without cancelling the link or form under the click.
        const select = new Event("select", { cancelable: true })
        onSelect?.(select)
        if (!keepOpen && !select.defaultPrevented) close()
      }}
    >
      {children}
    </Comp>
  )
}
