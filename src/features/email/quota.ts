import "server-only"

import { emailConfig } from "@/lib/env.server"
import { createClient } from "@/lib/supabase/server"

/**
 * The quota as `email_quota_status` reports it (AD-9). Every figure comes
 * from Postgres, the provider day included: TypeScript never works out the
 * UTC day itself.
 */
export type EmailQuotaStatus = {
  /** The provider's UTC day, `YYYY-MM-DD`. */
  providerDay: string
  sentToday: number
  limitToday: number
  queued: number
  /** The provider day the queue empties, or null. */
  finishesOn: string | null
}

/**
 * Reads the quota with the viewer's own session, so RLS decides what is
 * counted: an admin sees the real figures, anyone else zeros. Throws when the
 * read fails; a caller that must not break its page catches and records.
 */
export async function getEmailQuotaStatus(): Promise<EmailQuotaStatus> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("email_quota_status", {
    daily_limit: emailConfig.dailyLimit,
    monthly_limit: emailConfig.monthlyLimit,
    confirmation_cap: emailConfig.confirmationCap,
  })
  if (error) throw error
  const row = data?.[0]
  if (!row) throw new Error("email_quota_status returned no row")
  return {
    providerDay: row.provider_day,
    sentToday: row.sent_today,
    limitToday: row.limit_today,
    queued: row.queued,
    finishesOn: row.finishes_on ?? null,
  }
}
