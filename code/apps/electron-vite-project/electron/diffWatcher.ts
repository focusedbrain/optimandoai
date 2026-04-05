/**
 * Folder-watching service for WR Chat Diff feature (Node main process only).
 * Uses fs.watch (non-recursive), debounced diff vs in-memory snapshots.
 */

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type { DiffTrigger } from '../../../packages/shared/src/wrChat/diffTrigger'

/** Use when constructing a new `DiffTrigger.id`. */
export function createDiffTriggerId(): string {
  return randomUUID()
}

export type { DiffTrigger }

const BINARY_SENTINEL_PREFIX = '__BINARY__:'
const PATH_ONLY_PREFIX = '__PATH_ONLY__:'

type WatcherEntry = {
  trigger: DiffTrigger
  watcher: fs.FSWatcher
  fileSnapshots: Map<string, string>
  debounceTimer: ReturnType<typeof setTimeout> | null
  /** True when folder had too many files — no file content in snapshots; mtime-only change detection. */
  tooManyFilesMode: boolean
}

const DEFAULT_DEBOUNCE_MS = 500
const DEFAULT_MAX_BYTES = 2_097_152 // 2 MB per file — allow big diffs
const DEFAULT_MAX_FILES = 500
const BINARY_PROBE_LEN = 512
const MAX_DIFF_LINES = 10_000 // allow large diffs; post everything, LLM decides relevance

/** Default text-like extensions (lowercase, with dot). */
const DEFAULT_ALLOWED_EXTENSIONS = new Set([
  '.txt',
  '.log',
  '.json',
  '.xml',
  '.csv',
  '.md',
  '.yaml',
  '.yml',
  '.ini',
  '.cfg',
  '.conf',
  '.env',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.sh',
  '.html',
  '.css',
])

function isAllowedExtension(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase()
  return ext.length > 0 && DEFAULT_ALLOWED_EXTENSIONS.has(ext)
}

function pathOnlySnapshot(mtimeMs: number): string {
  return `${PATH_ONLY_PREFIX}${mtimeMs}`
}

function parsePathOnly(s: string): number | null {
  if (!s.startsWith(PATH_ONLY_PREFIX)) return null
  const n = Number(s.slice(PATH_ONLY_PREFIX.length))
  return Number.isFinite(n) ? n : null
}

function isBinaryBuffer(buf: Buffer): boolean {
  const n = Math.min(buf.length, BINARY_PROBE_LEN)
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true
  }
  return false
}

function binarySentinel(size: number): string {
  return `${BINARY_SENTINEL_PREFIX}${size}`
}

function parseBinarySentinel(s: string): number | null {
  if (!s.startsWith(BINARY_SENTINEL_PREFIX)) return null
  const n = Number(s.slice(BINARY_SENTINEL_PREFIX.length))
  return Number.isFinite(n) && n >= 0 ? n : null
}

function safeLstatSync(fullPath: string): fs.Stats | null {
  try {
    return fs.lstatSync(fullPath)
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      console.warn('[diffWatcher] lstat EPERM/EACCES:', fullPath, err.message)
      return null
    }
    return null
  }
}

/**
 * Build snapshot for a single file: UTF-8 text string, or binary sentinel (not full bytes).
 */
function snapshotFile(fullPath: string): { key: 'text' | 'binary'; value: string } | null {
  let buf: Buffer
  try {
    buf = fs.readFileSync(fullPath)
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      console.warn('[diffWatcher] readFile EPERM/EACCES:', fullPath, err.message)
    }
    return null
  }
  if (buf.length === 0) return { key: 'text', value: '' }
  const probe = buf.subarray(0, Math.min(BINARY_PROBE_LEN, buf.length))
  if (isBinaryBuffer(probe)) {
    return { key: 'binary', value: binarySentinel(buf.length) }
  }
  try {
    return { key: 'text', value: buf.toString('utf8') }
  } catch {
    return { key: 'binary', value: binarySentinel(buf.length) }
  }
}

