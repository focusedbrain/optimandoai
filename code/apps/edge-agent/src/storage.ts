import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const ALGO = 'aes-256-gcm'

export interface AgentPairRecord {
  handshakeId: string
  handshakeType: 'edge_ingestor'
  orchestratorSub: string
  orchestratorPublicKey: string
  agentPublicKey: string
  orchestratorNonce: string
  agentNonce: string
  fingerprint: string
  confirmedAt: string
  initiatorDeviceRole: 'host'
  acceptorDeviceRole: 'edge_agent'
  /** X25519 public key (base64) for credential relay envelope (PR6). */
  agentEncryptionPublicKeyB64: string
  p2pEndpoint: string
  agentP2pAuthToken: string
  orchestratorP2pAuthToken: string
}

export type AgentAccountProvider = 'google' | 'microsoft'

/** At-rest mail account credentials (account key stored encrypted). */
export interface AgentStoredAccount {
  accountId: string
  displayName: string
  provider: AgentAccountProvider
  encryptedBundle: string
  /** AES-GCM blob (iv+tag+ciphertext) for account_key_hex. */
  accountKeyEncB64: string
  wrappedAccountKey?: string
  updatedAt: string
  lastRemoteState?: 'awaiting_key' | 'active' | 'degraded' | 'stopped'
  lastFetchAt?: string
  lastError?: string
}

export interface PodIdentityRecord {
  publicKeyHex: string
  privateKeyHex: string
  createdAt: string
}

export interface QuarantineQueueEntry {
  hash: string
  metadataJson: string
  rawBytesB64: string
  pickedUpAt: string
  signature: string
}

export interface AgentPersistedState {
  phase: 'unpaired' | 'paired'
  ssoSub?: string
  ssoEmail?: string
  accessToken?: string
  refreshToken?: string
  idToken?: string
  tokenExpiresAt?: number
  pairRecord?: AgentPairRecord
  edgePublicKeyHex?: string
  edgePodId?: string
  podIdentityKeys?: Record<string, PodIdentityRecord>
  haltedByAnomaly?: boolean
  haltReason?: string
  quarantineQueue?: QuarantineQueueEntry[]
  agentEncryptionPublicKeyB64?: string
  agentEncryptionPrivateKeyB64?: string
  agentP2pAuthToken?: string
  orchestratorP2pAuthToken?: string
  p2pEndpoint?: string
  accounts?: Record<string, AgentStoredAccount>
  encryptionKeyMigrationRequired?: boolean
}

export class AgentStorage {
  constructor(readonly stateDir: string) {}

  private keyPath(): string {
    return join(this.stateDir, 'state.enc')
  }

  private async deriveKey(): Promise<Buffer> {
    let machineId = ''
    try {
      machineId = await readFile('/etc/machine-id', 'utf8')
    } catch {
      machineId = 'fallback-machine'
    }
    const keyFile = join(this.stateDir, '.agent-key')
    let secret: Buffer
    try {
      secret = await readFile(keyFile)
    } catch {
      secret = randomBytes(32)
      await mkdir(this.stateDir, { recursive: true, mode: 0o700 })
      await writeFile(keyFile, secret, { mode: 0o600 })
    }
    return createHash('sha256').update(machineId).update(secret).digest()
  }

  async loadState(): Promise<AgentPersistedState> {
    try {
      const raw = await readFile(this.keyPath())
      const key = await this.deriveKey()
      const iv = raw.subarray(0, 12)
      const tag = raw.subarray(12, 28)
      const data = raw.subarray(28)
      const decipher = createDecipheriv(ALGO, key, iv)
      decipher.setAuthTag(tag)
      const plain = Buffer.concat([decipher.update(data), decipher.final()])
      return JSON.parse(plain.toString('utf8')) as AgentPersistedState
    } catch {
      return { phase: 'unpaired' }
    }
  }

  async saveState(state: AgentPersistedState): Promise<void> {
    await mkdir(this.stateDir, { recursive: true, mode: 0o700 })
    const key = await this.deriveKey()
    const iv = randomBytes(12)
    const cipher = createCipheriv(ALGO, key, iv)
    const enc = Buffer.concat([cipher.update(JSON.stringify(state), 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    await writeFile(this.keyPath(), Buffer.concat([iv, tag, enc]), { mode: 0o600 })
  }
}
