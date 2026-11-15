// A member's avatar color is one of eight slots (`avatar-1…8` in DESIGN.md),
// chosen by a stable hash of the member id so a person keeps their color on
// every screen. Components render the slot as `data-avatar`; globals.css maps
// it to `--avatar`. TypeScript names no colors.

export const AVATAR_SLOT_COUNT = 8

/** FNV-1a over the id's UTF-16 code units, then modulo the slot count. */
export function avatarSlot(memberId: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < memberId.length; i++) {
    hash ^= memberId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return (hash % AVATAR_SLOT_COUNT) + 1
}
