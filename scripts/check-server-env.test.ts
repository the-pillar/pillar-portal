import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { runScript } from "./test-fixture"

const REPO_ROOT = path.join(import.meta.dirname, "..")

// Built at runtime so no key-shaped literal sits in the source (GitHub's push
// protection would block it as a Supabase secret).
const VALID_KEY = "sb_secret_" + "0123456789abcdefghijklmnopqrstu"

function checkEnv(env: Record<string, string>) {
  return runScript("check-server-env.mjs", REPO_ROOT, {
    nodeArgs: ["--conditions=react-server"],
    env,
  })
}

describe("check:env", () => {
  it("passes with a valid server environment, printing one OK line", () => {
    const result = checkEnv({ SUPABASE_SECRET_KEY: VALID_KEY })

    expect(result.status).toBe(0)
    expect(result.output.trim().split("\n")).toHaveLength(1)
    expect(result.output).toContain("check:env: OK")
  })

  it("fails without the secret key, naming it and printing no stack", () => {
    const result = checkEnv({})

    expect(result.status).toBe(1)
    expect(result.output).toContain("SUPABASE_SECRET_KEY")
    expect(result.output).not.toMatch(/\n\s+at /)
  })

  it("fails with a malformed secret key", () => {
    const result = checkEnv({ SUPABASE_SECRET_KEY: "bad" })

    expect(result.status).toBe(1)
    expect(result.output).toContain(
      "SUPABASE_SECRET_KEY: must be a secret key (sb_secret_…)"
    )
  })

  it("runs before next build in the build script", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
    ) as { scripts: Record<string, string> }
    const steps = pkg.scripts.build.split("&&").map((step) => step.trim())

    expect(steps.indexOf("pnpm check:env")).toBeGreaterThanOrEqual(0)
    expect(steps.indexOf("pnpm check:env")).toBeLessThan(
      steps.indexOf("next build")
    )
  })
})
