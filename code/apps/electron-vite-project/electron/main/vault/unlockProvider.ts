/**
 * UnlockProvider — Abstraction for vault unlock methods.
 *
 * Each provider knows how to derive or retrieve an in-memory KEK for a
 * vault session.  The default provider is passphrase-based
 * (scrypt → KEK → unwrap DEK).
 *
 * Lifecycle:
 *   enroll()  → persists provider-specific state (salt, …)
 *   unlock()  → returns { kek, dek } for the session
 *   lock()    → zeroizes in-memory material
 */

import type { KDFParams } from './crypto'

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/** Identifies a provider type. */
export type UnlockProviderType = 'passphrase'

/**
 * Persisted per-provider state stored alongside vault metadata.
 * Serialised as JSON inside the meta file.
 */
export interface ProviderState {
  /** Provider type identifier. */
  type: UnlockProviderType
  /** Display name for UI. */
  name: string
  /** When this provider was enrolled. */
  enrolled_at: number
  /** Provider-specific opaque state. */
  data: Record<string, any>
}

/** Result returned by a successful `unlock()` call. */
export interface UnlockResult {
  /** Key Encryption Key — wraps / unwraps per-record DEKs. */
  kek: Buffer
  /** Data Encryption Key — used for SQLCipher + legacy HKDF. */
  dek: Buffer
}

/**
 * Context supplied to providers so they can read vault metadata without
 * knowing the VaultService internals.
 */
export interface VaultMetaContext {
  /** 32-byte salt used during enrollment / KDF. */
  salt: Buffer
  /** Wrapped (encrypted) DEK. */
  wrappedDEK: Buffer
  /** KDF parameters used when the vault was created. */
  kdfParams: KDFParams
  /** Provider-specific state (may be empty for fresh vaults). */
  providerState?: ProviderState
}

// ---------------------------------------------------------------------------
// UnlockProvider interface
// ---------------------------------------------------------------------------

/**
 * Contract that every unlock method must implement.
 *
 * IMPORTANT: Providers must NOT store the KEK or DEK beyond the current
 * session.  `lock()` MUST zeroize any in-memory key material.
 */
export interface UnlockProvider {
  /** Unique, stable identifier for this provider type. */
  readonly id: UnlockProviderType

  /** Human-readable display name. */
  readonly name: string

  /**
   * Whether this provider can be used in the current environment.
   */
  isAvailable(): boolean

  /**
   * Enroll / configure the provider for a vault.
   *
   * For passphrase: derives KEK, wraps DEK, returns the enrollment artefacts.
   *
   * @param password  Master password (passphrase provider) or undefined (others)
   * @param dek       The vault DEK to wrap
   * @param kdfParams KDF parameters to use
   * @returns Enrollment artefacts: salt, wrappedDEK, and optional provider state
   */
  enroll(
    password: string | undefined,
    dek: Buffer,
    kdfParams: KDFParams,
  ): Promise<{
    salt: Buffer
    wrappedDEK: Buffer
    kek: Buffer
    providerState: ProviderState
  }>

  /**
   * Unlock the vault — derive/retrieve KEK and unwrap the DEK.
   *
   * @param credential  Provider-specific credential (password string)
   * @param meta        Vault metadata context (salt, wrappedDEK, kdfParams, providerState)
   * @returns `UnlockResult` with in-memory KEK and DEK
   * @throws Error if credentials are wrong or provider state is invalid
   */
  unlock(
    credential: unknown,
    meta: VaultMetaContext,
  ): Promise<UnlockResult>

  /**
   * Lock — zeroize any provider-held in-memory key material.
   * Called by VaultService.lock().
   */
  lock(): void
}

// ---------------------------------------------------------------------------
// PassphraseUnlockProvider — default provider
// ---------------------------------------------------------------------------

import {
  deriveKEK,
  wrapDEK,
  unwrapDEK,
  generateSalt,
  zeroize,
  DEFAULT_KDF_PARAMS,
} from './crypto'

/**
 * Default unlock provider using a master passphrase.
 *
 * Enrollment:
 *   1. Generate random salt
 *   2. Derive KEK from passphrase via scrypt
 *   3. Wrap DEK with KEK (AES-256-GCM)
 *
 * Unlock:
 *   1. Load salt + wrappedDEK from meta
 *   2. Derive KEK from passphrase
 *   3. Unwrap DEK
 *
 * Lock:
 *   Zeroize cached KEK (if any)
 */
export class PassphraseUnlockProvider implements UnlockProvider {
  readonly id: UnlockProviderType = 'passphrase'
  readonly name = 'Master Password'

  /** Provider may hold a reference to the last KEK for potential re-wrap. */
  private cachedKEK: Buffer | null = null

  isAvailable(): boolean {
    return true // always available in every environment
  }

  async enroll(
    password: string | undefined,
    dek: Buffer,
    kdfParams: KDFParams = DEFAULT_KDF_PARAMS,
  ): Promise<{
    salt: Buffer
    wrappedDEK: Buffer
    kek: Buffer
    providerState: ProviderState
  }> {
    if (!password) {
      throw new Error('PassphraseUnlockProvider.enroll requires a password')
    }

    const salt = generateSalt()
    const kek = await deriveKEK(password, salt, kdfParams)
    const wrappedDEK = await wrapDEK(dek, kek)

    this.cachedKEK = kek

    return {
      salt,
      wrappedDEK,
      kek,
      providerState: {
        type: 'passphrase',
        name: this.name,
        enrolled_at: Date.now(),
        data: {},
      },
    }
  }

  async unlock(
    credential: unknown,
    meta: VaultMetaContext,
  ): Promise<UnlockResult> {
    const password = credential as string
    if (!password || typeof password !== 'string') {
      throw new Error('PassphraseUnlockProvider.unlock requires a password string')
    }

    const kek = await deriveKEK(password, meta.salt, meta.kdfParams)

    let dek: Buffer
    try {
      dek = await unwrapDEK(meta.wrappedDEK, kek)
    } catch {
      zeroize(kek)
      throw new Error('Incorrect password')
    }

    this.cachedKEK = kek
    return { kek, dek }
  }

  lock(): void {
    if (this.cachedKEK) {
      zeroize(this.cachedKEK)
      this.cachedKEK = null
    }
  }
}

// ---------------------------------------------------------------------------
// Provider Registry
// ---------------------------------------------------------------------------

/** Map of all known provider constructors. */
const PROVIDER_REGISTRY: Record<UnlockProviderType, () => UnlockProvider> = {
  passphrase: () => new PassphraseUnlockProvider(),
}

/**
 * Resolve a provider instance by type.
 * Returns the default (passphrase) provider if type is unknown.
 */
export function resolveProvider(type?: UnlockProviderType): UnlockProvider {
  if (type && PROVIDER_REGISTRY[type]) {
    return PROVIDER_REGISTRY[type]()
  }
  return new PassphraseUnlockProvider()
}

/**
 * List all provider types that are currently available in the environment.
 */
export function listAvailableProviders(): Array<{ id: UnlockProviderType; name: string }> {
  const available: Array<{ id: UnlockProviderType; name: string }> = []
  for (const [id, factory] of Object.entries(PROVIDER_REGISTRY)) {
    try {
      const provider = factory()
      if (provider.isAvailable()) {
        available.push({ id: id as UnlockProviderType, name: provider.name })
      }
    } catch {
      // provider not available
    }
  }
  return available
}
