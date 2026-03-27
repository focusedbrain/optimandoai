/** BEAP draft attachment cap (must match picker UI). */
export const MAX_BEAP_DRAFT_ATTACHMENT_BYTES = 10 * 1024 * 1024

const MAX_MB = MAX_BEAP_DRAFT_ATTACHMENT_BYTES / (1024 * 1024)

/**
 * User-visible message when one or more files exceed the draft attachment size limit.
 */
export function formatOversizeAttachmentRejection(fileNames: string[]): string {
  if (fileNames.length === 0) return ''
  if (fileNames.length === 1) {
    return `Not attached: "${fileNames[0]}" is over ${MAX_MB} MB (limit ${MAX_MB} MB per file).`
  }
  const list = fileNames.map((n) => `"${n}"`).join(', ')
  return `Not attached (${fileNames.length} files over ${MAX_MB} MB): ${list}. Each file must be ≤ ${MAX_MB} MB.`
}
