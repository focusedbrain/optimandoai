/** Hex-encode bytes without allocating intermediate strings per byte. */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Parse `ed25519:<hex>` into raw signature bytes. Returns null when malformed. */
export function parseEdgeSignature(edgeSignature: string): Uint8Array | null {
  const prefix = 'ed25519:';
  if (!edgeSignature.startsWith(prefix)) {
    return null;
  }
  const hex = edgeSignature.slice(prefix.length);
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    return null;
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Format raw Ed25519 signature bytes as `ed25519:<hex>`. */
export function formatEdgeSignature(signature: Uint8Array): string {
  return `ed25519:${bytesToHex(signature)}`;
}
