/**
 * Main-process SSH private key file reader — P4.5.11.
 *
 * The renderer never reads PEM bytes; only file paths cross the IPC boundary.
 */

import { lstatSync, readFileSync } from 'node:fs'

import { ssh2Utils } from '../edge-tier/ssh/ssh2Module.js'

export const MAX_SSH_KEY_FILE_BYTES = 4096

export function readAndValidateSshKeyFile(keyFilePath: string, passphrase?: string): string {
  const stat = lstatSync(keyFilePath)
  if (!stat.isFile()) {
    throw new Error('SSH key path must be a regular file')
  }
  if (stat.size > MAX_SSH_KEY_FILE_BYTES) {
    throw new Error(`SSH key file exceeds ${MAX_SSH_KEY_FILE_BYTES} bytes`)
  }

  const pem = readFileSync(keyFilePath, 'utf8')
  const parsed = ssh2Utils.parseKey(pem, passphrase)
  if (parsed instanceof Error) {
    throw new Error(`Invalid SSH private key: ${parsed.message}`)
  }
  if (!parsed) {
    throw new Error('Invalid SSH private key')
  }

  return pem
}
