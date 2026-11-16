// The id of the task just created, handed from the New task sheet to the
// Board and the Planner in memory (spine AD-23: no storage), so each can
// highlight its card or chip once it appears. Client only.

type Listener = (id: string) => void

const listeners = new Set<Listener>()
// A signal older than this is for a page long gone.
const FRESH_MS = 60_000

let latest: { id: string; at: number } | null = null

/** The sheet announces a created task. */
export function emitCreatedTask(id: string) {
  latest = { id, at: Date.now() }
  for (const listener of listeners) listener(id)
}

/** A view listens; it also hears the id announced just before it mounted. */
export function subscribeCreatedTask(listener: Listener): () => void {
  listeners.add(listener)
  if (latest !== null && Date.now() - latest.at < FRESH_MS) {
    listener(latest.id)
  }
  return () => {
    listeners.delete(listener)
  }
}

/** A view that has highlighted the id releases it. */
export function clearCreatedTask(id: string) {
  if (latest?.id === id) latest = null
}
