// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useContext } from "react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { StepUpContext } from "@/lib/step-up"

import { StepUpProvider } from "./step-up-provider"

const mfa = vi.hoisted(() => ({
  listFactors: vi.fn(),
  unenroll: vi.fn(),
  enroll: vi.fn(),
  challengeAndVerify: vi.fn(),
}))

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { mfa } }),
}))
vi.mock("@/lib/env.client", () => ({ clientEnv: {} }))

// input-otp reads these in jsdom.
beforeAll(() => {
  document.elementFromPoint = () => null
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const WRONG = {
  data: null,
  error: { code: "mfa_verification_failed", status: 400, message: "Invalid" },
}

function Asker({ onResult }: { onResult: (verified: boolean) => void }) {
  const stepUp = useContext(StepUpContext)
  return (
    <button
      type="button"
      onClick={() => stepUp?.requestStepUp().then(onResult)}
    >
      Ask
    </button>
  )
}

async function open() {
  const onResult = vi.fn()
  const user = userEvent.setup()
  render(
    <StepUpProvider>
      <Asker onResult={onResult} />
    </StepUpProvider>
  )
  await user.click(screen.getByRole("button", { name: "Ask" }))
  return { user, onResult }
}

const codeField = () => screen.getByRole("textbox", { name: "6-digit code" })

describe("StepUpProvider", () => {
  it("asks for the code, and resolves true when it is accepted", async () => {
    mfa.listFactors.mockResolvedValue({
      data: { totp: [{ id: "f1" }], all: [{ id: "f1" }] },
      error: null,
    })
    mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null })
    const { user, onResult } = await open()

    expect(
      await screen.findByText(
        "Enter the 6-digit code from your authenticator app."
      )
    ).toBeInTheDocument()
    expect(await screen.findByRole("textbox")).toHaveAttribute(
      "autocomplete",
      "one-time-code"
    )
    await user.type(codeField(), "123456")

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true))
    expect(mfa.challengeAndVerify).toHaveBeenCalledExactlyOnceWith({
      factorId: "f1",
      code: "123456",
    })
  })

  it("shows the wrong-code line, clears and refocuses the field", async () => {
    mfa.listFactors.mockResolvedValue({
      data: { totp: [{ id: "f1" }], all: [{ id: "f1" }] },
      error: null,
    })
    mfa.challengeAndVerify.mockResolvedValue(WRONG)
    const { user, onResult } = await open()

    await user.type(await screen.findByRole("textbox"), "000000")

    expect(
      await screen.findByText(
        "That code didn't work. Check your authenticator app and try again."
      )
    ).toBeInTheDocument()
    await waitFor(() => expect(codeField()).toHaveValue(""))
    await waitFor(() => expect(document.activeElement).toBe(codeField()))
    expect(onResult).not.toHaveBeenCalled()
  })

  it("resolves false on Cancel (Escape)", async () => {
    mfa.listFactors.mockResolvedValue({
      data: { totp: [{ id: "f1" }], all: [{ id: "f1" }] },
      error: null,
    })
    const { user, onResult } = await open()
    await screen.findByRole("textbox")

    await user.keyboard("{Escape}")

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false))
    expect(mfa.challengeAndVerify).not.toHaveBeenCalled()
  })

  it("leads into setup when there is no verified factor, and the first code counts", async () => {
    mfa.listFactors.mockResolvedValue({
      data: {
        totp: [],
        all: [{ id: "stale", factor_type: "totp", status: "unverified" }],
      },
      error: null,
    })
    mfa.unenroll.mockResolvedValue({ data: {}, error: null })
    mfa.enroll.mockResolvedValue({
      data: {
        id: "new",
        totp: { qr_code: "data:image/svg+xml;utf8,<svg/>", secret: "ABCD1234" },
      },
      error: null,
    })
    mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null })
    const { user, onResult } = await open()

    expect(
      await screen.findByAltText("QR code for your authenticator app")
    ).toBeInTheDocument()
    expect(screen.getByText("ABCD1234")).toBeInTheDocument()
    expect(mfa.unenroll).toHaveBeenCalledExactlyOnceWith({ factorId: "stale" })
    expect(mfa.enroll).toHaveBeenCalledExactlyOnceWith({ factorType: "totp" })

    await user.type(codeField(), "654321")

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true))
    expect(mfa.challengeAndVerify).toHaveBeenCalledExactlyOnceWith({
      factorId: "new",
      code: "654321",
    })
  })

  it("shows the generic save line when enrolling fails", async () => {
    mfa.listFactors.mockResolvedValue({
      data: { totp: [], all: [] },
      error: null,
    })
    mfa.enroll.mockResolvedValue({ data: null, error: { message: "nope" } })
    await open()

    expect(
      await screen.findByText("Couldn't save — try again.")
    ).toBeInTheDocument()
  })
})
