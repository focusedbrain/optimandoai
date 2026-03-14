/**
 * Pure logic for HS Context draft lifecycle.
 * Extracted for testability of cancel cleanup and name preservation.
 */

/**
 * Whether to delete a draft profile on cancel.
 * Delete when: create mode (!profileId) and we have a draft (currentProfileId).
 * The draft was created by document upload — user cancelled without saving.
 */
export function shouldDeleteDraftOnCancel(
  profileId: string | undefined,
  currentProfileId: string | undefined,
): boolean {
  return !profileId && !!currentProfileId
}

/**
 * Resolve the name to show after draft creation completes.
 * Preserves user-typed name if they edited while creation was in progress.
 */
export function resolveNameAfterDraftCreation(userTypedName: string): string {
  return userTypedName?.trim() ? userTypedName : 'Untitled'
}
