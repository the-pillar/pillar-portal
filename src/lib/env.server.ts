// The only module besides env.client.ts that reads `process.env` (AD-6).
// Server-only values live here; importing this file from client code fails
// the build. `scripts/check-bundle-secrets.mjs` imports it directly under
// Node and reads `serverEnvSchema.shape`, so keep the schema a plain
// z.object and keep imports to packages only (no `@/`, no relative imports).
import "server-only"
import { z } from "zod"

// Prototype personas (AD-7) may be on only against the local Supabase stack
// or the staging project, never production. A Vercel deploy can't tell
// staging from production by VERCEL_ENV (staging is a production deploy of
// its own project), so the rule follows the Supabase project instead, as
// `isProduction` below does.
const STAGING_SUPABASE_ORIGIN = "https://sxlgelitcaolpiijfwsq.supabase.co"
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1"])
const PERSONA_PASSWORD_MIN_LENGTH = 16

// A Supabase secret key: `sb_secret_` and the key. A publishable key or a
// legacy JWT key (service_role or anon) is refused.
const SECRET_KEY_PATTERN = /^sb_secret_[A-Za-z0-9_-]{16,}$/
const SECRET_KEY_MESSAGE = "must be a secret key (sb_secret_…)"

// The email sender's key (`re_…`) and the From address, bare or as
// `Name <address>`.
const RESEND_KEY_PATTERN = /^re_[A-Za-z0-9_-]{8,}$/
const RESEND_KEY_MESSAGE = "must be a Resend API key (re_…)"
const EMAIL_FROM_PATTERN =
  /^(?:[^<>\r\n]+<[^<>\s@]+@[^<>\s@]+>|[^<>\s@]+@[^<>\s@]+)$/
const EMAIL_FROM_MESSAGE = 'must be an address, or "Name <address>"'

// Resend's free plan: 100 a day, 3,000 a month. Confirmation-class mail
// (confirmations and status codes) gets its own daily cap inside the day's.
const DEFAULT_EMAIL_DAILY_LIMIT = 100
const DEFAULT_EMAIL_MONTHLY_LIMIT = 3000
const DEFAULT_EMAIL_CONFIRMATION_CAP = 30

const positiveInteger = z.coerce
  .number({ error: "must be a positive whole number" })
  .int({ error: "must be a positive whole number" })
  .positive({ error: "must be a positive whole number" })

// An empty value (`NAME=` in an env file) counts as unset.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional())

