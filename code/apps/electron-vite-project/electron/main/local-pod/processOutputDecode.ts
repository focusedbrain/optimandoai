/**
 * Decode child-process output — wsl.exe on Windows emits UTF-16LE.
 */

export function looksLikeUtf16Le(buf: Buffer): boolean {
  if (buf.length < 4) return false
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return true
  let nullPairs = 0
  const sample = Math.min(buf.length, 64)
  for (let i = 1; i < sample; i += 2) {
    if (buf[i] === 0 && buf[i - 1] !== 0) nullPairs++
  }
  return nullPairs >= 3
}

export function decodeProcessBuffer(buf: Buffer, preferUtf16Le = false): string {
  if (buf.length === 0) return ''

  if (preferUtf16Le || looksLikeUtf16Le(buf)) {
    let slice = buf
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
      slice = buf.subarray(2)
    }
    return slice
      .toString('utf16le')
      .replace(/\u0000/g, '')
      .replace(/\r\n/g, '\n')
      .trim()
  }

  return buf.toString('utf8').replace(/\r\n/g, '\n').trim()
}

export function decodeProcessOutput(chunks: readonly Buffer[], preferUtf16Le = false): string {
  if (chunks.length === 0) return ''
  return decodeProcessBuffer(Buffer.concat(chunks), preferUtf16Le)
}

/** Strip mojibake-prone raw command output from user-visible strings. */
export function sanitizeForUserDisplay(text: string | undefined | null): string | undefined {
  if (!text) return undefined
  const trimmed = text.trim()
  if (!trimmed) return undefined
  if (trimmed.includes('\u0000')) return undefined
  if (/[\u0390-\u03ff].*[\u0390-\u03ff]/.test(trimmed) && /[a-zA-Z]/.test(trimmed)) {
    return undefined
  }
  if (/[\u0080-\u009f]/.test(trimmed)) return undefined
  return trimmed.length > 280 ? `${trimmed.slice(0, 277)}…` : trimmed
}
