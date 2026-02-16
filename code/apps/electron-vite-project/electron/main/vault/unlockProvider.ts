/**
 * UnlockProvider — Abstraction for vault unlock methods.
 *
 * Each provider knows how to derive or retrieve an in-memory KEK for a
 * vault session.  The first (and default) provider is passphrase-based
 * (scrypt → KEK → unwrap DEK).  Future providers (Passkey/WebAuthn,
 * hardware tokens, biometrics) implement the same interface.
 *
 * Lifecycle:
 *   enroll()  → persists provider-specific state (salt, credential ID, …)
 *   unlock()  → returns { kek, dek } for the session
 *   lock()    → zeroizes in-memory material
 */

import type { KDFParams } from './crypto'

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/** Identifies a provider type.  Extensible via union in future prompts. */
export type UnlockProviderType = 'passphrase' | 'passkey'

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
  /** Provider-specific opaque state (e.g. credential ID for passkey). */
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
   * E.g. passkey requires WebAuthn support; passphrase is always available.
   */
  isAvailable(): boolean

  /**
   * Enroll / configure the provider for a vault.
   *
   * For passphrase: derives KEK, wraps DEK, returns the enrollment artefacts.
   * For passkey (future): creates a credential, wraps KEK with the PRF output.
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
   * @param credential  Provider-specific credential (password string, WebAuthn assertion, …)
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

import { hkdfSync } from 'crypto'

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
// PasskeyUnlockProvider — WebAuthn PRF-based unlock
// ---------------------------------------------------------------------------

/**
 * Derive a 32-byte wrapping key from the WebAuthn PRF output via HKDF-SHA256.
 *
 * @param prfOutput  Raw PRF evaluation result from the authenticator (≥32 bytes)
 * @param prfSalt    Random salt generated during enrollment (stored in provider state)
 * @returns 32-byte AES key suitable for KEK wrapping
 */
export function derivePasskeyWrappingKey(prfOutput: Buffer, prfSalt: Buffer): Buffer {
  return Buffer.from(
    hkdfSync('sha256', prfOutput, prfSalt, 'wrv-passkey-kek-wrap-v1', 32),
  )
}

/**
 * Passkey (WebAuthn) unlock provider.
 *
 * Enrollment (while vault is unlocked with passphrase):
 *   1. UI performs navigator.credentials.create() with PRF extension
 *   2. PRF output + credential ID sent to backend
 *   3. Backend wraps the in-memory KEK with HKDF(PRF output, prfSalt)
 *   4. Stores wrappedKEK + credentialId + prfSalt in ProviderState
 *
 * Unlock:
 *   1. UI performs navigator.credentials.get() with PRF extension
 *   2. PRF output sent to backend
 *   3. Backend derives wrapping key, unwraps KEK
 *   4. KEK unwraps DEK → session established
 *
 * Lock:
 *   Zeroize cached KEK.
 */
export class PasskeyUnlockProvider implements UnlockProvider {
  readonly id: UnlockProviderType = 'passkey'
  readonly name = 'Passkey (WebAuthn)'

  private cachedKEK: Buffer | null = null

  isAvailable(): boolean {
    // Availability is determined client-side (WebAuthn API in browser).
    // The backend always supports processing the PRF output.
    return true
  }

  /**
   * Enroll is handled externally via VaultService.completePasskeyEnroll().
   * Direct enroll() is not the primary path for passkey — it requires a
   * WebAuthn ceremony that cannot happen in the backend.
   */
  async enroll(
    _password: string | undefined,
    _dek: Buffer,
    _kdfParams: KDFParams,
  ): Promise<{
    salt: Buffer
    wrappedDEK: Buffer
    kek: Buffer
    providerState: ProviderState
  }> {
    throw new Error(
      'PasskeyUnlockProvider.enroll() is not supported. ' +
      'Use VaultService.completePasskeyEnroll() after a WebAuthn ceremony.',
    )
  }

  /**
   * Unlock the vault using a WebAuthn PRF output.
   *
   * @param credential  Object with `prfOutput: Buffer` (the raw PRF evaluation result)
   * @param meta        Vault metadata context — must include providerState with passkey data
   */
  async unlock(
    credential: unknown,
    meta: VaultMetaContext,
  ): Promise<UnlockResult> {
    const { prfOutput } = credential as { prfOutput: Buffer }
    if (!prfOutput || !Buffer.isBuffer(prfOutput)) {
      throw new Error('PasskeyUnlockProvider.unlock requires { prfOutput: Buffer }')
    }

    const state = meta.providerState
    if (!state?.data?.wrappedKEK || !state?.data?.prfSalt) {
      throw new Error('Passkey provider state is missing or incomplete')
    }

    // Derive wrapping key from PRF output
    const prfSalt = Buffer.from(state.data.prfSalt, 'base64')
    const wrappingKey = derivePasskeyWrappingKey(prfOutput, prfSalt)

    // Unwrap KEK (reuse AES-256-GCM unwrap — KEK is 32 bytes, same format as DEK)
    const wrappedKEK = Buffer.from(state.data.wrappedKEK, 'base64')
    let kek: Buffer
    try {
      kek = await unwrapDEK(wrappedKEK, wrappingKey)
    } catch {
      zeroize(wrappingKey)
      throw new Error('Passkey verification failed — could not unwrap vault key')
    }
    zeroize(wrappingKey)

    // Unwrap DEK using the recovered KEK
    let dek: Buffer
    try {
      dek = await unwrapDEK(meta.wrappedDEK, kek)
    } catch {
      zeroize(kek)
      throw new Error('Failed to unwrap DEK with passkey-derived KEK')
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
  passkey: () => new PasskeyUnlockProvider(),
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
