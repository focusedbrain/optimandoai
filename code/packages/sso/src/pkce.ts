import { randomBytes, createHash } from 'node:crypto'

export function base64url(buffer: Buffer): string {
  return buffer.toString('base64url')
}

export function randomString(bytes = 32): string {
  return base64url(randomBytes(bytes))
}

export function sha256base64url(input: string): string {
  return createHash('sha256').update(input).digest('base64url')
}
