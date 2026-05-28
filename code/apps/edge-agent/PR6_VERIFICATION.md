# PR6 manual verification

Requires Linux + Podman, paired Agent (PR4/PR5), orchestrator with an `EdgeReplica` using `deployment_type: "agent"` and pairing fields populated.

## Scenarios

1. **Pair with P2P tokens** — `/pair/initiate` returns `agent_encryption_public_key_b64`, `p2p_endpoint`, `agent_p2p_auth_token`; orchestrator sends `orchestrator_p2p_auth_token` on confirm.
2. **Relay credentials** — migrate Gmail/Microsoft account; orchestrator POSTs `/agent/credentials/relay` on `:51249`; `GET /agent/accounts/status` lists the account.
3. **Mail fetch** — after activate, mail-fetcher reaches `active`; mail arrives on orchestrator via edge path.
4. **Revoke** — disconnect account; `DELETE /agent/credentials/{id}`; account absent from status.
5. **SSH path unchanged** — replica with `deployment_type: "ssh"` (or omitted) still uses SSH `podman exec` migration.

Document results in the PR description.
