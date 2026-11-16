"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { createClient } from "@/lib/supabase/client"
import { StepUpContext, type StepUpRequester } from "@/lib/step-up"

import { memberErrorMessage } from "../errors"
import { CODE_PROMPT, type CodeOutcome, TwoFactorCode } from "./two-factor-code"
import { TwoFactorSetup, verifyFactor } from "./two-factor-setup"

type Factor =
  | { state: "loading" }
  | { state: "code"; factorId: string }
  | { state: "setup" }
  | { state: "failed" }

/**
 * The step-up prompt (AD-22) for every high-impact command under it: mounted
 * once by the admin layout, reached through `StepUpContext` by `useCommand`.
 * `requestStepUp` opens a dialog that asks for the 6-digit code, or leads
 * into setup when the admin has no verified factor, and resolves true once a
 * code is accepted (the first code at setup counts) or false on Cancel.
 */
export function StepUpProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const waiting = useRef<{
    promise: Promise<boolean>
    resolve: (verified: boolean) => void
  } | null>(null)
  const verified = useRef(false)

  const requestStepUp = useCallback(() => {
    if (waiting.current) return waiting.current.promise
    let resolve!: (verified: boolean) => void
    const promise = new Promise<boolean>((r) => {
      resolve = r
    })
    waiting.current = { promise, resolve }
    verified.current = false
    setOpen(true)
    return promise
  }, [])

  const settle = useCallback((result: boolean) => {
    const current = waiting.current
    waiting.current = null
    verified.current = result
    setOpen(false)
    current?.resolve(result)
  }, [])

  const value = useMemo<StepUpRequester>(
    () => ({ requestStepUp }),
    [requestStepUp]
  )

  return (
    <StepUpContext.Provider value={value}>
      {children}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) settle(false)
        }}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
          onCloseAutoFocus={(event) => {
            // After a verified code the command carries on and moves focus
            // itself; after Cancel, focus returns to what opened the prompt.
            if (verified.current) event.preventDefault()
          }}
        >
          {open && <StepUpBody onVerified={() => settle(true)} />}
        </DialogContent>
      </Dialog>
    </StepUpContext.Provider>
  )
}

function StepUpBody({ onVerified }: { onVerified: () => void }) {
  const [factor, setFactor] = useState<Factor>({ state: "loading" })

  useEffect(() => {
    let active = true
    createClient()
      .auth.mfa.listFactors()
      .then(({ data, error }) => {
        if (!active) return
        if (error) return setFactor({ state: "failed" })
        const verifiedFactor = data.totp[0]
        setFactor(
          verifiedFactor
            ? { state: "code", factorId: verifiedFactor.id }
            : { state: "setup" }
        )
      })
      .catch(() => {
        if (active) setFactor({ state: "failed" })
      })
    return () => {
      active = false
    }
  }, [])

  if (factor.state === "setup") {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Set up two-factor</DialogTitle>
          <DialogDescription>
            This needs a code from an authenticator app. Set one up first.
          </DialogDescription>
        </DialogHeader>
        <TwoFactorSetup onVerified={onVerified} />
      </>
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Confirm it&apos;s you</DialogTitle>
        <DialogDescription>{CODE_PROMPT}</DialogDescription>
      </DialogHeader>
      {factor.state === "loading" && (
        <p className="text-muted-foreground">One moment…</p>
      )}
      {factor.state === "failed" && (
        <p role="alert" className="text-destructive">
          {memberErrorMessage("members.save_failed")}
        </p>
      )}
      {factor.state === "code" && (
        <TwoFactorCode
          onSubmit={async (code): Promise<CodeOutcome> => {
            const outcome = await verifyFactor(factor.factorId, code)
            if (outcome === "ok") onVerified()
            return outcome
          }}
        />
      )}
    </>
  )
}