// Each key added here needs a canary value in CI so `pnpm check:bundle` can
// prove it never reaches the browser.
export const serverEnvSchema = z.object({
  // The project's secret key, for src/lib/supabase/admin.ts only (AD-6): the
  // error recorder and /api/health call service_role-only commands with it.
  // Locally it is the stack's SECRET_KEY (`pnpm exec supabase status -o
  // env`); on Vercel a dedicated key from the project's dashboard.
  SUPABASE_SECRET_KEY: z
    .string({ error: SECRET_KEY_MESSAGE })
    .regex(SECRET_KEY_PATTERN, { error: SECRET_KEY_MESSAGE }),
  // "true" turns on persona sign-in on /login. Unset means off.
  PROTOTYPE_PERSONAS: optional(
    z.enum(["true", "false"], { error: 'must be "true" or "false"' })
  ),
  // The shared password of the persona auth users. Locally it is the value
  // supabase/seed.sql sets; staging's comes from scripts/staging-personas.mjs.
  PROTOTYPE_PERSONA_PASSWORD: optional(
    z.string().min(PERSONA_PASSWORD_MIN_LENGTH, {
      error: `must be at least ${PERSONA_PASSWORD_MIN_LENGTH} characters`,
    })
  ),
  // "sink" (the default) runs the whole send path but records instead of
  // sending. "send" really sends, and boot refuses it outside production.
  EMAIL_MODE: optional(
    z.enum(["sink", "send"], { error: 'must be "sink" or "send"' })
  ),
  // Resend's API key, for src/features/email only. Needed in send mode.
  RESEND_API_KEY: optional(
    z
      .string({ error: RESEND_KEY_MESSAGE })
      .regex(RESEND_KEY_PATTERN, { error: RESEND_KEY_MESSAGE })
  ),
  // The From address of every email. Needed in send mode.
  EMAIL_FROM: optional(
    z
      .string({ error: EMAIL_FROM_MESSAGE })
      .max(200, { error: EMAIL_FROM_MESSAGE })
      .regex(EMAIL_FROM_PATTERN, { error: EMAIL_FROM_MESSAGE })
  ),
  // The quota: per UTC day, per UTC month, and the daily cap on confirmation
  // and status-code mail. Defaults 100, 3000 and 30.
  EMAIL_DAILY_LIMIT: optional(positiveInteger),
  EMAIL_MONTHLY_LIMIT: optional(positiveInteger),
  EMAIL_CONFIRMATION_DAILY_CAP: optional(positiveInteger),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

// The local stack or the staging project: where personas may run, and never
// production. False for a missing or unparseable URL.
function isLocalOrStagingProject(supabaseUrl: string | undefined) {
  if (supabaseUrl === undefined || !URL.canParse(supabaseUrl)) return false
  const url = new URL(supabaseUrl)
  return (
    url.origin === STAGING_SUPABASE_ORIGIN ||
    (LOCAL_HOSTNAMES.has(url.hostname) &&
      (url.protocol === "http:" || url.protocol === "https:"))
  )
}

// A Vercel production deploy on a Supabase project other than the local stack
// or staging: production itself.
function isProductionDeploy(
  vercelEnv: string | undefined,
  supabaseUrl: string | undefined
) {
  return (
    vercelEnv === "production" &&
    supabaseUrl !== undefined &&
    URL.canParse(supabaseUrl) &&
    !isLocalOrStagingProject(supabaseUrl)
  )
}

const parsed = serverEnvSchema.safeParse(process.env)

const problems = parsed.success
  ? []
  : parsed.error.issues.map(
      (issue) => `  - ${issue.path.join(".")}: ${issue.message}`
    )

// Checks across variables. NEXT_PUBLIC_SUPABASE_URL is read here but stays out
// of the schema: it belongs in the browser bundle, so check:bundle must not
// scan for it.
if (parsed.success && parsed.data.PROTOTYPE_PERSONAS === "true") {
  if (!isLocalOrStagingProject(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    problems.push(
      `  - PROTOTYPE_PERSONAS: must not be "true" unless NEXT_PUBLIC_SUPABASE_URL is the local stack (localhost or 127.0.0.1) or the staging project (${STAGING_SUPABASE_ORIGIN})`
    )
  }
  if (parsed.data.PROTOTYPE_PERSONA_PASSWORD === undefined) {
    problems.push(
      "  - PROTOTYPE_PERSONA_PASSWORD: required when PROTOTYPE_PERSONAS is true"
    )
  }
}

// Real mail leaves only from production, and only when it can actually be
// sent: the key and the From address must be there.
if (parsed.success && parsed.data.EMAIL_MODE === "send") {
  if (
    !isProductionDeploy(
      process.env.VERCEL_ENV,
      process.env.NEXT_PUBLIC_SUPABASE_URL
    )
  ) {
    problems.push(
      '  - EMAIL_MODE: must not be "send" outside production (a Vercel production deploy on the production Supabase project)'
    )
  }
  for (const name of ["RESEND_API_KEY", "EMAIL_FROM"] as const) {
    if (parsed.data[name] === undefined) {
      problems.push(`  - ${name}: required when EMAIL_MODE is send`)
    }
  }
}

if (!parsed.success || problems.length > 0) {
  throw new Error(
    `Invalid server environment variables:\n${problems.join("\n")}`
  )
}

export const serverEnv: ServerEnv = parsed.data

/** Persona sign-in is on (AD-7). Boot has already refused it off-project. */
export const personasEnabled = serverEnv.PROTOTYPE_PERSONAS === "true"

/**
 * This is production: a Vercel production deploy (`VERCEL_ENV` is
 * `production`) whose Supabase project is neither the local stack nor
 * staging. `VERCEL_ENV` alone can't tell, since staging is a production
 * deploy of its own Vercel project. Only production is backed up, so only
 * production shows the backup banner.
 *
 * `VERCEL_ENV` is read here, like NEXT_PUBLIC_SUPABASE_URL above, but stays
 * out of the schema: check:bundle byte-matches every schema value of 8 or
 * more characters, so "production" would match the bundles, and CI would need
 * a canary for it.
 */
export const isProduction = isProductionDeploy(
  process.env.VERCEL_ENV,
  process.env.NEXT_PUBLIC_SUPABASE_URL
)

/**
 * The email sender's settings, with the defaults applied. `mode` is `sink`
 * unless `EMAIL_MODE=send`, which boot has already refused outside
 * production and without the key and the From address.
 */
export const emailConfig = {
  mode: serverEnv.EMAIL_MODE ?? "sink",
  resendApiKey: serverEnv.RESEND_API_KEY,
  from: serverEnv.EMAIL_FROM,
  dailyLimit: serverEnv.EMAIL_DAILY_LIMIT ?? DEFAULT_EMAIL_DAILY_LIMIT,
  monthlyLimit: serverEnv.EMAIL_MONTHLY_LIMIT ?? DEFAULT_EMAIL_MONTHLY_LIMIT,
  confirmationCap:
    serverEnv.EMAIL_CONFIRMATION_DAILY_CAP ?? DEFAULT_EMAIL_CONFIRMATION_CAP,
} as const
