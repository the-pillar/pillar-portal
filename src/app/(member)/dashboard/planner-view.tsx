import { getMyHomeScope } from "@/features/members"
import {
  canCreateTask,
  getBoardOwners,
  getPlanner,
  ownerFilterParam,
  parseOwnerFilterParam,
  TaskPlanner,
} from "@/features/tasks"
import { parsePhtMonth, phtDayKey, phtMonthOf, shiftMonth } from "@/lib/time"

// The Planner (EXPERIENCE.md › Planner): one Manila month of every task, Done
// included. The month is the `month` parameter, or the current Manila month
// when it is missing or malformed. The chips (All, Mine, then the viewer's
// home scope, put through the Board's owner check) filter in the client, so
// `owner` is read there. TaskPlanner is not keyed to the month: it stays
// mounted, with its chips and the focused month link, while the next month
// loads. Previous or Next is left out at the edge of the months
// `parsePhtMonth` accepts (1000-01, 9999-12) rather than linking to a month
// that would fall back to the current one. `data-wide-view` widens the shell.
export async function PlannerView({ month }: { month: unknown }) {
  const now = new Date()
  const shown = parsePhtMonth(month) ?? phtMonthOf(now)
  const today = phtDayKey(now)
  const previous = parsePhtMonth(shiftMonth(shown, -1))
  const next = parsePhtMonth(shiftMonth(shown, 1))

  const [owners, homeScope, cards, canCreate] = await Promise.all([
    getBoardOwners(),
    getMyHomeScope(),
    getPlanner(shown),
    canCreateTask(),
  ])
  const home = parseOwnerFilterParam(ownerFilterParam(homeScope), owners)

  return (
    <div data-wide-view>
      <h1 className="font-heading text-display text-navy">Planner</h1>
      <div className="mt-4">
        <TaskPlanner
          month={shown}
          today={today}
          previous={previous}
          next={next}
          home={home}
          owners={owners}
          cards={cards}
          canCreate={canCreate}
        />
      </div>
    </div>
  )
}
