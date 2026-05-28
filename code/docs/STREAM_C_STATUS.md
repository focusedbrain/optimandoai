# Stream C — Edge Agent implementation status

## Landed in this session (foundational PRs)

### C1 — `@repo/sso` (PR1-ready)

- New package `packages/sso/`: PKCE, discovery, refresh, JWT verify, token exchange / edge attestation.
- Orchestrator `src/auth/{oidcConfig,pkce,discovery,refresh,jwtVerify}.ts` delegate to `@repo/sso`.
- `electron/main/edge-tier/attestation.ts` uses `requestEdgeAttestation` from `@repo/sso`.
- Unit tests in `packages/sso/__tests__/sso.test.ts`.

**Not yet moved:** `login.ts`, `loopback.ts`, `session.ts`, `tokenStore.ts` (keytar binding stays in orchestrator per design).

### C2 — `edge_agent` role (PR2-ready)

- `InternalDeviceRole` includes `edge_agent` in `@repo/shared`.
- Pairing rules: `host ↔ edge_agent` allowed; `sandbox ↔ edge_agent` rejected.
- Handshake types + `internalRelayOutboundGuards` accept `edge_agent` on wire.
- Test: `internalEndpointValidation.edgeAgent.test.ts`.

**Follow-up:** coordination relay allowlist documentation, DB migration comment, full handshake E2E test with simulated Agent peer, preload/renderer type unions.

### C3 — Edge Agent skeleton (PR3-ready)

- `apps/edge-agent/`: config, encrypted storage, setup HTTP UI (localhost), health endpoint, pod-manager stub, systemd unit, install script stub.
- Startup asserts `@repo/role-policy` send forbidden.
- Tests: pairing code, storage, role policy.

## Not started (PR4–PR10)

| Step | Scope |
|------|--------|
| C4 | Full SSO on Agent + pairing protocol + fingerprint confirm |
| C5 | Podman `play kube`, supervisor port, digest verify, quarantine pickup |
| C6 | Credential relay from orchestrator over P2P |
| C7 | Log stream receiver + UI |
| C8 | Orchestrator pairing wizard (replaces SSH steps) |
| C9 | SSH → Agent migration + `deployment_type: 'agent'` |
| C10 | Cross-process CI + manual VPS verification matrix |

## Key paths

- Agent: `apps/edge-agent/src/main.ts`
- SSO: `packages/sso/src/`
- Role pairing: `packages/shared/src/handshake/internalEndpointValidation.ts`

## Verify locally

```bash
pnpm --filter @repo/sso build && pnpm --filter @repo/sso test
pnpm --filter @app/edge-agent build && pnpm --filter @app/edge-agent test
```