function buildUnifiedStyleDiff(relName: string, oldText: string, newText: string, maxBytes: number): string {
  const byteLen = Buffer.byteLength(oldText, 'utf8') + Buffer.byteLength(newText, 'utf8')
  if (byteLen > maxBytes) {
    return `[modified, ${Buffer.byteLength(newText, 'utf8')} bytes, diff truncated]\n`
  }
  const oldLines = oldText.split(/\r?\n/)
  const newLines = newText.split(/\r?\n/)
  if (oldLines.length + newLines.length > MAX_DIFF_LINES) {
    return `[modified, ${Buffer.byteLength(newText, 'utf8')} bytes, diff truncated]\n`
  }
  const out: string[] = [`--- a/${relName}`, `+++ b/${relName}`, '@@']
  for (const line of oldLines) out.push(`-${line}`)
  for (const line of newLines) out.push(`+${line}`)
  return `${out.join('\n')}\n`
}

function truncateText(s: string, maxBytes: number): string {
  const buf = Buffer.from(s, 'utf8')
  if (buf.length <= maxBytes) return s
  return buf.subarray(0, maxBytes).toString('utf8') + '\n[… truncated …]\n'
}

type ScanResult = {
  snapshots: Map<string, string>
  tooManyFiles: boolean
  skippedSymlinks: number
}

/**
 * Enumerate top-level files (non-symlink), apply extension filter, optionally cap by maxFiles.
 */
function scanFolderSnapshots(watchPath: string, trigger: DiffTrigger): ScanResult | null {
  const maxFiles = trigger.maxFiles ?? DEFAULT_MAX_FILES
  let names: string[]
  try {
    names = fs.readdirSync(watchPath)
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      console.warn('[diffWatcher] readdir EPERM/EACCES:', watchPath, err.message)
    }
    return null
  }

  const candidates: Array<{ name: string; full: string; st: fs.Stats }> = []
  let skippedSymlinks = 0

  for (const name of names) {
    if (!isAllowedExtension(name)) continue
    const full = path.join(watchPath, name)
    const st = safeLstatSync(full)
    if (!st) continue
    if (st.isSymbolicLink()) {
      skippedSymlinks++
      continue
    }
    if (!st.isFile()) continue
    candidates.push({ name, full, st })
  }

  const tooManyFiles = candidates.length > maxFiles
  const out = new Map<string, string>()

  if (tooManyFiles) {
    console.warn(
      `[diffWatcher] ${candidates.length} files exceed maxFiles (${maxFiles}) in ${watchPath} — path-only mode`,
    )
    for (const c of candidates) {
      out.set(c.name, pathOnlySnapshot(Math.floor(c.st.mtimeMs)))
    }
    return { snapshots: out, tooManyFiles: true, skippedSymlinks }
  }

  for (const c of candidates) {
    const snap = snapshotFile(c.full)
    if (!snap) continue
    out.set(c.name, snap.value)
  }
  return { snapshots: out, tooManyFiles: false, skippedSymlinks }
}

export class DiffWatcherService {
  private watchers: Map<string, WatcherEntry> = new Map()

  private onDiffReady: (triggerId: string, diff: string) => void = () => {}

  private onError: (triggerId: string, error: string) => void = () => {}

  setOnDiffReady(cb: (triggerId: string, diff: string) => void): void {
    this.onDiffReady = cb
  }

  setOnError(cb: (triggerId: string, error: string) => void): void {
    this.onError = cb
  }

  private clearDebounce(entry: WatcherEntry): void {
    if (entry.debounceTimer) {
      clearTimeout(entry.debounceTimer)
      entry.debounceTimer = null
    }
  }

  private scheduleComputeDiff(triggerId: string, entry: WatcherEntry): void {
    this.clearDebounce(entry)
    const ms = entry.trigger.debounceMs ?? DEFAULT_DEBOUNCE_MS
    entry.debounceTimer = setTimeout(() => {
      entry.debounceTimer = null
      try {
        this.computeDiff(triggerId)
      } catch (e) {
        console.error('[diffWatcher] computeDiff error:', e)
        const msg = e instanceof Error ? e.message : String(e)
        try {
          this.onError(triggerId, msg)
        } catch {
          /* noop */
        }
      }
    }, ms)
  }

