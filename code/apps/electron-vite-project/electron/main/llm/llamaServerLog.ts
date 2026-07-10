/**
 * Rotating file sink for llama-server stdout/stderr (build038).
 * ~10 MB per file, keeps the current file plus one rotated predecessor
 * (llama-server.log, llama-server.log.1) under userData/logs.
 */

import fs from 'fs'
import path from 'path'
import { app } from 'electron'

const MAX_BYTES = 10 * 1024 * 1024
const KEEP_ROTATED = 1

export function llamaServerLogPath(): string {
  return path.join(app.getPath('userData'), 'logs', 'llama-server.log')
}

export class RotatingLogWriter {
  private stream: fs.WriteStream | null = null
  private bytesWritten = 0

  constructor(private readonly filePath: string) {}

  private openStream(): fs.WriteStream {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    try {
      this.bytesWritten = fs.existsSync(this.filePath) ? fs.statSync(this.filePath).size : 0
    } catch {
      this.bytesWritten = 0
    }
    this.stream = fs.createWriteStream(this.filePath, { flags: 'a' })
    this.stream.on('error', () => {
      /* disk-full or locked file must never crash the orchestrator */
    })
    return this.stream
  }

  private rotate(): void {
    try {
      this.stream?.end()
      this.stream = null
      for (let i = KEEP_ROTATED; i >= 1; i--) {
        const src = i === 1 ? this.filePath : `${this.filePath}.${i - 1}`
        const dst = `${this.filePath}.${i}`
        if (fs.existsSync(dst)) fs.unlinkSync(dst)
        if (fs.existsSync(src)) fs.renameSync(src, dst)
      }
    } catch {
      /* rotation is best-effort */
    }
    this.bytesWritten = 0
  }

  write(chunk: Buffer | string): void {
    try {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      if (this.bytesWritten + buf.length > MAX_BYTES) this.rotate()
      const stream = this.stream ?? this.openStream()
      stream.write(buf)
      this.bytesWritten += buf.length
    } catch {
      /* never throw into the pipe handler */
    }
  }

  close(): void {
    try {
      this.stream?.end()
    } catch {
      /* ignore */
    }
    this.stream = null
  }
}
