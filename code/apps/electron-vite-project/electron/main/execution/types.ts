/**
 * Execution Layer — Type Definitions
 *
 * Canonical types for tool execution requests, results, and the tool handler
 * registry. All tool invocations flow through executeToolRequest() which
 * requires authorization via authorizeToolInvocation() before dispatch.
 */

export interface ToolRequest {
  readonly request_id: string;
  readonly handshake_id?: string;
  readonly relationship_id?: string;
  readonly tool_name: string;
  readonly scope_id?: string;
  readonly purpose_id?: string;
  readonly parameters: Record<string, unknown>;
  readonly requested_at: string;
  readonly origin: ToolRequestOrigin;
}

export type ToolRequestOrigin = 'local_ui' | 'extension' | 'sandbox' | 'automation';

export type ToolExecutionResult =
  | { readonly success: true; readonly result: unknown; readonly duration_ms: number }
  | { readonly success: false; readonly reason: string; readonly details?: string; readonly duration_ms: number };

export type ToolHandler = (params: Record<string, unknown>) => Promise<unknown>;

export const EXECUTION_CONSTANTS = {
  MAX_PARAMETER_BYTES: 5 * 1024 * 1024,
  TOOL_TIMEOUT_MS: 30_000,
} as const;
