// The email slice's public surface (AD-2): code outside the slice imports
// from here only. Server code: the drain reads the secret key.
export { drainOutbox } from "./sender"
export type { DrainOptions, DrainResult } from "./sender"
export { getEmailQuotaStatus } from "./quota"
export type { EmailQuotaStatus } from "./quota"
export { QuotaMeter } from "./quota-meter"
export { handleResendWebhook } from "./webhook"
export { EmailShell, EmailText } from "./shell"
export type { EmailAudience, EmailShellProps } from "./shell"
export { EmailRenderError, renderEmail } from "./render"
export type { RenderedEmail } from "./render"
export { templates } from "./templates"
export type { EmailTemplate } from "./templates"
export {
  createResendTransport,
  createSinkTransport,
  sinkTransport,
} from "./transport"
export type {
  EmailTransport,
  OutboundEmail,
  SendResult,
  SinkTransport,
} from "./transport"
