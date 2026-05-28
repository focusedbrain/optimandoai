# PR5 manual verification

Requires Linux + Podman, paired Agent (PR4), and `beap-components:dev` built with digest recorded:

```bash
pnpm --filter @app/edge-agent run update-image-digest
```

## Scenarios

1. **Pod starts after pairing** — `curl -s http://127.0.0.1:8090/agent/health` shows `podState: running` within ~30s; `podman pod ps` lists `beap-pod-remote-edge`.
2. **Ingest health** — `curl http://127.0.0.1:18100/health` returns OK.
3. **Supervisor replace** — `podman kill beap-pod-remote-edge-depackager`; within ~15s container is running again (`podman ps`).
4. **Budget exhaustion** — kill same role 6 times in 10 minutes; `podState` becomes `replacement_exhausted` or `halted_by_anomaly`; pod stopped.
5. **Agent shutdown** — `systemctl stop wrdesk-edge-agent`; pod removed within 30s.
6. **Digest mismatch** — retag wrong image as `beap-components:dev`; restart agent; `podState: start_failed`, `podLastErrorCode: image_digest_mismatch`.
7. **Recovery** — `curl -X POST http://127.0.0.1:8090/agent/recover` after clearing halt flags in state (or from exhausted with budget reset).

Document results in the PR description.
