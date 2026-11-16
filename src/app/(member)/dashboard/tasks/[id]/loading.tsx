import { Skeleton } from "@/components/ui/skeleton"

// Task detail's layout in outline while getTaskDetail runs, in the page's
// order: the return link, the owner label, the title, the due chip and
// status, the description, the Role slots heading and three white rows, then
// the two outline buttons.
export default function TaskLoading() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading task</span>
      <Skeleton className="mt-2 h-7 w-24" />
      <Skeleton className="mt-3 h-5 w-16" />
      <Skeleton className="mt-2 h-9 w-3/4" />
      <div className="mt-3 flex items-center gap-4">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-5 w-16" />
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-2/3" />
      </div>
      <Skeleton className="mt-8 h-5 w-24" />
      <div className="mt-3 flex flex-col gap-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:gap-3">
        <Skeleton className="h-11 w-full sm:w-52" />
        <Skeleton className="h-11 w-full sm:w-48" />
      </div>
    </div>
  )
}
