# STEP 10 — Production readiness acceptance

**Architecture invariants (non-negotiable):** [Host AI architecture invariants](HOST_AI_ARCHITECTURE_INVARIANTS.md)

This checklist is the sign-off target for Host AI (internal Sandbox→Host, WebRTC, selectors).  
**Automated anchors:** `src/lib/__tests__/step10.productionReadiness.acceptance.test.ts`  
**Deep unit coverage:** `electron/main/internalInference/__tests__/listInferenceTargets.step8.test.ts` (incl. STEP 8 production safety), `src/lib/__tests__/step8.productionSafety.*.test.ts`

---

## A. Active internal Sandbox→Host + WebRTC enabled

| Criterion | Evidence / how to verify |
|-----------|---------------------------|
| Host AI target appears | `listSandboxHostInternalInferenceTargets` returns `host_internal` when ledger proves S→H; UI uses `fetchSelectorModelListFromHostDiscovery` |
| `p2p_endpoint_kind=relay` does not disable target when WebRTC stack is on | Tests: “STEP 3: relay + full P2P stack on” — `p2pUiPhase === 'ready'`, `transportMode === 'webrtc_p2p'` |
| Session/signaling attempt starts | `ensureSession(hid, 'model_selector')` from `listInferenceTargets`; STEP 6 test asserts call + `connecting` row |
| UI: connecting / ready / p2p unavailable | Renderer uses `p2pUiPhase` + `displayTitle` from main (`hostModelSelectorRowUi`, no endpoint-kind heuristics) |

---

## B. Signaling / DataChannel success

| Criterion | Evidence |
|-----------|----------|
| Capabilities over DataChannel | `internalInferenceTransport.ts`: `webrtc_p2p` → `requestHostInferenceCapabilitiesOverDataChannel` |
| Active Host model in top chat + WR Chat | Same merged `host_internal` row: `selectorModelListFromHostDiscovery`, `mapHostTargetsToGavModelEntries`, `wrChatModelOptionsFromSelectorModels` |

---

## C. Signaling / DataChannel failure

| Criterion | Evidence |
|-----------|----------|
| Compact P2P unavailable UI | `p2pUiPhase === 'p2p_unavailable'` + `Host AI · P2P unavailable` copy (`hostAiSelectorCopy`, `hostRefreshFeedback`) |
| No false “model unavailable” for transport | `hostAiChatBlockedUserMessage`, `formatInternalInferenceErrorCode` (extension) — transport codes use P2P wording; true no-model uses `no_model` / `HOST_NO_ACTIVE_LOCAL_LLM` |
| No relay **inference** payload when WebRTC path failed | Capabilities/inference stay on failed return when session/DC not up; HTTP ingest only when decider selects legacy HTTP path and direct ingest is allowed (see `decideInternalInferenceTransport` + `canPostInternalInferenceHttpToP2pEndpointIngest`) |

---

## D. WebRTC off + HTTP fallback

| Criterion | Evidence |
|-----------|----------|
| Old direct HTTP path may be used | `decideInternalInferenceTransport` + `legacy_http_invalid` / MVP direct-LAN rules |
| `p2p_endpoint=relay` → `legacy_http_invalid` when stack off | Unit: “p2p relay URL is not direct — with P2P stack off” + STEP 8 production safety (2) |
| Does not break future WebRTC | Feature flags hot path in `getP2pInferenceFlags` / `resetP2pInferenceFlagsForTests` in tests — re-enable env and retest |

---

## E. Host side (this device is Host on the internal pair)

| Criterion | Evidence |
|-----------|----------|
| No Host AI self-target | `listSandboxHostInternalInferenceTargets` early exit / empty for Host-only ledger; `FINAL ACCEPTANCE — no Host AI self-target` tests |
| No refresh button | `computeShowHostInferenceRefresh` — `ledgerProvesLocalHostPeerSandbox` → `show: false` |
| Local model selectors unchanged | Host merge skipped when not sandbox-to-host; no change to local/cloud ordering contract beyond adding `host_internal` on Sandbox |

---

## F. Logs (production hygiene)

| Criterion | Evidence |
|-----------|----------|
| One first failing stage per attempt | `[HOST_AI_STAGE]` — `failure_code` only when `success: false` (`hostAiStageLog.ts`) |
| No raw prompt / completion / SDP / ICE / tokens in logs | File header contract in `hostAiStageLog.ts`; `webrtcTransportIpc.ts` — “no SDP/ICE logging”; `redactP2pLogLine` / `redactIdForLog` on P2P paths; `internalInferenceLogRedact.test.ts` |

---

## Manual smoke (cannot fully automate)

1. Two real devices: Sandbox + Host, relay URL, WebRTC flags on — confirm Host AI row → connecting → ready → send chat.  
2. Disable Host or block network — row shows P2P unavailable, no misleading “no model” unless probe returns no model.  
3. On Host machine: confirm no Host AI self row and no ↻ next to model menu when ledger says local Host.
