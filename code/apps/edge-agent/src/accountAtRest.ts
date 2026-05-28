import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { AgentStorage } from './storage.js'

const ALGO = 'aes-256-gcm'

async function deriveKey(storage: AgentStorage): Promise<Buffer> {
  const stateDir = storage.stateDir
  let machineId = ''
  try {
    machineId = await readFile('/etc/machine-id', 'utf8')
  } catch {
    machineId = 'fallback-machine'
  }
  const keyFile = join(stateDir, '.agent-key')
  let secret: Buffer
  try {
    secret = await readFile(keyFile)
  } catch {
    throw new Error('agent state key missing')
  }
  return createHash('sha256').update(machineId).update(secret).digest()
}

export async function encryptAtRest(storage: AgentStorage, plaintext: string): Promise<string> {
  const key = await deriveKey(storage)
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export async function decryptAtRest(storage: AgentStorage, blobB64: string): Promise<string> {
  const key = await deriveKey(storage)
  const raw = Buffer.from(blobB64, 'base64')
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const data = raw.subarray(28)
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}
