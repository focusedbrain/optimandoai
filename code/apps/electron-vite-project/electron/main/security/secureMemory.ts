/**
 * Best-effort secure credential memory — P4.5.15.
 *
 * Surveys libsodium-wrappers for sodium_malloc / sodium_mlock (native libsodium
 * secure-memory APIs). The Emscripten build bundled as libsodium-wrappers in this
 * app exposes memzero but not malloc/mlock — see credential-security-threat-model.md.
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export type SecureMemoryMode =
  | 'libsodium_locked'
  | 'libsodium_unlocked'
  | 'plain_buffer'

export interface SecureMemoryStatus {
  readonly mode: SecureMemoryMode
  readonly platform: NodeJS.Platform
  readonly sodiumMallocAvailable: boolean
  readonly sodiumMlockAvailable: boolean
  readonly memzeroAvailable: boolean
}

export interface ScopedCredentialBuffer {
  readonly buffer: Buffer
  readonly secure: boolean
  readonly ownsBuffer: boolean
}

type SodiumModule = {
  ready: Promise<void>
  memzero?: (input: Uint8Array) => void
  sodium_malloc?: (size: number) => Uint8Array
  sodium_free?: (input: Uint8Array) => void
  sodium_mlock?: (input: Uint8Array) => number
  sodium_munlock?: (input: Uint8Array) => number
}

let _sodium: SodiumModule | null = null
let _status: SecureMemoryStatus | null = null
let _initPromise: Promise<SecureMemoryStatus> | null = null
let _loggedUnavailable = false

async function loadSodium(): Promise<SodiumModule | null> {
  try {
    const mod = require('libsodium-wrappers') as SodiumModule
    await mod.ready
    return mod
  } catch {
    return null
  }
}

function detectStatus(sodium: SodiumModule | null): SecureMemoryStatus {
  const sodiumMallocAvailable = typeof sodium?.sodium_malloc === 'function'
  const sodiumMlockAvailable = typeof sodium?.sodium_mlock === 'function'
  const memzeroAvailable = typeof sodium?.memzero === 'function'

  let mode: SecureMemoryMode = 'plain_buffer'
  if (sodiumMallocAvailable && sodiumMlockAvailable) {
    mode = 'libsodium_locked'
  } else if (sodiumMallocAvailable) {
    mode = 'libsodium_unlocked'
  }

  return {
    mode,
    platform: process.platform,
    sodiumMallocAvailable,
    sodiumMlockAvailable,
    memzeroAvailable,
  }
}

function logUnavailableOnce(status: SecureMemoryStatus): void {
  if (_loggedUnavailable || status.mode !== 'plain_buffer') return
  _loggedUnavailable = true
  console.warn(
    '[credential-memory] memory locking not available on this platform — SSH credentials remain pageable until zeroed (see docs/architecture/credential-security-threat-model.md)',
  )
}

export async function initSecureMemory(): Promise<SecureMemoryStatus> {
  if (_status) return _status
  if (!_initPromise) {
    _initPromise = (async () => {
      _sodium = await loadSodium()
      _status = detectStatus(_sodium)
      logUnavailableOnce(_status)
      return _status
    })()
  }
  return _initPromise
}

export function getSecureMemoryStatus(): SecureMemoryStatus | null {
  return _status
}

/** Tests only. */
export function _resetSecureMemoryForTest(): void {
  _sodium = null
  _status = null
  _initPromise = null
  _loggedUnavailable = false
}

export function memzeroBufferIfAvailable(buf: Buffer): boolean {
  const memzero = _sodium?.memzero
  if (!memzero) return false
  try {
    memzero(buf)
    return true
  } catch {
    return false
  }
}

function allocateLockedBuffer(size: number): Buffer | null {
  const malloc = _sodium?.sodium_malloc
  if (!malloc || size <= 0) return null

  const allocated = malloc(size)
  if (!allocated || allocated.byteLength < size) {
    return null
  }

  const buffer = Buffer.from(allocated.buffer, allocated.byteOffset, size)
  const mlock = _sodium?.sodium_mlock
  if (mlock && mlock(buffer) !== 0) {
    releaseLockedBuffer(buffer, allocated)
    return null
  }

  Object.defineProperty(buffer, '__sodiumAllocation', {
    value: allocated,
    enumerable: false,
    configurable: true,
  })
  return buffer
}

function releaseLockedBuffer(buffer: Buffer, allocated?: Uint8Array): void {
  const backing =
    allocated ??
    (buffer as Buffer & { __sodiumAllocation?: Uint8Array }).__sodiumAllocation
  if (!backing) {
    memzeroBufferIfAvailable(buffer)
    buffer.fill(0)
    return
  }

  memzeroBufferIfAvailable(buffer)
  _sodium?.sodium_munlock?.(backing)
  _sodium?.sodium_free?.(backing)
}

export function duplicateCredentialForScope(cred: Buffer): ScopedCredentialBuffer {
  if (_status?.mode === 'libsodium_locked') {
    const locked = allocateLockedBuffer(cred.length)
    if (locked) {
      cred.copy(locked)
      return { buffer: locked, secure: true, ownsBuffer: true }
    }
  }

  if (_status?.mode === 'libsodium_unlocked') {
    const malloc = _sodium?.sodium_malloc
    if (malloc) {
      const allocated = malloc(cred.length)
      if (allocated) {
        const buffer = Buffer.from(allocated.buffer, allocated.byteOffset, cred.length)
        cred.copy(buffer)
        Object.defineProperty(buffer, '__sodiumAllocation', {
          value: allocated,
          enumerable: false,
          configurable: true,
        })
        return { buffer, secure: false, ownsBuffer: true }
      }
    }
  }

  return { buffer: cred, secure: false, ownsBuffer: false }
}

export function releaseScopedCredential(scoped: ScopedCredentialBuffer): void {
  if (!scoped.ownsBuffer) {
    memzeroBufferIfAvailable(scoped.buffer)
    scoped.buffer.fill(0)
    return
  }
  releaseLockedBuffer(scoped.buffer)
}

export function allocateCredentialBufferFromUtf8(value: string): Buffer {
  const temp = Buffer.from(value, 'utf8')
  if (!_status) return temp
  const scoped = duplicateCredentialForScope(temp)
  if (!scoped.ownsBuffer) return temp
  temp.fill(0)
  return scoped.buffer
}

/** Environmental test: sodium_malloc/mlock path must not throw when APIs exist. */
export async function probeSecureAllocation(size = 32): Promise<{
  attempted: boolean
  succeeded: boolean
  error?: string
}> {
  await initSecureMemory()
  if (!_status?.sodiumMallocAvailable) {
    return { attempted: false, succeeded: false }
  }

  try {
    const scoped = duplicateCredentialForScope(Buffer.alloc(size, 0x41))
    releaseScopedCredential(scoped)
    return { attempted: true, succeeded: true }
  } catch (err) {
    return {
      attempted: true,
      succeeded: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
