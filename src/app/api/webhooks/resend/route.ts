import { handleResendWebhook } from "@/features/email"

// Resend's webhook (AD-9). /api isn't proxied and there is no session: the
// Svix signature is the check, and the handler does all of it.
export async function POST(request: Request) {
  return handleResendWebhook(request)
}
