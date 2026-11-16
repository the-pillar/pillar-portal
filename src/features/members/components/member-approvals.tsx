import type { MemberApprovalsData } from "../queries"
import { MemberDeactivate } from "./member-deactivate"
import { MemberMfaReset } from "./member-mfa-reset"
import { MemberAvatar } from "./member-avatar"
import { MemberNameEditor } from "./member-name-editor"
import { MemberPositionEditor } from "./member-position-editor"
import { PendingMemberCard } from "./pending-member-card"

const AWAITING_HEADING_ID = "awaiting-approval-heading"
const ACTIVE_HEADING_ID = "active-members-heading"

/**
 * /admin/members' two lists (Story 2.2): "Awaiting approval", one card per
 * pending member, oldest first, and the "Active members" roster by name,
 * each with their positions, the primary first, and Edit name,
 * Change positions, Reset two-factor and Deactivate where
 * `member_capabilities` offers them (Stories 8.2 and 5.4).
 * An approved or declined member leaves the first list, so the heading is
 * where focus goes then.
 */
export function MemberApprovals({
  approvals,
}: {
  approvals: MemberApprovalsData
}) {
  const { pending, roster, positionGroups } = approvals

  return (
    <div className="mt-6 flex max-w-3xl flex-col gap-8">
      <section aria-labelledby={AWAITING_HEADING_ID}>
        <h2
          id={AWAITING_HEADING_ID}
          tabIndex={-1}
          className="rounded-sm font-heading text-heading-sm text-navy outline-offset-2 focus-visible:outline-2"
        >
          Awaiting approval
        </h2>
        {pending.length === 0 ? (
          <p className="mt-3 text-muted-foreground">
            No one is waiting for approval.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {pending.map((member) => (
              <PendingMemberCard
                key={member.id}
                member={member}
                positionGroups={positionGroups}
                focusTargetId={AWAITING_HEADING_ID}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={ACTIVE_HEADING_ID}>
        <h2
          id={ACTIVE_HEADING_ID}
          tabIndex={-1}
          className="rounded-sm font-heading text-heading-sm text-navy outline-offset-2 focus-visible:outline-2"
        >
          Active members
        </h2>
        <ul className="mt-3 flex flex-col gap-2">
          {roster.map((member) => (
            <li
              key={member.id}
              className="flex gap-3 rounded-lg bg-card p-card-padding shadow-card"
            >
              <MemberAvatar id={member.id} name={member.name} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <MemberNameEditor
                  member={member}
                  as="p"
                  nameClassName="font-medium break-words"
                />
                <p className="text-sm break-all text-muted-foreground">
                  {member.email}
                </p>
                <p className="text-sm">{member.positionTitles.join(" · ")}</p>
                <div className="mt-2 flex flex-wrap items-start gap-3 empty:hidden">
                  <MemberPositionEditor
                    member={member}
                    positionGroups={positionGroups}
                    focusTargetId={ACTIVE_HEADING_ID}
                  />
                  <MemberMfaReset
                    member={member}
                    focusTargetId={ACTIVE_HEADING_ID}
                  />
                  <MemberDeactivate
                    member={member}
                    focusTargetId={ACTIVE_HEADING_ID}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
