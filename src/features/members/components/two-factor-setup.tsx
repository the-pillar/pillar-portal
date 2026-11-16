"use client"

import { useEffect, useRef, useState } from "react"

import { createClient } from "@/lib/supabase/client"

import { memberErrorMessage } from "../errors"
import { CODE_PROMPT, type CodeOutcome, TwoFactorCode } from "./two-factor-code"

type Enrollment = { factorId: string; qrCode: string; secret: string }

/** Checks a code against a factor: the browser session's `amr` gets a fresh `totp` entry. */
export async function verifyFactor(
  factorId: string,
  code: string
): Promise<CodeOutcome> {
  const { error } = await createClient().auth.mfa.challengeAndVerify({
    factorId,
    code,
  })
  if (!error) return "ok"
  return error.code === "mfa_verification_failed" || error.status === 400
    ? "wrong"
    : "failed"
}

/**
 * Two-factor setup for an admin with no verified factor: clears stale
 * unverified factors, enrolls a new authenticator-app factor, shows its QR
 * code (with alt text) and the key to type by hand, and takes the first
 * code. That code verifies the factor, which also counts as a fresh step-up,
 * so `onVerified` is where the caller carries on. Story 8.9's checklist
 * reuses this.
 */
export function TwoFactorSetup({ onVerified }: { onVerified: () => void }) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [failed, setFailed] = useState(false)
  const started = useRef(false)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    // Strict Mode runs an effect twice: enroll once.
    if (started.current) return
    started.current = true
    ;(async () => {
      try {
        const mfa = createClient().auth.mfa
        const listed = await mfa.listFactors()
        if (listed.error) throw listed.error
        for (const factor of listed.data.all) {
          if (factor.factor_type === "totp" && factor.status === "unverified") {
            const removed = await mfa.unenroll({ factorId: factor.id })
            if (removed.error) throw removed.error
          }
        }
        const enrolled = await mfa.enroll({ factorType: "totp" })
        if (enrolled.error) throw enrolled.error
        if (mounted.current) {
          setEnrollment({
            factorId: enrolled.data.id,
            qrCode: enrolled.data.totp.qr_code,
            secret: enrolled.data.totp.secret,
          })
        }
      } catch {
        if (mounted.current) setFailed(true)
      }
    })()
  }, [])

  if (failed) {
    return (
      <p role="alert" className="text-destructive">
        {memberErrorMessage("members.save_failed")}
      </p>
    )
  }
  if (enrollment === null) {
    return <p className="text-muted-foreground">Getting set up…</p>
  }

  return (
    <div className="flex flex-col gap-4">
      <p>
        Scan this code with an authenticator app, or type the key into it by
        hand.
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL SVG from Supabase; next/image can't optimise it */}
      <img
        src={enrollment.qrCode}
        alt="QR code for your authenticator app"
        className="size-44 self-center rounded-lg bg-white p-2"
      />
      <p className="text-sm text-muted-foreground">
        Key:{" "}
        <code className="font-mono break-all text-foreground select-all">
          {enrollment.secret}
        </code>
      </p>
      <p>{CODE_PROMPT}</p>
      <TwoFactorCode
        onSubmit={async (code) => {
          const outcome = await verifyFactor(enrollment.factorId, code)
          if (outcome === "ok") onVerified()
          return outcome
        }}
      />
    </div>
  )
}
