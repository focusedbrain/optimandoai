# PR4 manual verification

## Keycloak prerequisite

Register client `wrdesk-edge-agent`:

- Public client, PKCE
- Redirect: `http://127.0.0.1:8090/sso-callback`
- Scopes: `openid profile email offline_access`
- Token exchange audience: `beap-edge-attestation`
- **Refresh token policy**: confirm with realm owner whether VPS long-lived agents need extended refresh lifetime (document answer in PR description).

## Local mock pairing (no Keycloak)

```bash
export WRDESK_AGENT_PAIRING_HTTP=1
export WRDESK_AGENT_STATE_DIR=/tmp/wrdesk-agent-test
pnpm --filter @app/edge-agent build
pnpm --filter @app/edge-agent start
```

1. Seed SSO (or sign in via tunnel + Keycloak).
2. Open `http://127.0.0.1:8090/` — note pairing code from health JSON or UI.
3. Mock orchestrator:

```bash
BASE=http://127.0.0.1:8443   # or pairing port with -k for TLS
curl -s -X POST "$BASE/pair/initiate" -H 'Content-Type: application/json' -d '{
  "pairing_code": "123456",
  "orchestrator_sub": "<same as agent ssoSub>",
  "orchestrator_public_key": "'"$(python3 -c 'print("a"*64)')"'",
  "orchestrator_nonce": "orch-nonce-1"
}'
```

4. Confirm fingerprint in setup UI and:

```bash
curl -s -X POST "$BASE/pair/confirm" -H 'Content-Type: application/json' -d '{
  "session_id": "<from initiate>",
  "party": "orchestrator"
}'
```

5. Restart agent service — `phase` in `/agent/health` should stay `paired`.

## Automated tests

`pnpm --filter @app/edge-agent test` — SSO (mocked), fingerprint, state machine, pairing harness.

Real Keycloak integration: add `WRDESK_AGENT_KEYCLOAK_IT=1` when a test realm is available (not run in CI by default).
