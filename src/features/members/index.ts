// The members slice's public surface (AD-2): code outside the slice imports
// from here only.
export { ACCOUNT_STATE_COPY, memberStateOf } from "./account-state"
export type { InactiveMemberState, MemberState } from "./account-state"
export {
  approveMemberAction,
  declineMemberAction,
  recordCopiedTaskAction,
  recordOnboardingAction,
  resetMemberMfaAction,
  signInAsPersonaAction,
  signInWithGoogleAction,
  showTipsAgainAction,
  signOutAction,
} from "./actions"
export type { MemberCommandState, PersonaSignInState } from "./actions"
export { AccountStateNotice } from "./components/account-state-notice"
export { GoogleSignIn } from "./components/google-sign-in"
export { InAppBrowserNotice } from "./components/in-app-browser-notice"
export { MemberApprovals } from "./components/member-approvals"
export { StepUpProvider } from "./components/step-up-provider"
export { TwoFactorSetup } from "./components/two-factor-setup"
export { MemberApprovalsSkeleton } from "./components/member-approvals-skeleton"
export { MemberMenu } from "./components/member-menu"
export type { MemberMenuExtraLink } from "./components/member-menu"
export { FirstRunCard } from "./components/first-run-card"
export { OnboardingChecklist } from "./components/onboarding-checklist"
export type { ChecklistItems } from "./components/onboarding-checklist"
export { OnboardingTour } from "./components/onboarding-tour"
export { PersonaSignIn } from "./components/persona-sign-in"
export { SharedComputerProvider } from "./components/shared-computer"
export { SharedSessionWatcher } from "./components/shared-session-watcher"
export { MEMBER_ERROR_COPY, memberErrorMessage } from "./errors"
export type { MemberErrorCode } from "./errors"
export { homeScopeOf, WRITERS_DESK_ID } from "./home-scope"
export type { HomeScope, HomeScopePosition } from "./home-scope"
export { detectInAppBrowser } from "./in-app-browser"
export type { InAppBrowser } from "./in-app-browser"
export { initialsOf } from "./initials"
export { PERSONAS } from "./personas"
export type { PersonaKey } from "./personas"
export { PRODUCTION_ROLE_LABELS } from "./production-roles"
export type { ProductionRole } from "./production-roles"
export {
  countPendingApprovalsForViewer,
  getCurrentMember,
  getMemberApprovals,
  getMyHomeScope,
  getMyOnboarding,
  requireActiveMember,
} from "./queries"
export type {
  ActiveMember,
  CurrentMember,
  MemberApprovalsData,
  MemberRole,
  MyOnboarding,
  PendingMember,
  RosterMember,
} from "./queries"
export {
  LOGIN_ERROR_SIGN_IN,
  LOGIN_SIGNED_OUT_IDLE,
  loginPath,
  safeReturnPath,
} from "./return-path"
export {
  memberApproveSchema,
  memberDeclineSchema,
  memberMfaResetSchema,
  onboardingStepSchema,
  personaSignInSchema,
} from "./schemas"
export type {
  MemberApproveInput,
  MemberDeclineInput,
  MemberMfaResetInput,
} from "./schemas"
