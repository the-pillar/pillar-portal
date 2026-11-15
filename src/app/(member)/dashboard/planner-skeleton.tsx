import { Skeleton } from "@/components/ui/skeleton"

// The whole Planner in outline: the h1, the chip row, the month heading and
// its controls, then the month: day cells from md with a fine pointer, a few
// 44px day rows below md and on any-pointer coarse screens (the same CSS
// split as the Planner itself). `data-wide-view` widens the shell as soon as
// this shows, so the width doesn't jump when the Planner arrives.
// dashboard/page.tsx uses it as the Planner's Suspense fallback, so it never
// shows for another view; a month change keeps the Planner mounted instead.
export function PlannerSkeleton() {
  return (
    <div data-wide-view>
      <Skeleton className="h-9 w-40" />
      <div className="mt-4 flex gap-2">
        {[0, 1, 2].map((n) => (
          <Skeleton key={n} className="h-9 w-24 rounded-full" />
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-4">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-11 w-44" />
      </div>
      <div role="status" aria-busy="true" className="mt-4">
        <span className="sr-only">Loading the planner</span>
        <div className="hidden grid-cols-7 gap-1 md:not-any-pointer-coarse:grid">
          {Array.from({ length: 35 }, (_, n) => (
            <Skeleton key={n} className="h-28" />
          ))}
        </div>
        <div className="flex flex-col gap-2 md:not-any-pointer-coarse:hidden">
          {[0, 1, 2, 3].map((n) => (
            <Skeleton key={n} className="h-11 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}