  private disableWatcher(triggerId: string, reason: string): void {
    const entry = this.watchers.get(triggerId)
    if (!entry) return
    this.clearDebounce(entry)
    try {
      entry.watcher.close()
    } catch {
      /* noop */
    }
    this.watchers.delete(triggerId)
    try {
      this.onError(triggerId, `watcher stopped (${reason}); trigger disabled`)
    } catch {
      /* noop */
    }
  }

  private computeDiff(triggerId: string): void {
    const entry = this.watchers.get(triggerId)
    if (!entry) return

    const { trigger } = entry
    const watchPath = path.resolve(trigger.watchPath)
    const maxBytes = trigger.maxBytes ?? DEFAULT_MAX_BYTES
    const tooManyFilesMode = entry.tooManyFilesMode

    let scan: ScanResult | null
    try {
      if (!fs.existsSync(watchPath)) {
        this.disableWatcher(triggerId, `watch path missing: ${watchPath}`)
        return
      }
      const stRoot = safeLstatSync(watchPath)
      if (!stRoot || !stRoot.isDirectory()) {
        this.disableWatcher(triggerId, `watch path is not a directory: ${watchPath}`)
        return
      }
      scan = scanFolderSnapshots(watchPath, trigger)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.disableWatcher(triggerId, `cannot read watch path: ${msg}`)
      return
    }

    if (!scan) {
      this.disableWatcher(triggerId, `cannot scan folder: ${watchPath}`)
      return
    }

    const current = scan.snapshots
    const oldSnap = entry.fileSnapshots
    const parts: string[] = []

    const oldKeys = new Set(oldSnap.keys())
    const newKeys = new Set(current.keys())

    for (const name of oldKeys) {
      if (!newKeys.has(name)) {
        parts.push(`--- ${name} (removed)\n`)
      }
    }

    for (const name of newKeys) {
      const newVal = current.get(name)!
      if (!oldSnap.has(name)) {
        const binSize = parseBinarySentinel(newVal)
        const pathOnly = parsePathOnly(newVal)
        if (pathOnly !== null) {
          parts.push(`+++ ${name}\n[added — path-only mode, mtime tracked]\n`)
        } else if (binSize !== null) {
          parts.push(`+++ ${name}\n[binary file: ${binSize} bytes]\n`)
        } else {
          parts.push(`+++ ${name}\n${truncateText(newVal, maxBytes)}`)
        }
        continue
      }

      const oldVal = oldSnap.get(name)!
      if (oldVal === newVal) continue

      const oldPathOnly = parsePathOnly(oldVal)
      const newPathOnly = parsePathOnly(newVal)
      if (tooManyFilesMode || (oldPathOnly !== null && newPathOnly !== null)) {
        if (oldPathOnly !== null && newPathOnly !== null && oldPathOnly !== newPathOnly) {
          parts.push(`[modified: ${name}] (mtime changed; content not tracked in path-only mode)\n`)
        }
        continue
      }

      const oldBin = parseBinarySentinel(oldVal)
      const newBin = parseBinarySentinel(newVal)

      if (oldBin !== null || newBin !== null) {
        if (oldBin !== null && newBin !== null && oldBin !== newBin) {
          parts.push(`[binary file changed: ${name}, ${newBin} bytes]\n`)
        } else if (oldBin !== null && newBin === null) {
          parts.push(`[binary file changed: ${name}, now text, ${Buffer.byteLength(newVal, 'utf8')} bytes]\n`)
        } else if (oldBin === null && newBin !== null) {
          parts.push(`[binary file changed: ${name}, ${newBin} bytes]\n`)
        }
        continue
      }

      parts.push(buildUnifiedStyleDiff(name, oldVal, newVal, maxBytes))
    }

    entry.fileSnapshots = new Map(current)
    if (scan.tooManyFiles !== tooManyFilesMode) {
      entry.tooManyFilesMode = scan.tooManyFiles
    }

    const diffText = parts.join('')
    if (diffText.length > 0) {
      try {
        this.onDiffReady(triggerId, diffText)
      } catch {
        /* noop */
      }
    }
  }

