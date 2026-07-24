import crypto from 'crypto'
import fs from 'fs'

/** GGUF container magic at file offset 0. */
export const GGUF_MAGIC = Buffer.from([0x47, 0x47, 0x55, 0x46]) // "GGUF"

export function isGgufMagicBuffer(header: Buffer): boolean {
  return header.length >= 4 && header.subarray(0, 4).equals(GGUF_MAGIC)
}

export function assertGgufMagicHeader(filePath: string): void {
  const fd = fs.openSync(filePath, 'r')
  try {
    const buf = Buffer.alloc(4)
    const n = fs.readSync(fd, buf, 0, 4, 0)
    if (n < 4 || !isGgufMagicBuffer(buf)) {
      throw new Error('File is not a valid GGUF model (magic header mismatch)')
    }
  } finally {
    fs.closeSync(fd)
  }
}

export function sha256SidecarPath(ggufPath: string): string {
  return `${ggufPath}.sha256`
}

export async function computeFileSha256Hex(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

export async function writeSha256Sidecar(ggufPath: string, sha256Hex: string): Promise<void> {
  const sidecar = sha256SidecarPath(ggufPath)
  fs.writeFileSync(sidecar, `${sha256Hex.trim().toLowerCase()}\n`, 'utf8')
}

export function readSha256Sidecar(ggufPath: string): string {
  const sidecar = sha256SidecarPath(ggufPath)
  try {
    if (!fs.existsSync(sidecar)) return ''
    return fs.readFileSync(sidecar, 'utf8').trim().toLowerCase()
  } catch {
    return ''
  }
}

export function removeSha256Sidecar(ggufPath: string): void {
  const sidecar = sha256SidecarPath(ggufPath)
  try {
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar)
  } catch {
    /* best effort */
  }
}
