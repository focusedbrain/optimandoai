# Epic: Collapse Edge Agent pairing onto SSO + coordination handshake

**Estimate:** ~45–70 engineer-days (see `docs/analysis/headless-handshake-acceptor-scoping.md`).

## Gates (do not start deletion or production cutover until all are met)

1. Current pairing protocol tested end-to-end on real infrastructure.
2. Product owner confirms headless auto-accept trust model (`apps/edge-agent/HEADLESS_ACCEPT_TRUST_MODEL.md`).
3. Dedicated epic cycle with its own test plan (not wedged into unrelated work).

## Read first

- `docs/analysis/agent-pairing-vs-sso-handshake-analysis.md`
- `docs/analysis/headless-handshake-acceptor-scoping.md`

## Workstreams (dependency order)

| WS | Scope | Status |
|----|--------|--------|
| 1 | Agent registry participation, device identity, setup UI (registry path) | In progress — behind `WRDESK_AGENT_REGISTRY_BOOTSTRAP=1` |
| 2 | Coordination WebSocket on Agent | Not started |
| 3 | Handshake ledger + ingest pipeline port | Not started |
| 4 | Headless auto-accept + security review | Not started — policy in `HEADLESS_ACCEPT_TRUST_MODEL.md` |
| 5 | Orchestrator `edge_ingestor` relay initiate + wizard | Not started (`internal` only in `ipc.ts` today) |
| 6 | Delete pairing protocol, alignment tests | Not started — **last** |

## Constraint

Legacy pairing (`:8443`, fingerprint, pairing Ed25519 keys) remains until workstream 6 after 1–5 prove end-to-end. Default install keeps legacy path (`WRDESK_AGENT_REGISTRY_BOOTSTRAP` unset).

## De-risk spike (optional)

1–2 weeks on WS1+2 + manual/scripted accept before full WS4 auto-accept.
