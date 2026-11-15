// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MemberNameEditor } from "./member-name-editor"

const { renameMemberAction, refresh, toastError, toastSuccess } = vi.hoisted(
  () => ({
    renameMemberAction: vi.fn(),
    refresh: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
  })
)

vi.mock("../actions", () => ({ renameMemberAction }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("sonner", () => ({
  toast: { error: toastError, success: toastSuccess },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const ID = "00000000-0000-4000-8000-000000000081"
const MEMBER = {
  id: ID,
  name: "AXEL ARANZADO",
  googleName: "AXEL ARANZADO" as string | null,
  canRename: true,
}
const STALE =
  "Something changed since you opened this. Review the latest and try again."

const editButton = () =>
  screen.getByRole("button", { name: "Edit name for AXEL ARANZADO" })
const field = () => screen.getByRole("textbox", { name: "Display name" })

describe("MemberNameEditor", () => {
  it("shows the name and an Edit name button", async () => {
    const { container } = render(<MemberNameEditor member={MEMBER} as="h3" />)

    expect(
      screen.getByRole("heading", { level: 3, name: "AXEL ARANZADO" })
    ).toBeInTheDocument()
    expect(editButton()).toHaveClass("min-h-11")
    expect(await axe.run(container).then((r) => r.violations)).toEqual([])
  })

  it("offers no Edit name when canRename is false", () => {
    render(<MemberNameEditor member={{ ...MEMBER, canRename: false }} as="p" />)

    expect(screen.getByText("AXEL ARANZADO")).toBeInTheDocument()
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("opens a form with the name, the Google hint, Save and Cancel", async () => {
    const user = userEvent.setup()
    const { container } = render(<MemberNameEditor member={MEMBER} as="p" />)

    await user.click(editButton())

    expect(field()).toHaveValue("AXEL ARANZADO")
    expect(field()).not.toHaveAttribute("maxlength")
    expect(field()).toHaveFocus()
    expect(field()).toHaveAccessibleDescription("Google: AXEL ARANZADO")
    expect(screen.getByRole("button", { name: /^Save/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Cancel/ })).toBeInTheDocument()
    expect(await axe.run(container).then((r) => r.violations)).toEqual([])
  })

  it("omits the hint when Google sent no name", async () => {
    const user = userEvent.setup()
    render(<MemberNameEditor member={{ ...MEMBER, googleName: null }} as="p" />)

    await user.click(editButton())

    expect(screen.queryByText(/^Google:/)).toBeNull()
  })

  it("saves the typed name on Save, toasts the saved name and returns focus to Edit name", async () => {
    const user = userEvent.setup()
    renameMemberAction.mockResolvedValue({
      ok: true,
      data: { memberId: ID, name: "Axel Aranzado" },
    })
    render(<MemberNameEditor member={MEMBER} as="h3" />)

    await user.click(editButton())
    await user.clear(field())
    await user.type(field(), "  Axel Aranzado ")
    await user.click(screen.getByRole("button", { name: /^Save/ }))

    expect(renameMemberAction).toHaveBeenCalledExactlyOnceWith({
      memberId: ID,
      name: "Axel Aranzado",
    })
    await waitFor(() => expect(editButton()).toHaveFocus())
    expect(toastSuccess).toHaveBeenCalledExactlyOnceWith(
      "Name changed to Axel Aranzado."
    )
    expect(screen.queryByRole("textbox")).toBeNull()
  })

  it("saves on Enter", async () => {
    const user = userEvent.setup()
    renameMemberAction.mockResolvedValue({
      ok: true,
      data: { memberId: ID, name: "Axel" },
    })
    render(<MemberNameEditor member={MEMBER} as="h3" />)

    await user.click(editButton())
    await user.clear(field())
    await user.type(field(), "Axel{Enter}")

    expect(renameMemberAction).toHaveBeenCalledExactlyOnceWith({
      memberId: ID,
      name: "Axel",
    })
  })

  it.each([
    [
      "Cancel",
      async (user: ReturnType<typeof userEvent.setup>) =>
        user.click(screen.getByRole("button", { name: /^Cancel/ })),
    ],
    [
      "Escape",
      async (user: ReturnType<typeof userEvent.setup>) =>
        user.keyboard("{Escape}"),
    ],
  ])("%s closes the form without saving and returns focus", async (_l, act) => {
    const user = userEvent.setup()
    render(<MemberNameEditor member={MEMBER} as="h3" />)

    await user.click(editButton())
    await user.type(field(), " changed")
    await act(user)

    expect(renameMemberAction).not.toHaveBeenCalled()
    await waitFor(() => expect(editButton()).toHaveFocus())
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      "AXEL ARANZADO"
    )
  })

  it("says Add a name. under a blank field, without calling", async () => {
    const user = userEvent.setup()
    render(<MemberNameEditor member={MEMBER} as="h3" />)

    await user.click(editButton())
    await user.clear(field())
    await user.type(field(), "   ")
    await user.click(screen.getByRole("button", { name: /^Save/ }))

    expect(screen.getByText("Add a name.")).toBeInTheDocument()
    expect(field()).toHaveAttribute("aria-invalid", "true")
    expect(field()).toHaveFocus()
    expect(renameMemberAction).not.toHaveBeenCalled()
  })

  it("says Use 100 characters or fewer. for 101 characters, without calling, and clears it on typing", async () => {
    const user = userEvent.setup()
    render(<MemberNameEditor member={MEMBER} as="h3" />)

    await user.click(editButton())
    await user.clear(field())
    await user.click(field())
    await user.paste("x".repeat(101))
    await user.click(screen.getByRole("button", { name: /^Save/ }))

    expect(screen.getByText("Use 100 characters or fewer.")).toBeInTheDocument()
    expect(renameMemberAction).not.toHaveBeenCalled()

    await user.type(field(), "y")
    expect(screen.queryByText("Use 100 characters or fewer.")).toBeNull()
  })

  it("toasts the stale line and re-reads when the member changed meanwhile", async () => {
    const user = userEvent.setup()
    renameMemberAction.mockResolvedValue({ ok: false, code: "members.stale" })
    render(<MemberNameEditor member={MEMBER} as="h3" />)

    await user.click(editButton())
    await user.click(screen.getByRole("button", { name: /^Save/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(STALE))
    expect(refresh).toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
  })
})
