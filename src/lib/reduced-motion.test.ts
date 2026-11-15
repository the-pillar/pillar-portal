import { afterEach, describe, expect, it, vi } from "vitest"

import { prefersReducedMotion, scrollBehavior } from "./reduced-motion"

afterEach(() => vi.unstubAllGlobals())

function stubMatchMedia(matches: boolean) {
  const matchMedia = vi.fn().mockReturnValue({ matches })
  vi.stubGlobal("window", { matchMedia })
  return matchMedia
}

describe("reduced motion", () => {
  it("is false with no window", () => {
    expect(prefersReducedMotion()).toBe(false)
    expect(scrollBehavior()).toBe("smooth")
  })

  it("reads the media query", () => {
    const matchMedia = stubMatchMedia(true)
    expect(prefersReducedMotion()).toBe(true)
    expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)")
    expect(scrollBehavior()).toBe("auto")
  })

  it("is smooth when motion is allowed", () => {
    stubMatchMedia(false)
    expect(prefersReducedMotion()).toBe(false)
    expect(scrollBehavior()).toBe("smooth")
  })
})
