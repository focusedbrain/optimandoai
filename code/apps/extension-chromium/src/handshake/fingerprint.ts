/**
 * Fingerprint Utilities
 * 
 * Generate and format cryptographic fingerprints for handshakes.
 */

// =============================================================================
// Fingerprint Generation
// =============================================================================

/**
 * Generate a SHA-256 fingerprint from identity material
 * @param identityBlob - The identity blob (public key, certificate, etc.)
 * @returns Full fingerprint as 64-character hex string
 */
export async function generateFingerprint(identityBlob: string): Promise<string> {
  // Convert string to Uint8Array
  const encoder = new TextEncoder()
  const data = encoder.encode(identityBlob)
  
  // Generate SHA-256 hash
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  
  // Convert to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  
  return hashHex.toUpperCase()
}

/**
 * Generate a fingerprint synchronously using a simple hash
 * (Fallback for environments without crypto.subtle)
 */
export function generateFingerprintSync(identityBlob: string): string {
  // Simple hash function for fallback
  let hash = 0
  for (let i = 0; i < identityBlob.length; i++) {
    const char = identityBlob.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  
  // Generate a pseudo-random 64-char hex string based on the hash
  const seed = Math.abs(hash)
  let result = ''
  let current = seed
  for (let i = 0; i < 64; i++) {
    current = (current * 1103515245 + 12345) & 0x7fffffff
    result += (current % 16).toString(16).toUpperCase()
  }
  
  return result
}

// =============================================================================
// Fingerprint Formatting
// =============================================================================

/**
 * Format full fingerprint to short display format: "7C9F…A2D1"
 * Shows first 4 bytes (8 chars) and last 4 bytes (8 chars)
 * @param fullFingerprint - 64-character hex fingerprint
 * @returns Short format "XXXX…XXXX"
 */
export function formatFingerprintShort(fullFingerprint: string): string {
  if (!fullFingerprint || fullFingerprint.length < 16) {
    return fullFingerprint || ''
  }
  
  const first = fullFingerprint.slice(0, 8)
  const last = fullFingerprint.slice(-8)
  
  return `${first}…${last}`
}

/**
 * Format fingerprint for display with grouping: "7C9F A2B3 D4E5 F6A7..."
 * Groups of 4 characters separated by spaces
 * @param fullFingerprint - 64-character hex fingerprint
 * @returns Grouped format for readability
 */
export function formatFingerprintGrouped(fullFingerprint: string): string {
  if (!fullFingerprint) return ''
  
  const groups: string[] = []
  for (let i = 0; i < fullFingerprint.length; i += 4) {
    groups.push(fullFingerprint.slice(i, i + 4))
  }
  
  return groups.join(' ')
}

/**
 * Compare two fingerprints (case-insensitive)
 * @returns true if fingerprints match
 */
export function compareFingerprints(fp1: string, fp2: string): boolean {
  if (!fp1 || !fp2) return false
  return fp1.toUpperCase() === fp2.toUpperCase()
}

/**
 * Validate fingerprint format
 * @param fingerprint - String to validate
 * @returns true if valid 64-character hex string
 */
export function isValidFingerprint(fingerprint: string): boolean {
  if (!fingerprint || fingerprint.length !== 64) return false
  return /^[0-9A-Fa-f]{64}$/.test(fingerprint)
}

// =============================================================================
// Demo/Mock Fingerprints
// =============================================================================

/**
 * Generate a mock fingerprint for demo purposes
 */
export function generateMockFingerprint(): string {
  const chars = '0123456789ABCDEF'
  let result = ''
  for (let i = 0; i < 64; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

