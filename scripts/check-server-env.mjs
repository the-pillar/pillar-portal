// Fails the build when a server-only environment variable is missing or
// malformed, naming it, before `next build` starts. It imports
// `src/lib/env.server.ts`, which parses `process.env` against `serverEnvSchema`
// and throws on a bad value (AD-6), so the check doesn't depend on which route
// modules happen to reach `env.server` while Next collects page data.
//
// Run with `node --conditions=react-server` so `server-only` resolves
// (`next.config.ts` can't import it: `server-only` throws there).
//
// Usage: node --conditions=react-server scripts/check-server-env.mjs [--root <dir>]
//   --root  project root holding src/lib/env.server.ts (default: this repo;
//           nothing needs to change it)
import path from "node:path"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"

const { values: args } = parseArgs({ options: { root: { type: "string" } } })
const ROOT = path.resolve(args.root ?? path.join(import.meta.dirname, ".."))

try {
  await import(
    pathToFileURL(path.join(ROOT, "src", "lib", "env.server.ts")).href
  )
} catch (error) {
  console.error(
    `check:env: server environment is invalid.\n${error instanceof Error ? error.message : String(error)}`
  )
  process.exit(1)
}
console.log("check:env: OK, server environment is valid")
