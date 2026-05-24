/**
 * Main-process log pipeline — P4.5.14.
 *
 * All console.log / console.warn / console.error output passes through scrubForLog
 * before stdout and before optional renderer broadcast (main-process-log IPC).
 */

import { BrowserWindow } from 'electron'

import { scrubForLog } from './secretScrubber.js'

export interface MainProcessLogScrubOptions {
  /** Skip mirroring to renderer windows (tests). */
  skipBroadcast?: boolean
}

export interface CapturedLogLine {
  readonly level: string
  readonly line: string
}

const _captured: CapturedLogLine[] = []
let _captureEnabled = false

export function installLogCaptureForTest(enabled = true): void {
  _captureEnabled = enabled
  if (enabled) _captured.length = 0
}

export function drainCapturedLogs(): readonly CapturedLogLine[] {
  return [..._captured]
}

export function resetCapturedLogs(): void {
  _captured.length = 0
}

function scrubLogArgs(args: unknown[]): unknown[] {
  return args.map((arg) => scrubForLog(arg))
}

function formatMainLogArg(value: unknown): string {
  const scrubbed = scrubForLog(value)
  if (typeof scrubbed === 'string') return scrubbed
  try {
    return JSON.stringify(scrubbed)
  } catch {
    return String(scrubbed)
  }
}

function recordCapturedLog(level: string, args: unknown[]): void {
  if (!_captureEnabled) return
  const line = args.map(formatMainLogArg).join(' ')
  _captured.push({ level, line })
}

function broadcastMainProcessLog(level: string, args: unknown[]): void {
  const line = args.map(formatMainLogArg).join(' ')
  const entry = { ts: new Date().toISOString(), level, line }
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      win.webContents.send('main-process-log', entry)
    }
  } catch {
    /* never throw from logging */
  }
}

let _installed = false

export function installMainProcessLogScrubbing(options: MainProcessLogScrubOptions = {}): void {
  if (_installed) return
  _installed = true

  const originalLog = console.log.bind(console)
  const originalError = console.error.bind(console)
  const originalWarn = console.warn.bind(console)
  const originalInfo = console.info?.bind(console)
  const originalDebug = console.debug?.bind(console)

  const wrap =
    (level: string, original: (...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      const scrubbed = scrubLogArgs(args)
      original(...scrubbed)
      recordCapturedLog(level, scrubbed)
      if (!options.skipBroadcast) {
        broadcastMainProcessLog(level, scrubbed)
      }
    }

  console.log = wrap('log', originalLog)
  console.error = wrap('error', originalError)
  console.warn = wrap('warn', originalWarn)
  if (originalInfo) console.info = wrap('info', originalInfo)
  if (originalDebug) console.debug = wrap('debug', originalDebug)
}

/** Tests only — allow re-installing the scrubbing patch. */
export function _resetMainProcessLogScrubbingForTest(): void {
  _installed = false
  _captureEnabled = false
  _captured.length = 0
}
