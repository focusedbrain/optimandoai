/**
 * Visible Inbox = permission for Sandbox clone. Account boundaries are enforced by inbox
 * list/query; clone prepare must not re-check row account_id or message From/To/BEAP identities.
 */
export function canCloneVisibleInboxMessageToSandbox(message: { id?: string | null } | null | undefined): boolean {
  return Boolean(message?.id)
}
