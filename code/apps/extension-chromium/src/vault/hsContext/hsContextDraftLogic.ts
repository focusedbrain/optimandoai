/**
 * Pure logic for HS Context draft lifecycle.
 * Extracted for testability of cancel cleanup and name preservation.
 */

/**
 * Whether to delete a draft profile on cancel.
 * Only delete when: new draft (no profileId), has currentProfileId,
 * name is still "Untitled", and no document upload has occurred.
 */
export function shouldDeleteDraftOnCancel(
  profileId: string | undefined,
  currentProfileId: string | undefined,
  name: string,
  hasUploaded: boolean,
): boolean {
  return (
    !profileId &&
    !!currentProfileId &&
    name.trim() === 'Untitled' &&
    !hasUploaded
  )
}

/**
 * Resolve the name to show after draft creation completes.
 * Preserves user-typed name if they edited while creation was in progress.
 */
export function resolveNameAfterDraftCreation(userTypedName: string): string {
  return userTypedName?.trim() ? userTypedName : 'Untitled'
}
