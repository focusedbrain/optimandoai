/**
 * Client-side SHA-256 for context block hashing.
 * Used when building context_blocks for handshake accept — raw content
 * never travels in the capsule; only hashes/commitments do.
 */

export async function computeBlockHashClient(content: string | Record<string, unknown>): Promise<string> {
  const serialized = typeof content === 'string' ? content : JSON.stringify(content)
  const encoder = new TextEncoder()
  const data = encoder.encode(serialized)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}
