import Image from "next/image"
import Link from "next/link"

import { cn } from "@/lib/utils"

// Navy can't show on the navy header and gold is never a focus ring, so
// header controls get the `ring-on-dark` (white) outline instead of the navy
// ring (DESIGN.md). No `outline-none` with it: in Tailwind 4 that sets the
// outline style to none, which `outline-2` then inherits.
export const HEADER_FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-on-dark"

/**
 * The app header (DESIGN.md › App header): a navy bar with the logo and the
 * wordmark at left, the 3px brand-gold rule along the bottom, and `children`
 * (such as the avatar menu) at right. With `homeHref`, the logo and wordmark
 * link there.
 *
 * - `tabs`: the view tabs in the header's own row, from `md` (the member
 *   shell; below `md` they are the bottom tab bar instead).
 * - `nav`: a second row under the first, as wide as it (the admin tab row).
 * - `action`: the New task pill's slot (Story 8.8). From `md` it sits before
 *   the avatar; below `md` it floats 16px from the right edge, above the
 *   bottom tab bar when `hasBottomBar`.
 */
export function AppHeader({
  homeHref,
  className,
  tabs,
  nav,
  action,
  hasBottomBar = false,
  children,
}: {
  homeHref?: string
  /** Merged onto the inner content div, so a wider shell (admin routes go up
   * to 1440px, DESIGN.md) can override the default 640px `max-w-160`. */
  className?: string
  tabs?: React.ReactNode
  nav?: React.ReactNode
  action?: React.ReactNode
  hasBottomBar?: boolean
  children?: React.ReactNode
}) {
  const brand = (
    <>
      <Image
        src="/thepillar-logo.png"
        alt=""
        width={34}
        height={34}
        loading="eager"
      />
      <span className="font-heading text-wordmark-fallback">The Pillar</span>
    </>
  )

  return (
    <header className="border-b-3 border-brand-gold bg-navy text-white">
      <div
        className={cn(
          "mx-auto flex min-h-14 w-full max-w-160 items-center gap-4 px-page-margin-mobile md:px-page-margin-desktop",
          className
        )}
      >
        {homeHref ? (
          <Link
            href={homeHref}
            className={cn(
              "flex min-h-11 shrink-0 items-center gap-2.5 rounded-sm",
              HEADER_FOCUS
            )}
          >
            {brand}
          </Link>
        ) : (
          <div className="flex min-h-11 shrink-0 items-center gap-2.5">
            {brand}
          </div>
        )}
        {tabs && <div className="hidden min-w-0 flex-1 md:block">{tabs}</div>}
        <div className="ml-auto flex items-center gap-3">
          {action && (
            <div
              data-slot="header-action"
              className={cn(
                "fixed right-4 z-30 md:static md:z-auto",
                "bottom-4",
                hasBottomBar &&
                  "tabbar-fixed:bottom-[calc(var(--bottom-tab-bar-clear)+8px)]"
              )}
            >
              {action}
            </div>
          )}
          {children}
        </div>
      </div>
      {nav && (
        <div
          className={cn(
            "mx-auto w-full max-w-160 px-page-margin-mobile md:px-page-margin-desktop",
            className
          )}
        >
          {nav}
        </div>
      )}
    </header>
  )
}
