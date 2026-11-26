import { isBeforePhtHour, shiftDay, weekdayShort } from "@/lib/time"
import { cn } from "@/lib/utils"

import type { EmailQuotaStatus } from "./quota"

// The fill turns to the attention color from this share of the day's limit.
const ATTENTION_PERCENT = 80

/**
 * The quota meter (EXPERIENCE.md › Quota meter): "<sent> / <limit> today · <n>
 * queued", with "· finishes <day>" when the queue spills into a later day. The
 * 120 × 8 px bar is decoration (`aria-hidden`); the figures are the visible
 * text. At the limit with something queued, the line is the "Daily limit
 * reached" sentence instead. `now` picks "today" or "tomorrow" there: the
 * quota day turns over at 8:00 AM Philippine time.
 */
export function QuotaMeter({
  status,
  now,
  className,
}: {
  status: EmailQuotaStatus
  now: Date
  className?: string
}) {
  const { sentToday, limitToday, queued, finishesOn, providerDay } = status
  const full = limitToday === 0 || sentToday >= limitToday
  const attention =
    limitToday === 0 || sentToday * 100 >= limitToday * ATTENTION_PERCENT
  const fill = full
    ? 100
    : Math.max(0, Math.min(100, (sentToday / limitToday) * 100))

  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", className)}
    >
      <div
        aria-hidden="true"
        className="h-2 w-30 shrink-0 overflow-hidden rounded-full bg-muted"
      >
        <div
          data-fill={attention ? "attention" : "normal"}
          className={cn(
            "h-full rounded-full",
            attention ? "bg-status-attention" : "bg-navy"
          )}
          style={{ width: `${fill}%` }}
        />
      </div>
      <p className="text-sm text-foreground">
        {full && queued > 0 && finishesOn === shiftDay(providerDay, 1) ? (
          <>
            Daily limit reached — {queued} {queued === 1 ? "email" : "emails"}{" "}
            will go out {isBeforePhtHour(now, 8) ? "today" : "tomorrow"} from
            8:00 AM.
          </>
        ) : (
          <>
            {sentToday} / {limitToday} today
            <span className="text-muted-foreground"> · {queued} queued</span>
            {finishesOn !== null && finishesOn > providerDay && (
              <span className="text-muted-foreground">
                {" "}
                · finishes {weekdayShort(finishesOn)}
              </span>
            )}
          </>
        )}
      </p>
    </div>
  )
}
