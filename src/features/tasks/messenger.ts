import { formatInPht } from "@/lib/time"

import type { PRODUCTION_ROLES } from "./schemas"
import { siteLabel } from "./site-label"

type ProductionRole = (typeof PRODUCTION_ROLES)[number]

const DUE_FORMAT = "EEE, MMM d, h:mm a"

export const MESSENGER_COPIED = "Copied — paste it in Messenger."
export const MESSENGER_HINT = "Copy this and paste it in Messenger."

export type MessengerTask = {
  id: string
  title: string
  /** One per slot, in slot order; repeats are collapsed. */
  roles: ProductionRole[]
  /** UTC instant; shown in PHT. */
  dueAt: Date | string
  /** The saved reference links, in order; every caller passes them. */
  referenceUrls: string[]
  /**
   * The task's deliverable links per role (`deliverablesByRole`); every
   * caller passes them, `[]` when there are none or the task is new.
   */
  deliverables: MessengerDeliverables[]
}

export type MessengerDeliverables = { role: ProductionRole; urls: string[] }

/**
 * The deliverable links of a task grouped for the message: one entry per role
 * that has any, in the order the roles first appear in `slots`, a role's
 * slots merged (slot order, then the links' `seq` order, which `links` is
 * already in). No names.
 */
export function deliverablesByRole(
  slots: readonly { id: string; role: ProductionRole }[],
  links: readonly { slotId: string; url: string }[]
): MessengerDeliverables[] {
  const byRole = new Map<ProductionRole, string[]>()
  for (const slot of slots) {
    const urls = links
      .filter((link) => link.slotId === slot.id)
      .map((link) => link.url)
    if (urls.length === 0) continue
    byRole.set(slot.role, [...(byRole.get(slot.role) ?? []), ...urls])
  }
  return [...byRole].map(([role, urls]) => ({ role, urls }))
}

function linkLines(urls: readonly string[]): string {
  return urls.map((url) => `• ${siteLabel(url)}: ${url}`).join("\n")
}

/**
 * The message pasted into Messenger. `siteUrl` is `NEXT_PUBLIC_SITE_URL`,
 * passed in so this module stays client-safe and never reads a request's Host.
 */
export function buildMessengerMessage(
  task: MessengerTask,
  siteUrl: string,
  roleLabels: Record<ProductionRole, string>
): string {
  const roles = [...new Set(task.roles)].map((role) => roleLabels[role])
  const link = new URL(`/dashboard/tasks/${task.id}`, siteUrl).href
  const head = `📌 ${task.title} — ${roles.join(" / ")} · due ${formatInPht(task.dueAt, DUE_FORMAT)}\n${link}`
  const blocks = [
    ...(task.referenceUrls.length > 0
      ? [`Reference\n${linkLines(task.referenceUrls)}`]
      : []),
    ...task.deliverables
      .filter((group) => group.urls.length > 0)
      .map((group) => `${roleLabels[group.role]}\n${linkLines(group.urls)}`),
  ]
  return blocks.length === 0 ? head : `${head}\n\n${blocks.join("\n\n")}`
}

// Lives in src/lib so the members slice can copy a link too.
export { copyText } from "@/lib/clipboard"
