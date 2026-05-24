/** Display helper mirroring main-process OpenSSH fingerprint format. */
export function formatFingerprintForDisplay(fingerprintSha256Hex: string): string {
  const digest = hexToBytes(fingerprintSha256Hex.toLowerCase())
  const b64 = bytesToBase64(digest).replace(/=+$/, '')
  return `SHA256:${b64}`
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}
