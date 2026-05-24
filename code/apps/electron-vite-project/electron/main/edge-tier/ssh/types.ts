/**
 * SSH edge-deploy types — Phase 4 (P4.1).
 */

export type SupportedDistroFamily = 'debian' | 'fedora' | 'rhel'

export type UnsupportedDistroId = 'alpine' | 'arch' | 'opensuse' | 'other'

export type PackageManagerKind = 'rpm' | 'dpkg' | 'unknown'

export type ProbeFailureReason =
  | 'unsupported_distro'
  | 'no_sudo'
  | 'probe_command_failed'
  | 'not_linux'

export interface SshConnectOptions {
  readonly host: string
  readonly port?: number
  readonly username: string
  /** PEM private key material (held in memory by the wizard caller). */
  readonly privateKey: string | Buffer
  readonly passphrase?: string
  readonly readyTimeoutMs?: number
}

export type SshProgressEvent =
  | { readonly type: 'stdout'; readonly chunk: string }
  | { readonly type: 'stderr'; readonly chunk: string }
  | { readonly type: 'exit'; readonly code: number | null; readonly signal?: string }

export interface RunResult {
  readonly stdout: string
  readonly stderr: string
  readonly code: number | null
  readonly signal?: string
}

/** Minimal surface {@link probeTarget} needs (real {@link SshClient} or test double). */
export interface SshCommandRunner {
  run(command: string): Promise<RunResult>
}

export interface ParsedOsRelease {
  readonly id: string
  readonly versionId: string
  readonly idLike: readonly string[]
  readonly name?: string
}

export interface DistroClassification {
  readonly distro: string
  readonly version: string
  readonly family: SupportedDistroFamily | 'unsupported'
  readonly unsupportedId?: UnsupportedDistroId
}

export interface TargetProbeDetails {
  readonly distro: string
  readonly version: string
  readonly family: SupportedDistroFamily | 'unsupported'
  readonly podman_installed: boolean
  readonly package_manager: PackageManagerKind
  readonly is_root: boolean
  readonly has_passwordless_sudo: boolean
}

export type TargetProbeVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: ProbeFailureReason; readonly message: string }

export interface TargetProbe extends TargetProbeDetails {
  readonly verdict: TargetProbeVerdict
}
