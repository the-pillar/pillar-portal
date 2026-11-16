"use client"

import { REGEXP_ONLY_DIGITS } from "input-otp"
import { useId, useRef, useState } from "react"

import { FieldError } from "@/components/ui/field"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { cn } from "@/lib/utils"

import { memberErrorMessage } from "../errors"

export const CODE_PROMPT = "Enter the 6-digit code from your authenticator app."
export const WRONG_CODE_COPY =
  "That code didn't work. Check your authenticator app and try again."

/** What checking a code came to: accepted, wrong, or failed for another reason. */
export type CodeOutcome = "ok" | "wrong" | "failed"

/**
 * The 6-digit code field (shadcn InputOTP, one-time-code autofill, paste
 * accepted). A full code is checked at once through `onSubmit`; a wrong one
 * shows its line under the field, clears the field and refocuses it, and
 * another failure shows the generic save line.
 */
export function TwoFactorCode({
  onSubmit,
}: {
  onSubmit: (code: string) => Promise<CodeOutcome>
}) {
  const [value, setValue] = useState("")
  const [outcome, setOutcome] = useState<CodeOutcome | null>(null)
  const [checking, setChecking] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const id = useId()
  const problemId = `${id}-problem`

  async function submit(code: string) {
    if (checking) return
    setChecking(true)
    setOutcome(null)
    let result: CodeOutcome
    try {
      result = await onSubmit(code)
    } catch {
      result = "failed"
    }
    setChecking(false)
    if (result !== "ok") {
      setOutcome(result)
      setValue("")
      inputRef.current?.focus()
    }
  }

  const problem =
    outcome === "wrong"
      ? WRONG_CODE_COPY
      : outcome === "failed"
        ? memberErrorMessage("members.save_failed")
        : null

  return (
    <div className="flex flex-col items-center gap-2">
      <InputOTP
        ref={inputRef}
        maxLength={6}
        pattern={REGEXP_ONLY_DIGITS}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        aria-label="6-digit code"
        aria-invalid={problem !== null || undefined}
        aria-describedby={problem !== null ? problemId : undefined}
        value={value}
        readOnly={checking}
        aria-disabled={checking || undefined}
        containerClassName={cn(checking && "opacity-50")}
        onChange={(next) => {
          setValue(next)
          setOutcome(null)
        }}
        onComplete={(code) => void submit(code)}
      >
        <InputOTPGroup>
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <InputOTPSlot
              key={index}
              index={index}
              className="size-11"
              aria-invalid={problem !== null || undefined}
            />
          ))}
        </InputOTPGroup>
      </InputOTP>
      {problem !== null && (
        <FieldError id={problemId} className="text-center">
          {problem}
        </FieldError>
      )}
    </div>
  )
}