  start(trigger: DiffTrigger): void {
    if (trigger.type !== 'diff') {
      throw new Error('DiffWatcherService.start expects DiffTrigger with type "diff"')
    }

    const id = trigger.id
    this.stop(id)

    const watchPath = path.resolve(trigger.watchPath)
    const resolvedTrigger: DiffTrigger = { ...trigger, watchPath }

    try {
      if (!fs.existsSync(watchPath)) {
        this.onError(id, `watch path does not exist: ${watchPath}`)
        return
      }
      const st = safeLstatSync(watchPath)
      if (!st || !st.isDirectory()) {
        this.onError(id, `watch path is not a directory: ${watchPath}`)
        return
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.onError(id, `invalid watch path: ${msg}`)
      return
    }

    const scan = scanFolderSnapshots(watchPath, resolvedTrigger)
    if (!scan) {
      this.onError(id, `cannot read directory: ${watchPath}`)
      return
    }

    const fileSnapshots = new Map(scan.snapshots)
    const tooManyFilesMode = scan.tooManyFiles
    const maxFiles = resolvedTrigger.maxFiles ?? DEFAULT_MAX_FILES

    if (tooManyFilesMode) {
      const warnMsg = `[Diff watcher '${resolvedTrigger.name}': folder has too many files (>${maxFiles}), watching for new/deleted files only, no content diffs]`
      console.warn(`[diffWatcher] ${warnMsg}`)
      try {
        this.onDiffReady(id, `${warnMsg}\n`)
      } catch {
        /* noop */
      }
    }

    let fsWatcher: fs.FSWatcher
    try {
      // recursive: true catches subdirectory changes too (supported on Windows natively,
      // emulated via inotify on Linux, and supported on macOS via FSEvents).
      fsWatcher = fs.watch(watchPath, { persistent: true, recursive: true }, (_event, filename) => {
        const ent = this.watchers.get(id)
        if (!ent) return
        void filename
        try {
          this.scheduleComputeDiff(id, ent)
        } catch (e) {
          console.error('[diffWatcher] scheduleComputeDiff:', e)
        }
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.onError(id, `fs.watch failed: ${msg}`)
      return
    }

    fsWatcher.on('error', (err) => {
      const msg = err instanceof Error ? err.message : String(err)
      this.disableWatcher(id, `watcher error: ${msg}`)
    })

    this.watchers.set(id, {
      trigger: resolvedTrigger,
      watcher: fsWatcher,
      fileSnapshots,
      debounceTimer: null,
      tooManyFilesMode,
    })
  }

  stop(id: string): void {
    const entry = this.watchers.get(id)
    if (!entry) return
    this.clearDebounce(entry)
    try {
      entry.watcher.close()
    } catch {
      /* noop */
    }
    this.watchers.delete(id)
  }

  stopAll(): void {
    for (const id of [...this.watchers.keys()]) {
      this.stop(id)
    }
  }

  isWatching(id: string): boolean {
    return this.watchers.has(id)
  }

  /**
   * Manually trigger an immediate diff computation for the given watcher ID.
   * If the watcher is not currently active, starts it first.
   * Returns true if triggered, false if the watcher ID is unknown / not persisted.
   */
  runNow(id: string): boolean {
    const entry = this.watchers.get(id)
    if (!entry) return false
    this.clearDebounce(entry)
    try {
      this.computeDiff(id)
    } catch (e) {
      console.error('[diffWatcher] runNow computeDiff error:', e)
      const msg = e instanceof Error ? e.message : String(e)
      try { this.onError(id, msg) } catch { /* noop */ }
    }
    return true
  }

  getStatus(): Array<{ id: string; name: string; watching: boolean; watchPath: string }> {
    const out: Array<{ id: string; name: string; watching: boolean; watchPath: string }> = []
    for (const [id, entry] of this.watchers) {
      out.push({
        id,
        name: entry.trigger.name,
        watching: true,
        watchPath: entry.trigger.watchPath,
      })
    }
    return out
  }
}

export const diffWatcherService = new DiffWatcherService()
