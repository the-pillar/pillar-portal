import type { ReactElement } from "react"

import { reminderTemplate } from "./reminder-template"

/**
 * One email template: the subject, and the element the shell draws from the
 * row's payload. A later story (4.4's decisions, 5.x's confirmations) adds
 * its own entry here and edits nothing else.
 */
export type EmailTemplate = {
  subject: (payload: Record<string, unknown>) => string
  element: (payload: Record<string, unknown>) => ReactElement
}

/** Template name (the outbox's `template`) to template. */
export const templates: Record<string, EmailTemplate> = {
  reminder: reminderTemplate,
}
