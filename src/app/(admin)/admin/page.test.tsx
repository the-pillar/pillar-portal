import { Suspense, type ReactElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const {
  counts,
  list,
  requireAdmin,
  AdminHomeCards,
  AdminHomeSkeleton,
  getMyOnboarding,
  countPending,
  hasCreatedTask,
  canCreateTask,
  recordErrorEvent,
  OnboardingChecklist,
  OnboardingTour,
  NewTaskTrigger,
  recordOnboardingAction,
} = vi.hoisted(() => ({
  // Two fixture link cards, so the test can see both counts start
  // together, and a list card between them.
  counts: [
    {
      id: "pending-approvals",
      label: "Awaiting approval",
      href: "/admin/members",
      count: vi.fn<() => Promise<number>>(),
    },
    {
      id: "fixture",
      label: "Fixture",
      href: "/admin/fixture",
      count: vi.fn<() => Promise<number>>(),
    },
  ],
  list: {
    id: "handed-back",
    label: "Needs reassignment",
    href: "/admin/tasks",
    linkLabel: "Reassign in Tasks",
    rows: vi.fn<
      () => Promise<{ id: string; text: string; reason: string | null }[]>
    >(),
  },
  requireAdmin: vi.fn(),
  AdminHomeCards: vi.fn(() => null),
  AdminHomeSkeleton: vi.fn(() => null),
  getMyOnboarding: vi.fn(),
  countPending: vi.fn(),
  hasCreatedTask: vi.fn(),
  canCreateTask: vi.fn(),
  recordErrorEvent: vi.fn(),
  OnboardingChecklist: vi.fn(() => null),
  OnboardingTour: vi.fn(() => null),
  NewTaskTrigger: vi.fn(() => null),
  recordOnboardingAction: vi.fn(),
}))

vi.mock("next/server", () => ({
  after: (callback: () => unknown) => void callback(),
}))
vi.mock("@/lib/record-error-event", () => ({ recordErrorEvent }))
vi.mock("@/features/members", () => ({
  getMyOnboarding,
  countPendingApprovalsForViewer: countPending,
  OnboardingChecklist,
  OnboardingTour,
  recordOnboardingAction,
}))
vi.mock("@/features/tasks", () => ({
  canCreateTask,
  hasCreatedTaskForViewer: hasCreatedTask,
  NewTaskTrigger,
}))

vi.mock("../require-admin", () => ({ requireAdmin }))
vi.mock("./admin-home-counts", () => ({
  ADMIN_HOME_COUNTS: [counts[0], list, counts[1]],
}))
vi.mock("./admin-home", () => ({ AdminHomeCards }))
vi.mock("./admin-home-skeleton", () => ({ AdminHomeSkeleton }))

import AdminHomePage, { metadata } from "./page"

afterEach(() => {
  vi.resetAllMocks()
})

beforeEach(() => {
  getMyOnboarding.mockResolvedValue(null)
  countPending.mockResolvedValue(0)
  hasCreatedTask.mockResolvedValue(false)
  canCreateTask.mockResolvedValue(true)
})

const ADMIN_ONBOARDING = {
  tourAndChecklist: true,
  tourSeen: false,
  copiedTask: false,
  checklistDone: false,
  firstRunShown: false,
  firstRunClosed: false,
  twoFactor: false,
  approvedMember: false,
}

const search = (tour?: string) =>
  ({ searchParams: Promise.resolve({ tour }) }) as never

type Element = ReactElement<
  {
    children: Element | Element[]
    fallback?: Element
  } & Record<string, unknown>
>

const ROWS = [
  {
    id: "s1",
    text: "Draw the strip · Cartoonist · Editor-in-Chief",
    reason: "Busy",
  },
  { id: "s2", text: "Lay out the spread · Layout Artist · Sam", reason: null },
]

async function renderBody(tour?: string) {
  const page = (await AdminHomePage(search(tour))) as Element
  const [, boundary] = page.props.children as Element[]
  const loader = boundary.props.children as Element
  return (loader.type as (props: unknown) => Promise<Element>)(loader.props)
}

// The cards element, the first child of the body's fragment.
async function renderCards() {
  const body = await renderBody()
  return (body.props.children as Element[])[0]
}

describe("AdminHomePage", () => {
  it("is titled Admin home", () => {
    expect(metadata).toEqual({ title: "Admin home" })
  })

  it("checks for an admin, then renders the h1 and the cards inside a Suspense boundary with the skeleton", async () => {
    requireAdmin.mockResolvedValue({ role: "editorial_admin" })

    const page = (await AdminHomePage(search())) as Element
    const [h1, boundary] = page.props.children as Element[]

    expect(requireAdmin).toHaveBeenCalledOnce()
    expect(h1.type).toBe("h1")
    expect(h1.props.children).toBe("Admin home")
    expect(h1.props.id).toBe("admin-home-heading")
    expect(h1.props.tabIndex).toBe(-1)
    expect(boundary.type).toBe(Suspense)
    expect(boundary.props.fallback?.type).toBe(AdminHomeSkeleton)
    // Nothing is read until the boundary's child renders.
    for (const { count } of counts) expect(count).not.toHaveBeenCalled()
    expect(list.rows).not.toHaveBeenCalled()
  })

  it("reads every count and list in parallel and hands the cards their numbers, a list card its rows counted", async () => {
    requireAdmin.mockResolvedValue({ role: "editorial_admin" })
    let releaseFirst!: (n: number) => void
    counts[0].count.mockReturnValue(
      new Promise((resolve) => (releaseFirst = resolve))
    )
    counts[1].count.mockResolvedValue(0)
    list.rows.mockResolvedValue(ROWS)

    const rendering = renderCards()

    // The others start while the first is still in flight.
    await vi.waitFor(() => expect(counts[0].count).toHaveBeenCalledOnce())
    expect(list.rows).toHaveBeenCalledOnce()
    expect(counts[1].count).toHaveBeenCalledOnce()
    releaseFirst(2)
    const rendered = (await rendering) as Element

    expect(rendered.type).toBe(AdminHomeCards)
    expect(rendered.props).toEqual({
      cards: [
        {
          id: "pending-approvals",
          label: "Awaiting approval",
          href: "/admin/members",
          count: 2,
        },
        {
          id: "handed-back",
          label: "Needs reassignment",
          href: "/admin/tasks",
          count: 2,
          preview: { rows: ROWS, linkLabel: "Reassign in Tasks" },
        },
        { id: "fixture", label: "Fixture", href: "/admin/fixture", count: 0 },
      ],
    })
  })

  it("gives a list card with no rows a count of 0", async () => {
    requireAdmin.mockResolvedValue({ role: "editorial_admin" })
    counts[0].count.mockResolvedValue(0)
    counts[1].count.mockResolvedValue(0)
    list.rows.mockResolvedValue([])

    const rendered = (await renderCards()) as unknown as ReactElement<{
      cards: { id: string; count: number }[]
    }>

    expect(
      rendered.props.cards.find((card) => card.id === "handed-back")?.count
    ).toBe(0)
  })

  it.each([
    ["a count", () => counts[0].count],
    ["a list's rows", () => list.rows],
  ])("lets a throwing read throw (Next's error page): %s", async (_, read) => {
    requireAdmin.mockResolvedValue({ role: "editorial_admin" })
    const failure = new Error("read failed")
    counts[0].count.mockResolvedValue(0)
    counts[1].count.mockResolvedValue(0)
    list.rows.mockResolvedValue([])
    read().mockRejectedValue(failure)

    await expect(renderCards()).rejects.toBe(failure)
  })

  it("runs the admin check first and reads no count when it redirects", async () => {
    const redirectError = new Error("NEXT_REDIRECT /dashboard")
    requireAdmin.mockRejectedValue(redirectError)

    await expect(AdminHomePage(search())).rejects.toBe(redirectError)
    for (const { count } of counts) expect(count).not.toHaveBeenCalled()
    expect(list.rows).not.toHaveBeenCalled()
  })

  describe("onboarding (Story 8.9)", () => {
    function body() {
      counts[0].count.mockResolvedValue(0)
      counts[1].count.mockResolvedValue(0)
      list.rows.mockResolvedValue([])
    }
    async function children(tour?: string) {
      body()
      const rendered = await renderBody(tour)
      return (rendered.props.children as (Element | null)[]).slice(1)
    }

    it("shows the checklist and the tour to a fresh admin, from my_onboarding alone", async () => {
      requireAdmin.mockResolvedValue({ role: "editorial_admin" })
      getMyOnboarding.mockResolvedValue({
        ...ADMIN_ONBOARDING,
        twoFactor: true,
      })
      hasCreatedTask.mockResolvedValue(true)
      countPending.mockResolvedValue(2)

      const [checklist, tour] = (await children()) as Element[]

      expect(checklist.type).toBe(OnboardingChecklist)
      expect(checklist.props).toMatchObject({
        items: {
          twoFactor: true,
          createdTask: true,
          copiedTask: false,
          approvedMember: false,
        },
        pending: 2,
        record: recordOnboardingAction,
        fallbackHeadingId: "admin-home-heading",
      })
      expect(tour.type).toBe(OnboardingTour)
      expect(tour.key).toBe("first")
      expect(tour.props).toMatchObject({
        replay: false,
        record: recordOnboardingAction,
        returnFocusId: "admin-home-heading",
      })
    })

    it("counts nobody pending as the approve item done", async () => {
      requireAdmin.mockResolvedValue({ role: "editorial_admin" })
      getMyOnboarding.mockResolvedValue(ADMIN_ONBOARDING)

      const [checklist] = (await children()) as Element[]

      expect(
        (checklist.props as unknown as { items: { approvedMember: boolean } })
          .items.approvedMember
      ).toBe(true)
    })

    it("shows no tour once seen, and no checklist once done", async () => {
      requireAdmin.mockResolvedValue({ role: "editorial_admin" })
      getMyOnboarding.mockResolvedValue({
        ...ADMIN_ONBOARDING,
        tourSeen: true,
        checklistDone: true,
      })

      expect(await children()).toEqual([false, false])
    })

    it("replays a seen tour for ?tour=again, writing nothing (replay)", async () => {
      requireAdmin.mockResolvedValue({ role: "editorial_admin" })
      getMyOnboarding.mockResolvedValue({
        ...ADMIN_ONBOARDING,
        tourSeen: true,
        checklistDone: true,
      })

      const [, tour] = (await children("again")) as Element[]

      expect(tour.type).toBe(OnboardingTour)
      expect((tour.props as unknown as { replay: boolean }).replay).toBe(true)
      // A different key from a first showing's, so a tour that ended on this
      // same page remounts and replays.
      expect(tour.key).toBe("again")
    })

    it("shows neither when the member gets the staff card, or the read failed", async () => {
      requireAdmin.mockResolvedValue({ role: "editorial_admin" })
      getMyOnboarding.mockResolvedValue({
        ...ADMIN_ONBOARDING,
        tourAndChecklist: false,
      })
      expect(await children()).toEqual([null, null])

      getMyOnboarding.mockResolvedValue(null)
      expect(await children()).toEqual([null, null])
    })

    it("records a failed created-task read and leaves that item to do", async () => {
      requireAdmin.mockResolvedValue({ role: "editorial_admin" })
      getMyOnboarding.mockResolvedValue(ADMIN_ONBOARDING)
      const failure = new Error("count failed")
      hasCreatedTask.mockRejectedValue(failure)

      const [checklist] = (await children()) as Element[]

      expect(recordErrorEvent).toHaveBeenCalledWith(failure, {
        route: "render (admin)/admin",
      })
      expect(
        (checklist.props as unknown as { items: { createdTask: boolean } })
          .items.createdTask
      ).toBe(false)
    })

    it("passes no Create a task slot when the viewer can't create tasks", async () => {
      requireAdmin.mockResolvedValue({ role: "editorial_admin" })
      getMyOnboarding.mockResolvedValue(ADMIN_ONBOARDING)
      canCreateTask.mockResolvedValue(false)

      const [checklist] = (await children()) as Element[]

      expect(
        (checklist.props as unknown as { createTask: unknown }).createTask
      ).toBeNull()
    })
  })
})
