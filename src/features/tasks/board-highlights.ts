// Which cards a refetch should highlight (spine AD-14). Pure and client-safe.

type Versioned = {
  id: string
  column: string
  movedBy: string | null
  createdBy: string | null
}

/**
 * The ids to highlight once after a refetch: a card whose column changed
 * since `previous` and was moved by someone else, or a new card someone else
 * created. Both lists are the Board's whole window, never a filtered view, so
 * a filter change can't produce a highlight. The viewer's own moves and new
 * tasks never highlight; nothing is compared on the first render, because
 * the caller has no `previous` then.
 */
export function highlightedIds(
  previous: readonly Versioned[],
  next: readonly Versioned[],
  viewerId: string
): string[] {
  const before = new Map(previous.map((card) => [card.id, card]))
  return next
    .filter((card) => {
      const was = before.get(card.id)
      return was
        ? was.column !== card.column && card.movedBy !== viewerId
        : card.createdBy !== viewerId
    })
    .map((card) => card.id)
}
