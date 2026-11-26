import { PRODUCTION_ROLE_LABELS } from "@/lib/production-roles"
import { formatInPht } from "@/lib/time"

import { EmailShell, EmailText } from "./shell"
import type { EmailTemplate } from "./templates"

const SUBJECT_TIME = "EEE h:mm a"
const BODY_TIME = "EEE, MMM d, h:mm a"

// The payload `public.enqueue_due_reminders` builds: `task_id`, `title`,
// `due_at` (UTC ISO) and `roles` (production role ids, sorted).
function read(payload: Record<string, unknown>) {
  const taskId = String(payload.task_id)
  const title = String(payload.title)
  const due = new Date(String(payload.due_at))
  if (Number.isNaN(due.getTime())) throw new Error("reminder: bad due_at")
  const roles = Array.isArray(payload.roles) ? payload.roles : []
  const labels = roles.map((role) =>
    Object.hasOwn(PRODUCTION_ROLE_LABELS, String(role))
      ? PRODUCTION_ROLE_LABELS[role as keyof typeof PRODUCTION_ROLE_LABELS]
      : String(role)
  )
  return { taskId, title, due, labels }
}

/**
 * The deadline reminder (Story 4.3): the task is due by 09:00 tomorrow,
 * Manila time. Dates are Philippine time through `formatInPht`.
 */
export const reminderTemplate: EmailTemplate = {
  subject: (payload) => {
    const { title, due } = read(payload)
    return `Due ${formatInPht(due, SUBJECT_TIME)}: ${title}`
  },
  element: (payload) => {
    const { taskId, title, due, labels } = read(payload)
    const dueText = formatInPht(due, BODY_TIME)
    return (
      <EmailShell
        preview={`${title} is due ${dueText}.`}
        heading={title}
        cta={{ label: "Open the task", path: `/dashboard/tasks/${taskId}` }}
        audience="staff"
      >
        <EmailText>{`${title} is due ${dueText}.`}</EmailText>
        <EmailText>{`Your role: ${labels.join(", ")}.`}</EmailText>
      </EmailShell>
    )
  },
}
