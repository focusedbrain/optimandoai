/**
 * SSH credential buffers — convert renderer strings to zeroable Buffers at IPC boundary.
 */

import { zeroizeBuffer } from './zeroize.js'

export interface SshSecretBuffers {
  readonly sshKey: Buffer
  readonly passphrase?: Buffer
}

export function sshSecretBuffersFromStrings(
  sshKey: string,
  passphrase?: string,
): SshSecretBuffers {
  return {
    sshKey: Buffer.from(sshKey, 'utf8'),
    passphrase: passphrase ? Buffer.from(passphrase, 'utf8') : undefined,
  }
}

export function zeroizeSshSecretBuffers(secrets: SshSecretBuffers): void {
  zeroizeBuffer(secrets.sshKey)
  zeroizeBuffer(secrets.passphrase)
}

export function bufferToUtf8(buf: Buffer): string {
  return buf.toString('utf8')
}

export function bufferToUtf8Optional(buf: Buffer | undefined): string | undefined {
  return buf ? buf.toString('utf8') : undefined
}
