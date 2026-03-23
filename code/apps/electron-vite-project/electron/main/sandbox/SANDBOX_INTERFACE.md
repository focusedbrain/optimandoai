# BEAP™ Sandbox Sub-Orchestrator — Interface Contract

## Overview

The Sandbox Sub-Orchestrator provides an isolated execution environment for content that cannot be directly processed by the handshake pipeline. It sits downstream of the Distribution Gate, which routes `ValidatedCapsule` items to the sandbox when they are:

- External drafts (`internal_draft` with `origin_classification: 'external'`)
- Capsules with unresolved governance state
- Capsules where policy explicitly requires sandbox review

## Architecture

```
Distribution Gate
      │
      ▼
sandboxClient.enqueueTask(task)
      │
      ▼
sandbox_queue (SQLite)
      │
      ▼
sandboxClient.consumeResults()
      │
      ▼
sandboxProcessBridge.processTaskViaWorker(task)
      │
      ▼  ─── process boundary (child_process.fork) ───
      │
sandboxWorker.ts (isolated child process, Node IPC)
      │
      ▼
SandboxResult (validated by client before acceptance)
```

### Process Isolation

The sandbox worker runs as a separate process via `child_process.fork()`:

- **Transport**: Node IPC (`process.send` / `process.on('message')`)
- **Isolation**: Process-level — worker has no access to host SQLite, handshake state, tool registry, or audit log
- **Crash resilience**: Worker crash → task marked `failed`, host continues unaffected
- **Timeout**: Enforced by the bridge; if the worker exceeds `time_limit_ms`, the process is killed and the task fails

## Interface Contract

### Host SHALL:

1. **Enqueue tasks** only via `sandboxClient.enqueueTask(task: SandboxTask)`
2. **Accept results** only via `sandboxClient.consumeResults()`
3. **Never** call worker internals (`processTaskInWorker`, `processTask`) directly
4. **Never** import `sandboxWorker.ts` or `sandboxServiceStub.ts` in production code
5. **Never** pass unvalidated data to the sandbox
6. **Never** execute sandbox output as host code

### Sandbox SHALL:

1. Consume tasks from `sandbox_queue`
2. Mark them `processed` upon completion
3. Produce `SandboxResult` conforming to the defined schema
4. **Never** execute host code or attempt tool invocations
5. **Never** access the network or filesystem beyond its constraints
6. **Never** return raw secrets or host-executable instructions

## Types

### `SandboxTask`

| Field | Type | Description |
|---|---|---|
| `task_id` | `string` | Unique identifier |
| `created_at` | `string` (ISO 8601) | Creation timestamp |
| `raw_input_hash` | `string` | SHA-256 of original input |
| `validated_capsule` | `unknown` | Serialized capsule reference |
| `reason` | `'external_draft' \| 'unresolved_governance' \| 'policy_requires_sandbox'` | Routing reason |
| `constraints.network` | `'denied' \| 'restricted'` | Network access level |
| `constraints.filesystem` | `'denied' \| 'ephemeral'` | Filesystem access level |
| `constraints.time_limit_ms` | `number` | Maximum execution time |

### `SandboxResult`

| Field | Type | Description |
|---|---|---|
| `task_id` | `string` | Matches the input task |
| `completed_at` | `string` (ISO 8601) | Completion timestamp |
| `status` | `'verified' \| 'rejected' \| 'error'` | Outcome |
| `findings` | `Array<SandboxFinding>` | Findings from analysis |
| `output_summary` | `string?` | Human-readable summary |

### `SandboxFinding`

| Field | Type | Description |
|---|---|---|
| `code` | `string` | Finding code (e.g., `SUSPICIOUS_LINK`) |
| `severity` | `'low' \| 'medium' \| 'high'` | Severity level |
| `message` | `string` | Description |

## Persistence

Tasks are persisted in the `sandbox_queue` SQLite table with deduplication via `raw_input_hash` (UNIQUE INDEX). Status transitions:

```
queued → processing → processed
                   → failed
```

## Worker Behavior (Current)

The current worker (`sandboxWorker.ts`) is a deterministic stub running in a child process:

- Consumes queued tasks via Node IPC
- Returns `status: 'verified'` with empty findings
- Never executes any payload
- Never accesses the network, filesystem, host database, or tool registry

The legacy in-process stub (`sandboxServiceStub.ts`) is retained for reference and direct unit tests but is NOT used by `sandboxClient.ts` in production.

## Replacing the Worker

To implement a real sandbox sub-orchestrator:

1. Replace the processing logic in `sandboxWorker.ts`
2. Or, to change the transport (e.g., Docker), update `sandboxProcessBridge.ts` to use HTTP/Unix socket instead of `child_process.fork()`
3. `sandboxClient.ts` interface remains stable — no changes required
4. Alternatively, inject a custom `TaskProcessor` via `setTaskProcessor()` for gradual migration

## Security Invariants

1. The sandbox cannot escalate trust or invoke tools on the host
2. Results are validated by `sandboxClient` before acceptance
3. Malformed results are rejected (fail-closed)
4. The sandbox has no access to the handshake database or audit log
5. Static analysis tests enforce that no production code imports worker or stub internals directly
6. Worker crash → task marked `failed`, host process unaffected
7. No path from sandbox output to tool execution without `executeToolRequest()`
8. Sandbox result is inert data — never interpreted as executable code by the host
