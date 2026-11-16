"use client"

import { createContext, useContext, useEffect, useRef, useState } from "react"

// "This is a shared computer" (AD-22). The checkbox is a native uncontrolled
// input inside the Google form, so it works before hydration and posts
// `shared=1` with that form. A small context mirrors its state into the
// persona form's hidden field. Both work without a provider (nothing ticked).
const SharedComputerContext = createContext<{
  checked: boolean
  setChecked: (checked: boolean) => void
}>({ checked: false, setChecked: () => {} })

export function SharedComputerProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [checked, setChecked] = useState(false)
  return (
    <SharedComputerContext value={{ checked, setChecked }}>
      {children}
    </SharedComputerContext>
  )
}

/** The box and its hint, unchecked by default. */
export function SharedComputerCheckbox() {
  const { setChecked } = useContext(SharedComputerContext)
  const input = useRef<HTMLInputElement>(null)

  // The browser can restore a ticked box on reload, and a fresh form (after a
  // back/forward restore) starts unticked: take whatever the input says.
  useEffect(() => {
    setChecked(input.current?.checked ?? false)
  }, [setChecked])

  return (
    <div className="mb-3 flex items-start gap-3">
      <input
        ref={input}
        id="shared-computer"
        type="checkbox"
        name="shared"
        value="1"
        defaultChecked={false}
        aria-describedby="shared-computer-hint"
        onChange={(event) => setChecked(event.currentTarget.checked)}
        className="mt-1 size-5 shrink-0 accent-navy"
      />
      <div className="flex flex-col gap-1">
        <label htmlFor="shared-computer" className="text-base">
          This is a shared computer
        </label>
        <p id="shared-computer-hint" className="text-sm text-muted-foreground">
          You&apos;ll be signed out when the browser closes, and after 30
          minutes idle.
        </p>
      </div>
    </div>
  )
}

/** A hidden `shared` field for a form the checkbox isn't in. */
export function SharedComputerField() {
  const { checked } = useContext(SharedComputerContext)
  return checked ? <input type="hidden" name="shared" value="1" /> : null
}
