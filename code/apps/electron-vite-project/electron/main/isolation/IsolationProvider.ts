/**
 * IsolationProvider — the single host→pipeline abstraction.
 *
 * Every backend (Podman-exec, Hyper-V, Firecracker) implements this interface.
 * The rest of the application NEVER talks to a backend directly — only through
 * the provider returned by resolveIsolationProvider().
 *
 * callPipeline is the ONLY data path host → isolated pipeline → host.
 * There is NO published-TCP-port assumption anywhere in this interface.
 * Each backend delivers bytes via its own native channel:
 *   Podman   → podman exec -i <container> (runtime socket, not TCP)
 *   Hyper-V  → Hyper-V socket / hvsocket  (STUB — future)
 *   Firecracker → vsock                   (STUB — future)
 *
 * Payload encoding convention for callPipeline:
 *   payloadBytes is a JSON-encoded Buffer specific to (role, op).
 *   The provider decodes, dispatches to the isolated pipeline, and returns
 *   a JSON-encoded Buffer with the result (which may be an error envelope).
 *   Throwing from callPipeline means the pipeline channel itself is unavailable
 *   (provider down, exec failed, etc.) — the caller should surface as 503.
 */

export type IsolationTier = 'hyperv' | 'firecracker' | 'podman' | 'none'

export interface CapabilityResult {
  /** Whether the backend can be used right now. */
  available: boolean
  /**
   * Whether the backend has a real callPipeline implementation.
   * Stubs set this to false even when available=true (hardware detected, but
   * vsock/hvsocket transport not yet implemented). The capability ladder skips
   * stubs regardless of available.
   */
  implemented: boolean
  tier: IsolationTier
  /** Human-readable reason for available=false or implemented=false. */
  details: string
}

/**
 * Core isolation interface. All data flows through callPipeline; everything
 * else is lifecycle management.
 */
export interface IsolationProvider {
  /**
   * Probe this backend's availability and implementation status.
   * Must not throw — all errors are returned as available:false.
   */
  detectCapability(): Promise<CapabilityResult>

  /**
   * Bring the isolated unit to ready state (start pod / microVM if needed).
   * Idempotent — safe to call when already running.
   * Throws if the unit cannot be made ready.
   */
  ensurePipelineReady(): Promise<void>

  /**
   * Deliver payloadBytes to the isolated pipeline role/op and return the
   * response bytes. This is the ONLY data path from the host into isolation.
   *
   * @param role    Which pipeline role handles this request (e.g. 'ingestor').
   * @param op      Operation within that role (e.g. 'extract-pdf').
   * @param payloadBytes  JSON-encoded request body specific to (role, op).
   * @returns       JSON-encoded response from the isolated pipeline.
   * @throws        IsolationChannelError when the channel itself fails
   *                (provider unavailable, exec error, timeout).
   *                Op-level errors (e.g. parse failure) are encoded in the
   *                returned bytes, not thrown.
   */
  callPipeline(role: string, op: string, payloadBytes: Buffer): Promise<Buffer>

  /** Graceful teardown. Idempotent. */
  teardown(): Promise<void>
}

/** Thrown when the isolation channel fails — caller should surface as 503. */
export class IsolationChannelError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'IsolationChannelError'
    this.code = code
  }
}

/** Thrown when callPipeline is called on a stub backend. */
export class IsolationNotImplementedError extends Error {
  readonly tier: IsolationTier
  constructor(tier: IsolationTier, channel: string) {
    super(
      `IsolationProvider: ${tier} backend is detected but not yet implemented. ` +
        `The ${channel} transport for ${tier} will be wired in a future build. ` +
        `The capability ladder should not have reached callPipeline on a stub.`,
    )
    this.name = 'IsolationNotImplementedError'
    this.tier = tier
  }
}
