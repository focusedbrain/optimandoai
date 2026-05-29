# Legal review flags — consolidated (all redistribution surfaces)

**Purpose:** Single checklist for qualified counsel before production redistribution of WR Desk artifacts.  
**Last updated:** 2026-05-29  
**Regenerate npm scans:** see commands in per-surface `THIRD-PARTY-NOTICES` files.

---

## Summary matrix

| Surface | Distributable artifact | Notices path (in artifact) | Podman disclosed? | Automated npm scan |
|---------|------------------------|----------------------------|-------------------|-------------------|
| **Desktop orchestrator** | Electron installer / unpacked dir | `resources/licenses/` (extraResources) | Yes — `THIRD_PARTY_LICENSES.md` + `podman-Apache-2.0.txt` | Monorepo `THIRD_PARTY_LICENSES.md` (manual curation) |
| **Edge ingestor** | `beap-components` image | `/app/THIRD-PARTY-NOTICES`, `/app/licenses/` | Yes — § External runtime | `pnpm licenses list --filter @repo/beap-pod... --prod` |
| **Relay** | `beap-coordination` image | `/app/THIRD-PARTY-NOTICES`, `/app/licenses/` | Yes — § External runtime | `pnpm licenses list --filter @repo/coordination-service --prod` |

**CI gate:** `node scripts/check-distributable-notices.mjs`

---

## Cross-surface — external runtime (not bundled)

| Component | License | Surfaces | Action |
|-----------|---------|----------|--------|
| **Podman** | Apache-2.0 | Desktop, edge VM, relay host | Confirm attribution in shipped docs/notices; no bundling claim. |
| **Ollama** | MIT | Desktop only | Already in `THIRD_PARTY_LICENSES.md` + `ollama-MIT.txt`. |

---

## Desktop orchestrator (Electron)

| Item | Risk | Notes |
|------|------|-------|
| **Electron runtime** | Standard | MIT — `apps/electron-vite-project/THIRD_PARTY_LICENSES/electron-MIT.txt` |
| **Native modules** (`better-sqlite3`, `canvas`, `keytar`) | Review | MIT npm wrappers; native libs may carry additional terms (SQLite blessing, Cairo, OS keychain APIs). |
| **`better-sqlite3` / SQLite** | **Review** | npm MIT; embedded SQLite uses [SQLite blessing](https://www.sqlite.org/copyright.html) (public-domain dedication). |
| **`pdfjs-dist`, `tesseract.js`, `@tensorflow/tfjs`** | Low–medium | Apache-2.0 — NOTICE requirements for bundled workers/WASM. |
| **`expand-template` / WTFPL** | N/A on desktop app direct tree | Appears in relay `better-sqlite3` transitive tree only — see relay section. |
| **Podman (external)** | N/A — not redistributed | Apache-2.0 — `podman-Apache-2.0.txt` |

**Shipped artifact check:** production build uses `electron-builder.config.cjs` → `resources/licenses/` includes repo `THIRD_PARTY_LICENSES/`, app `THIRD_PARTY_LICENSES/`, and `THIRD_PARTY_LICENSES.md`.

---

## Edge ingestor (`beap-components` image)

**Scoped notices:** `packages/beap-pod/THIRD-PARTY-NOTICES` (baked via `Containerfile`).

| Item | Risk | Notes |
|------|------|-------|
| **Alpine Linux (`node:20-alpine`)** | **Review** | Mixed licenses; includes GPL-2.0 userland (BusyBox). `licenses/alpine-linux-notice.txt`, `licenses/busybox-GPL-2.0-notice.txt`. |
| **musl libc** | Low | MIT — `licenses/musl-MIT-notice.txt`. |
| **BusyBox (Alpine base)** | **Review** | GPL-2.0-only — `licenses/busybox-GPL-2.0-notice.txt`. |
| **Node.js 20** | Low | MIT — `licenses/node-runtime-MIT.txt`. |
| **`pdfjs-dist` (Apache-2.0)** | Low–medium | Mozilla PDF.js — NOTICE in npm package. |
| **`@napi-rs/canvas` (MIT)** | Low | Native Skia binary per platform in image. |
| **`imap` (MIT)** | Low | Via `@repo/email-fetch` / mail-fetcher role. |
| **Copyleft in npm `license` fields** | None flagged (2026-05-29 scan) | 33 packages — re-run after dependency changes. |
| **`expand-template` (WTFPL)** | **N/A** | Not present in edge npm tree. |
| **`better-sqlite3` / SQLite** | **N/A** | Not present in edge npm tree. |
| **Podman (edge VM host)** | N/A — not redistributed | Apache-2.0 — § External runtime in edge notices. |

**Regenerate scan:**

```bash
node packages/beap-pod/scripts/generate-third-party-notices.mjs
```

**Post-build auditor command:**

```bash
podman run --rm --entrypoint sh <beap-components:tag> -c 'test -f /app/THIRD-PARTY-NOTICES && ls /app/licenses'
```

---

## Relay (`beap-coordination` image)

**Scoped notices:** `packages/coordination-service/THIRD-PARTY-NOTICES` (unchanged — already baked in Dockerfile).

| Item | Risk | Notes |
|------|------|-------|
| **Debian bookworm-slim base** | **Review** | GPL/LGPL userland possible. `licenses/debian-bookworm-notice.txt`. |
| **Node.js 22** | Low | MIT — `licenses/node-runtime-MIT.txt`. |
| **`tini`** | Low | MIT — `licenses/tini-MIT.txt`. |
| **`expand-template` (transitive)** | **Review** | npm `(MIT OR WTFPL)` — unusual; counsel to confirm. |
| **`rc` (transitive)** | **Review** | `(BSD-2-Clause OR MIT OR Apache-2.0)` — dual-licensed. |
| **`better-sqlite3` / SQLite** | **Review** | npm MIT; SQLite blessing for embedded library. |
| **Copyleft in npm `license` fields** | None flagged at last relay scan | Re-run after dependency changes. |
| **Podman (relay host)** | N/A — not redistributed | Apache-2.0 — § External runtime in relay notices. |

**Regenerate scan:**

```bash
node packages/coordination-service/scripts/generate-third-party-notices.mjs
```

---

## Recommended counsel sign-off checklist

- [ ] Alpine `node:20-alpine` base (edge) — BusyBox GPL-2.0 and redistribution model
- [ ] Debian `node:22-bookworm-slim` base (relay) — userland copyleft inventory if required
- [ ] SQLite embedding via `better-sqlite3` (relay + desktop) — blessing / notice sufficiency
- [ ] `expand-template` WTFPL option (relay npm tree only)
- [ ] `pdfjs-dist` Apache-2.0 NOTICE propagation (desktop + edge)
- [ ] External Podman/Ollama attribution — no false bundling claims in marketing or installers
- [ ] Re-run npm license scans after any dependency bump before release tag
