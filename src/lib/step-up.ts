import { createContext } from "react"

/**
 * The code a high-impact command's action returns when the caller has no
 * TOTP verification from the last 15 minutes (`private.recent_mfa()`, AD-22).
 */
export const STEP_UP_REQUIRED = "auth.step_up_required"

/**
 * What `useCommand` asks when a command is refused with `STEP_UP_REQUIRED`.
 * `requestStepUp` resolves true once the person has proved a fresh code
 * (setting up two-factor first if they have none), and false if they cancel.
 * The provider is members-slice UI mounted by the admin layout; this context
 * lets `src/lib` reach it without importing the slice. The default, null,
 * means no provider: the refusal is an ordinary failure.
 */
export type StepUpRequester = {
  requestStepUp(): Promise<boolean>
}

export const StepUpContext = createContext<StepUpRequester | null>(null)
