import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { type Fixture, makeFixture } from "./test-fixture"

let fixture: Fixture | undefined

afterEach(() => {
  fixture?.cleanup()
  fixture = undefined
})

const CSS = `
@theme static {
  --color-navy: #07253F; /* the brand navy */
  --color-brand-gold: #f3b229;
  --color-canvas: #faf7f2;
  --color-white: #ffffff;
  --color-body: #1f1f1f;
  --color-body-muted: #6b665e;
  --font-serif: Georgia, "Times New Roman", serif;
}
:root {
  --foreground: var(--color-body);
  --muted-foreground: var(--color-body-muted);
  --primary: var(--color-navy);
  --primary-foreground: var(--color-white);
}
`

function runWith(root: string, flags: string[]) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(import.meta.dirname, "generate-email-tokens.mjs"),
      ...flags,
      "--root",
      root,
    ],
    { encoding: "utf8", env: { NODE_ENV: "test" }, timeout: 30_000 }
  )
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

function run(css: string, ...flags: string[]) {
  fixture = makeFixture({ "src/app/globals.css": css })
  return { root: fixture.root, result: runWith(fixture.root, flags) }
}

describe("email:tokens", () => {
  it("writes tokens.ts with var() chains resolved and hex lowercased", () => {
    const { root, result } = run(CSS)

    expect(result.status).toBe(0)
    const written = readFileSync(
      path.join(root, "src/features/email/tokens.ts"),
      "utf8"
    )
    expect(written).toContain('navy: "#07253f",')
    expect(written).toContain('primary: "#07253f",')
    expect(written).toContain('mutedForeground: "#6b665e",')
    expect(written).toContain(`fontSerif: 'Georgia, "Times New Roman", serif',`)
    expect(written).toContain("as const")
  })

  it("fails --check until the file is regenerated after a token changes", () => {
    const first = run(CSS)
    expect(first.result.status).toBe(0)
    expect(runWith(first.root, ["--check"]).status).toBe(0)

    const changed = CSS.replace("#07253F", "#112233")
    writeFileSync(path.join(first.root, "src/app/globals.css"), changed)

    const stale = runWith(first.root, ["--check"])
    expect(stale.status).toBe(1)
    expect(stale.output).toContain("pnpm email:tokens")

    expect(runWith(first.root, []).status).toBe(0)
    expect(runWith(first.root, ["--check"]).status).toBe(0)
  })

  it("fails --check when tokens.ts is missing", () => {
    const { result } = run(CSS, "--check")
    expect(result.status).toBe(1)
  })

  it("fails on a color that does not resolve to a hex value", () => {
    const { result } = run(CSS.replace("#faf7f2", "oklch(0.9 0 0)"))
    expect(result.status).toBe(1)
    expect(result.output).toContain("--color-canvas")
  })

  it("fails on a missing token", () => {
    const { result } = run(CSS.replace("--color-brand-gold: #f3b229;", ""))
    expect(result.status).toBe(1)
    expect(result.output).toContain("--color-brand-gold")
  })
})
