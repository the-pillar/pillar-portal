import { Skeleton } from "@/components/ui/skeleton"

// "Needs you" in outline while the counts are read: the heading and two
// count rows, with the checklist's card beside them from lg. The page's h1
// sits outside the Suspense boundary, so it isn't repeated here.
export function AdminHomeSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="mt-6 grid items-start gap-6 lg:grid-cols-2"
    >
      <span className="sr-only">Loading admin home</span>
      <div>
        <Skeleton className="h-5 w-24" />
        <div className="mt-3 grid gap-2">
          <Skeleton className="h-[50px] w-full rounded-lg" />
          <Skeleton className="h-[50px] w-full rounded-lg" />
        </div>
      </div>
      <Skeleton className="hidden h-40 w-full rounded-lg lg:block" />
    </div>
  )
}
