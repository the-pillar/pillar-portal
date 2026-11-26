import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from "react-email"
import type { ReactNode } from "react"

import { clientEnv } from "@/lib/env.client"

import { emailTokens as t } from "./tokens"

/** Who the email is for: staff of the portal, or an applicant. */
export type EmailAudience = "staff" | "applicant"

export type EmailShellProps = {
  /** The inbox preview line. */
  preview: string
  heading: string
  children?: ReactNode
  /** A button to a page of the portal: `path` is a site path (`/board`). */
  cta?: { label: string; path: string }
  audience: EmailAudience
}

const SIGN_OFF = "For an empowered press."
const LOGO_PATH = "/email-logo.png"
const LOGO_SIZE = 96

// Email clients ignore CSS variables, Tailwind and web fonts, so the shell
// is inline styles on tables (react-email's components), with the DESIGN.md
// tokens as generated into tokens.ts and Georgia or system fonts only.
const SYSTEM_SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

const styles = {
  body: {
    margin: 0,
    padding: "24px 0",
    backgroundColor: t.canvas,
    fontFamily: t.fontSerif,
    color: t.foreground,
  },
  container: { width: "100%", maxWidth: "600px", margin: "0 auto" },
  header: {
    backgroundColor: t.navy,
    padding: "20px 24px",
    textAlign: "center" as const,
    borderBottom: `3px solid ${t.brandGold}`,
  },
  card: { backgroundColor: t.white, padding: "28px 24px 32px" },
  heading: {
    margin: "0 0 16px",
    fontFamily: t.fontSerif,
    fontSize: "24px",
    lineHeight: "1.25",
    fontWeight: 700,
    color: t.navy,
  },
  text: {
    margin: "0 0 16px",
    fontFamily: t.fontSerif,
    fontSize: "16px",
    lineHeight: "1.55",
    color: t.foreground,
  },
  button: {
    backgroundColor: t.primary,
    color: t.primaryForeground,
    fontFamily: SYSTEM_SANS,
    fontSize: "16px",
    fontWeight: 600,
    textDecoration: "none",
    padding: "12px 24px",
    borderRadius: "8px",
    display: "inline-block",
  },
  signOff: {
    margin: "24px 0 0",
    fontFamily: t.fontSerif,
    fontSize: "16px",
    fontStyle: "italic" as const,
    color: t.navy,
  },
  footer: {
    padding: "16px 24px 0",
    fontFamily: SYSTEM_SANS,
    fontSize: "12px",
    lineHeight: "1.5",
    color: t.mutedForeground,
    textAlign: "center" as const,
  },
}

const FOOTER_TEXT: Record<EmailAudience, string> = {
  staff: "You are getting this because you are on The Pillar's staff portal.",
  applicant: "You are getting this because you applied to The Pillar.",
}

// An absolute URL on the site, from NEXT_PUBLIC_SITE_URL only. A `path` that
// could point elsewhere (`//host`, a scheme) is refused.
export function siteUrl(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new Error("email.invalid_path")
  }
  // The URL parser drops tabs and newlines, so `/\t/host` would pass the
  // checks above and resolve to another host: compare the origin too.
  const site = new URL(clientEnv.NEXT_PUBLIC_SITE_URL)
  const url = new URL(path, site)
  if (url.origin !== site.origin) throw new Error("email.invalid_path")
  return url.toString()
}

/**
 * The shell every email is drawn in: a navy header with the logo and a 3px
 * gold rule, a white card with the heading, the body and an optional button,
 * and a muted footer on the canvas color. Every link is absolute, built from
 * NEXT_PUBLIC_SITE_URL. Staff email has no sign-off; the applicant variant
 * ends with "For an empowered press."
 */
export function EmailShell({
  preview,
  heading,
  children,
  cta,
  audience,
}: EmailShellProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.header}>
            <Img
              src={siteUrl(LOGO_PATH)}
              width={LOGO_SIZE}
              height={LOGO_SIZE}
              alt="The Pillar"
              style={{ margin: "0 auto", display: "block" }}
            />
          </Section>
          <Section style={styles.card}>
            <Text style={styles.heading}>{heading}</Text>
            {children}
            {cta ? (
              <Section style={{ margin: "8px 0 0" }}>
                <Button href={siteUrl(cta.path)} style={styles.button}>
                  {cta.label}
                </Button>
              </Section>
            ) : null}
            {audience === "applicant" ? (
              <Text style={styles.signOff}>{SIGN_OFF}</Text>
            ) : null}
          </Section>
          <Hr style={{ border: "none", margin: 0 }} />
          <Section style={styles.footer}>
            <Text style={{ margin: 0 }}>{FOOTER_TEXT[audience]}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

/** A body paragraph in the shell's type. */
export function EmailText({ children }: { children: ReactNode }) {
  return <Text style={styles.text}>{children}</Text>
}
