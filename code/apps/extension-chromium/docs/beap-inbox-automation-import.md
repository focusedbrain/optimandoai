# BEAP Inbox — session import, Edit vs Run, integration defaults

Concise reference for the Chromium extension only. Roll back by reverting the feature branch; changes are localized to `beap-messages/`, `services/sessionImportCore.ts`, `services/modeRunExecution.ts`, `services/beapRunAutomationResult.ts`, and `content-script.tsx` BEAP handlers.

## Canonical session import

- **Resolver:** `beap-messages/sessionImportPayloadResolver.ts` — the only supported way to get an importable payload from a `BeapMessage` (attachment JSON + substance checks + `safeNormalizeImportedSessionPayload`).
- **Execution:** `services/sessionImportCore.ts` — `runCanonicalSessionImport` persists a working copy, activates per intent, and returns `sessionKey` + warnings.
- **Tab activation:** content script builds a `SessionImportActivationHost` and assigns `globalLightboxFunctions.runBeapEditSessionImport` / `runBeapAutomation` after extension init.

## Dedicated mode-run runtime path

- **Run Automation** ends in `executeModeRunAgents` (`services/modeRunExecution.ts`), which calls `matchAgentsForModeRun` — **not** `routeInput` / `matchInputToAgents`.
- **Outcome:** `interpretBeapAutomationModeRun` (`services/beapRunAutomationResult.ts`) fails explicitly when there are zero mode-run matches or when every execution fails (no silent success).

## BEAP Inbox Edit vs Run separation

| Action | Message type | Import | Activation | Agent execution |
|--------|----------------|--------|------------|-----------------|
| Edit session | `BEAP_EDIT_SESSION_IMPORT` | `runCanonicalSessionImport` | `activate_minimal`, unlock, Agents lightbox | **None** |
| Run Automation | `BEAP_RUN_AUTOMATION` | `runCanonicalSessionImport` | `activate_full` | `executeModeRunAgents` |

- Bridges: `beapSessionEditBridge.ts` vs `beapSessionRunBridge.ts` (distinct discriminant constants for tests and audits).
- Guards: `beapSessionBridgeGuards.ts` rejects non-object payloads before `tabs.sendMessage`; content script asserts again on the tab side.

## Integration-default metadata model

- **Scope:** Per verified sender fingerprint (+ optional `handshakeId` in the stable key). **Not** `mode_trigger`, custom-mode trigger-bar icons, or `agent.icon`.
- **Storage:** `chrome.storage.local` key `beap_integration_default_automation_v1`; entries keyed by `beapIntegrationStableKey(identity)`.
- **Validation:** `validateBeapIntegrationIdentity` — empty fingerprint blocks persistence and UI save; `upsertBeapIntegrationDefaultAutomationEntry` requires `integrationKey === beapIntegrationStableKey(identity)`.

## Manual regression (high level)

1. Message with valid session attachment: Edit opens working copy, no LLM/mode run.
2. Same message: Run imports, full activate; with enabled `mode_trigger` agents, runs execute; with none/disabled triggers, user sees the explicit “no eligible automation” error.
3. Sidepanel with missing/invalid payload: bridges return errors without crashing the tab.
4. Message without sender fingerprint: integration default section explains and disables save; Edit/Run still work if payload is valid.
5. Save integration default after Edit: reload sidepanel / switch message and confirm entry loads for the same stable key.
