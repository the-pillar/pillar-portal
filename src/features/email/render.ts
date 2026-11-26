import { render } from "react-email"

import { type EmailTemplate, templates } from "./templates"

/** A render failure with a code to store as the row's `error`. */
export class EmailRenderError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = "EmailRenderError"
    this.code = code
  }
}

export type RenderedEmail = { subject: string; html: string; text: string }

/**
 * Renders a queued row's template with its payload. An unknown template
 * throws `email.unknown_template`; anything else the template throws becomes
 * `email.render_failed`, so the row's `error` is always a code.
 */
export async function renderEmail(
  template: string,
  payload: Record<string, unknown>,
  registry: Record<string, EmailTemplate> = templates
): Promise<RenderedEmail> {
  const entry = Object.hasOwn(registry, template) ? registry[template] : null
  if (entry === null) throw new EmailRenderError("email.unknown_template")

  try {
    const element = entry.element(payload)
    const [html, text] = await Promise.all([
      render(element),
      render(element, { plainText: true }),
    ])
    return { subject: entry.subject(payload), html, text }
  } catch {
    throw new EmailRenderError("email.render_failed")
  }
}
