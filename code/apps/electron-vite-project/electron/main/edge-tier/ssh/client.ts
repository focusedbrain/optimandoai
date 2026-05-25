/**
 * Typed SSH client for edge VM wizard operations — Phase 4 (P4.1).
 *
 * Built on ssh2 (pinned in package.json). No provider APIs — SSH to user VPS only.
 *
 * P4.5.13: host key TOFU via ssh2 hostVerifier + persisted fingerprints (see hostKeyStore.ts).
 */

import { EventEmitter } from 'node:events'

import { assertHostKeyTrusted, HostKeyMismatchError } from './hostKeyPinning.js'
import { Ssh2Client, type Client, type ConnectConfig, type SFTPWrapper } from './ssh2Module.js'
import type {
  RunResult,
  SshCommandRunner,
  SshConnectOptions,
  SshProgressEvent,
} from './types.js'

export type { SshConnectOptions, RunResult, SshProgressEvent }
export { HostKeyMismatchError } from './hostKeyPinning.js'

const DEFAULT_READY_TIMEOUT_MS = 30_000
const DEFAULT_RUN_TIMEOUT_MS = 120_000

export interface SshClientConnectOptions extends SshConnectOptions {
  /** Inject a ssh2 Client (tests). */
  clientFactory?: () => Client
  /** Skip TOFU host key pinning (unit tests only). */
  skipHostKeyPinning?: boolean
}

export class SshClient extends EventEmitter implements SshCommandRunner {
  private client: Client | null = null
  private readonly clientFactory: () => Client
  private connected = false
  private pendingHostKeyMismatch: HostKeyMismatchError | null = null

  constructor(clientFactory?: () => Client) {
    super()
    this.clientFactory = clientFactory ?? (() => new Ssh2Client())
  }

  get isConnected(): boolean {
    return this.connected
  }

  async connect(options: SshClientConnectOptions): Promise<void> {
    if (this.connected) {
      await this.disconnect()
    }

    const client = this.clientFactory()
    this.client = client
    this.pendingHostKeyMismatch = null

    const privateKey =
      typeof options.privateKey === 'string'
        ? options.privateKey
        : options.privateKey

    const host = options.host
    const port = options.port ?? 22

    const config: ConnectConfig = {
      host,
      port,
      username: options.username,
      privateKey,
      passphrase: options.passphrase,
      readyTimeout: options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
    }

    if (!options.skipHostKeyPinning) {
      config.hostVerifier = (hostKey: Buffer) => {
        try {
          return assertHostKeyTrusted({ host, port, hostKey })
        } catch (err) {
          if (err instanceof HostKeyMismatchError) {
            this.pendingHostKeyMismatch = err
            return false
          }
          throw err
        }
      }
    }

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        cleanup()
        void this.disconnect()
        if (this.pendingHostKeyMismatch) {
          const mismatch = this.pendingHostKeyMismatch
          this.pendingHostKeyMismatch = null
          reject(mismatch)
          return
        }
        reject(err)
      }

      const cleanup = () => {
        client.removeListener('ready', onReady)
        client.removeListener('error', onError)
      }

      const onReady = () => {
        cleanup()
        this.connected = true
        resolve()
      }

      client.once('ready', onReady)
      client.once('error', onError)
      client.connect(config)
    })
  }

  async run(command: string, timeoutMs = DEFAULT_RUN_TIMEOUT_MS): Promise<RunResult> {
    const client = this.requireClient()

    return new Promise<RunResult>((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      let settled = false

      const timer = setTimeout(() => {
        finish(new Error(`SSH command timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      const finish = (err?: Error, result?: RunResult) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (err) {
          void this.disconnect()
          reject(err)
          return
        }
        resolve(result!)
      }

      client.exec(command, (err, stream) => {
        if (err) {
          finish(err)
          return
        }

        stream.on('data', (chunk: Buffer) => {
          const text = chunk.toString('utf8')
          stdout += text
          this.emitProgress({ type: 'stdout', chunk: text })
        })

        stream.stderr.on('data', (chunk: Buffer) => {
          const text = chunk.toString('utf8')
          stderr += text
          this.emitProgress({ type: 'stderr', chunk: text })
        })

        stream.on('close', (code: number | null, signal: string) => {
          this.emitProgress({ type: 'exit', code, signal })
          finish(undefined, { stdout, stderr, code, signal })
        })
      })
    })
  }

  /** Upload local file to remote path via SFTP. */
  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    const client = this.requireClient()
    const sftp = await this.openSftp(client)

    try {
      await new Promise<void>((resolve, reject) => {
        sftp.fastPut(localPath, remotePath, (err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    } finally {
      sftp.end()
    }
  }

  /** Upload in-memory content to remote path via SFTP. */
  async uploadContent(content: string | Buffer, remotePath: string): Promise<void> {
    const client = this.requireClient()
    const sftp = await this.openSftp(client)
    const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content

    try {
      await new Promise<void>((resolve, reject) => {
        sftp.writeFile(remotePath, data, { mode: 0o600 }, (err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    } finally {
      sftp.end()
    }
  }

  async disconnect(): Promise<void> {
    const client = this.client
    this.client = null
    this.connected = false
    if (!client) return

    await new Promise<void>((resolve) => {
      client.once('close', () => resolve())
      client.end()
      setTimeout(resolve, 500)
    })
  }

  private requireClient(): Client {
    if (!this.client || !this.connected) {
      throw new Error('SshClient is not connected')
    }
    return this.client
  }

  private openSftp(client: Client) {
    return new Promise<SFTPWrapper>((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) reject(err)
        else resolve(sftp)
      })
    })
  }

  private emitProgress(event: SshProgressEvent): void {
    this.emit('progress', event)
  }
}
