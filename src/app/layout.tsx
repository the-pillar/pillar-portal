import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Toaster } from "@/components/ui/toast"

import "./globals.css"
import { cn } from "@/lib/utils"

const fontSans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

// Every page gives only its name; the template adds " · The Pillar", and a
// page with no title is "The Pillar".
export const metadata: Metadata = {
  title: { template: "%s · The Pillar", default: "The Pillar" },
}

// `cover` lets the bottom tab bar's safe-area inset reach the home indicator
// (DESIGN.md › Bottom tab bar).
export const viewport: Viewport = {
  viewportFit: "cover",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={cn("antialiased", fontSans.variable, fontMono.variable)}
    >
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  )
}
