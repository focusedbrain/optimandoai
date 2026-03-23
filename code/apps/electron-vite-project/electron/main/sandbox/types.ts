/**
 * Sandbox Sub-Orchestrator — Type Definitions
 *
 * Stable interface contract between Host (Electron main) and Sandbox.
 * The sandbox returns only verified results — never raw secrets, never
 * host-executable instructions.
 */

export interface SandboxTask {
  readonly task_id: string;
  readonly created_at: string;
  readonly raw_input_hash: string;
  readonly validated_capsule: unknown;
  readonly reason: SandboxTaskReason;
  readonly constraints: SandboxConstraints;
}

export type SandboxTaskReason =
  | 'external_draft'
  | 'unresolved_governance'
  | 'policy_requires_sandbox';

export interface SandboxConstraints {
  readonly network: 'denied' | 'restricted';
  readonly filesystem: 'denied' | 'ephemeral';
  readonly time_limit_ms: number;
}

export interface SandboxResult {
  readonly task_id: string;
  readonly completed_at: string;
  readonly status: 'verified' | 'rejected' | 'error';
  readonly findings: ReadonlyArray<SandboxFinding>;
  readonly output_summary?: string;
}

export interface SandboxFinding {
  readonly code: string;
  readonly severity: 'low' | 'medium' | 'high';
  readonly message: string;
}

export const SANDBOX_CONSTANTS = {
  DEFAULT_TIME_LIMIT_MS: 30_000,
  DEFAULT_NETWORK: 'denied' as const,
  DEFAULT_FILESYSTEM: 'ephemeral' as const,
} as const;
