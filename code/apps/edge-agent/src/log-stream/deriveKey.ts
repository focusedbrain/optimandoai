import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Same machine-bound key material as AgentStorage (PR3). */
export async function deriveAgentLogBufferKey(stateDir: string): Promise<Buffer> {
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
    secret = randomBytes(32)
    await mkdir(stateDir, { recursive: true, mode: 0o700 })
    await writeFile(keyFile, secret, { mode: 0o600 })
  }
  return createHash('sha256').update(machineId).update(secret).digest()
}
