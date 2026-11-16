import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { avatarSlot } from "@/components/ui/avatar-slot"

import { initialsOf } from "../initials"

/**
 * A member's 40px initials avatar on the members screens, in the color their
 * id hashes to (the same one the Board shows). Decorative: the name sits
 * beside it.
 */
export function MemberAvatar({ id, name }: { id: string; name: string }) {
  return (
    <Avatar aria-hidden="true" data-avatar={avatarSlot(id)} className="size-10">
      <AvatarFallback className="bg-(--avatar) text-sm font-semibold text-white">
        {initialsOf(name)}
      </AvatarFallback>
    </Avatar>
  )
}
