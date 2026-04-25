# Host AI — final non-negotiables (architecture)

These are **invariants**, not a symptom checklist. Work that violates them must be rejected or redesigned.

## Do not

- **Patch individual UI symptoms** — fix the data path and contracts; the renderer shows projection from main, not heuristics.
- **Add more fallback branches inside the model selector** — one merge pipeline; avoid nested “if GAV lags, infer X” in React.
- **Use `p2p_endpoint` / `p2p_endpoint_kind` as the primary gate for true P2P Host AI** — ledger roles + same principal + **internal handshake** own discovery; transport policy comes from the **transport decider** and **P2P session manager**, not from classifying the URL alone.
- **Route inference through `/beap/capsule`** — internal inference is **service RPC** (ingest, DC, or policy-defined paths), not the BEAP capsule pipeline.
- **Insert inference messages into the BEAP inbox** — Host AI chat and inbox stay separate products.
- **Weaken internal handshake validation** — `assertRecordForServiceRpc`, same-principal, ACTIVE, roles: do not “paper over” with shortcuts.
- **Change behavior of external (non-internal) handshakes** to serve Host AI — internal rows only; external contracts stay as they are.

## The correct model (three layers)

1. **Discovery / “who is the Host target?”**  
   **Internal handshake only** — see `listSandboxHostInternalInferenceTargets` / `listHandshakeRecords` filtered to internal, ACTIVE, same account, Sandbox→Host. Not endpoint-string guessing.

2. **Transport readiness (WebRTC, signaling, DataChannel)**  
   **`p2pSession` / `ensureSession` / session phase** — readiness is whatever the **P2P session manager** reports (`connecting`, `ready`, `failed`, etc.), combined with `decideInternalInferenceTransport` for feature flags. **Not** “relay URL in ledger ⇒ blocked” when full WebRTC stack is on and signaling is valid.

3. **Legacy direct HTTP (MVP LAN ingest)**  
   **Isolated to legacy fallback** — `assertP2pEndpointDirect` / `legacy_http_invalid` / HTTP probe paths apply when the decider chose legacy HTTP, not as the top-level “is Host AI on?” switch. **Does not** define future WebRTC behavior when flags and session manager allow P2P.

## Related code (anchors)

| Concern | Primary modules |
|--------|-----------------|
| Internal handshake, list rows, `p2pUiPhase` | `electron/main/internalInference/listInferenceTargets.ts` |
| Transport decision + WebRTC vs HTTP | `electron/main/internalInference/transport/decideInternalInferenceTransport.ts` |
| Session lifecycle | `electron/main/internalInference/p2pSession/p2pInferenceSessionManager.ts` |
| UI projection only | `src/lib/hostModelSelectorRowUi.ts`, `mapHostTargetsToGavModelEntries` |
| Ingest branch (not capsule) | `electron/main/internalInference/p2pServiceDispatch.ts` |

## See also

- [STEP 10 production readiness acceptance](STEP10-production-readiness-acceptance.md)
