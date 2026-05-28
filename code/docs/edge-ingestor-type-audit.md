# edge_ingestor handshake type audit (PR4.5)

Step 0 finding: PR4 persisted **Agent encrypted `pairRecord` only** — no orchestrator handshake DB row yet (PR8). Migration v70 is a no-op unless test DBs had mistaken `internal` + `edge_agent` rows.

| Location | Decision | Notes |
|----------|----------|-------|
| `handshakeAccountIsolation.ts` | **same-user** | `isSameUserHandshake` — internal + edge_ingestor |
| `internalRelayOutboundGuards.ts` enqueue/POST | **same-user** | Relay wire validation for both types |
| `internalRelayOutboundGuards.ts` `applyContextSyncInternalRoutingFromRecord` | **sandbox-only** | Context sync routing is sandbox-internal UX |
| `hostAiInternalPairingLedger.ts` | **sandbox-only** | Inference ledger — unchanged |
| `outboundQueue.ts` internal branches | **sandbox-only** | Sandbox relay queue — unchanged |
| `contextSyncEnqueue.ts` | **sandbox-only** | Sandbox context sync — unchanged |
| `p2pTokenBackfill.ts` | **sandbox-only** | Internal wire backfill — unchanged |
| `relayPull.ts` reverse internal wire | **sandbox-only** | Sandbox reverse wire — unchanged |
| `coordinationWs.ts` internal wire | **review PR6** | May expand for edge_ingestor when messages land |
| `coordination-service/server.ts` initiate guard | **same-user** | Allows `internal` and `edge_ingestor` |
| `p2pTransport.ts` log summary | **both** | Parses `edge_ingestor` in wire logs |
| `RelationshipDetail.tsx` | **display** | Type union includes `edge_ingestor` |
| `preload.ts` | **both** | Accepts `edge_ingestor` in opts |
| `extension SendHandshakeDelivery` | **sandbox-only** | Still `internal` for sandbox pairing |
| `internalIdentityUi.ts` | **display** | Verification server label for edge_agent |

Agent pairing (`pairingConfirm.ts`) creates `handshake_type: edge_ingestor` in `pairRecord`.
