# Phase 4.5 Tracker — Wizard Explainer, Upgrade Gate & Email-on-Edge

> **Phase 4.5 commits land on `phase-1/pod-becomes-hot-path`. Branch name is historical.**

Branch: `phase-1/pod-becomes-hot-path`  
Strategy ref: `docs/architecture/beap-high-assurance-strategy.md` (§4 wizard, §11 email source on edge)  
Plan audit ref: `docs/architecture/beap-plan-upgrade-flow-audit.md`  
Phase 4 ref: `docs/architecture/phase-4-tracker.md`  
Manual test: [`phase-4-5-manual-test.md`](phase-4-5-manual-test.md)

---

## Hard rules

1. **Pricing URL is hardcoded for now.** Use `https://wrdesk.com/?page_id=1080&v=5f02f0889301` as the upgrade target. Do **not** refactor `sandboxCloneFeedbackUi.ts` or `coordination-service` to share the URL — those keep their own URLs.

2. **Edge tier = paid only, but ANY paid tier.** Use the existing `isPaidTier()` helper from `wizard/handlers.ts`. Do **not** require `pro` minimum like the password manager — edge tier accepts Pro, Publisher, and Business/Enterprise.

3. **Email-on-edge means the desktop IMAP client does NOT run for migrated accounts.** That is the security property. If at any step you add fallback logic where the desktop fetches an edge-migrated account when the edge is unreachable, **stop** — that defeats the entire purpose.

4. **Email credentials never on edge VM disk in plaintext.** Strategy §11.5 is the protocol. Tmpfs only for the wrapped key; container memory only for the unwrapped key.

5. **Desktop owns OAuth client registration.** The edge never runs a browser OAuth flow. Refresh tokens are minted on desktop, transferred to edge.

6. **AI is advisory, validator is canon, cert is a gate not a substitute** — every prior phase's hard rules still apply.

**Do not merge to `main`** until downstream phases sign off.

---

## Steps

- [x] **P4.5.0** — Confirm branch and create Phase 4.5 tracker *(this file)*
- [x] **P4.5.1** — Enterprise-tone explainer copy module (`copy/explainerCopy.ts`)
- [x] **P4.5.2** — Wizard intro step: explainer + tier-aware CTA (`StepExplainer`, `wizard:refreshTier`)
- [x] **P4.5.3** — Reusable tier badge + refresh control (`TierBadgeWithRefresh`)
- [x] **P4.5.4** — mail-fetcher role stub (`packages/beap-pod/src/roles/mail-fetcher.ts`)
- [x] **P4.5.5** — mail-fetcher implementation (`packages/email-fetch`, supervisor API, fetch loop)
- [x] **P4.5.6** — REMOTE_EDGE mail-fetcher container in pod manifest + smoke/README (strategy §11.7)
- [x] **P4.5.7** — Per-account fetch-via-edge UI with consent dialog and state display (strategy §11.3, §11.8)
- [x] **P4.5.8** — VM reboot recovery: automatic key re-delivery when mail-fetcher reports awaiting_key (strategy §11.5, §11.8)
- [x] **P4.5.9** — Wizard finale step: email-on-edge handoff to Settings → Email accounts
- [x] **P4.5.10** — End-to-end manual test + phase closeout *(re-run after P4.5.15)*

### Credential hardening (post-audit, re-opens phase)

- [x] **P4.5.11** — Move SSH file reading from renderer to main process
- [x] **P4.5.12** — Zero credentials on every exit path
- [ ] **P4.5.13** — *(pending)*
- [ ] **P4.5.14** — *(pending)*
- [ ] **P4.5.15** — *(pending)*

---

## Status summary

| Step | State | Commit |
|------|-------|--------|
| P4.5.0 | ✅ done | P4.5.0: phase 4.5 tracker |
| P4.5.1 | ✅ done | P4.5.1: enterprise-tone explainer copy module |
| P4.5.2 | ✅ done | P4.5.2: wizard intro step with explainer and tier-aware CTA |
| P4.5.3 | ✅ done | P4.5.3: TierBadgeWithRefresh reusable component |
| P4.5.4 | ✅ done | P4.5.4: mail-fetcher role stub |
| P4.5.5 | ✅ done | P4.5.5: mail-fetcher implementation with per-account fetch loop and supervisor API |
| P4.5.6 | ✅ done | P4.5.6: add mail-fetcher container to REMOTE_EDGE pod manifest |
| P4.5.7 | ✅ done | P4.5.7: per-account fetch-via-edge UI with consent dialog and state display |
| P4.5.8 | ✅ done | P4.5.8: supervisor VM reboot recovery and automatic key re-delivery |
| P4.5.9 | ✅ done | P4.5.9: wizard finale step with email-on-edge handoff |
| P4.5.10 | ✅ done *(re-run after P4.5.15)* | P4.5.10: end-to-end manual test and phase 4.5 closeout |
| P4.5.11 | ✅ done | P4.5.11: read SSH key files in main process; renderer never sees PEM bytes |
| P4.5.12 | ✅ done | P4.5.12: zero credentials on every exit path; passphrase as Buffer not string |

---

## Phase 4.5 exit criteria (from strategy)

Phase 4 set up the edge as certificate authority for messages handed to it. Phase 4.5 makes the edge the **actual message source** for opted-in accounts: untrusted email bytes never reach the desktop first.

| Criterion | Target | Closeout |
|-----------|--------|----------|
| Wizard explainer | Enterprise-tone; free users can browse steps | ✅ impl + unit tests |
| Upgrade gate | Deploy blocked until paid tier; upgrade URL + plan refresh | ✅ impl + unit tests |
| Email-on-edge | Opted-in accounts fetched on edge only; no desktop IMAP fallback | ✅ impl + unit tests; live E2E checklist |
| Credential protocol | §11.5 — wrapped keys on tmpfs; unwrapped in container memory only | ✅ impl + smoke docs |
| OAuth | Minted on desktop; edge never runs browser OAuth | ✅ impl |
| VM reboot recovery | Key re-delivery within ~60s | ✅ impl + rebootRecovery tests |

**Builds on Phase 4:** six-step wizard, dashboard, SSH deploy. Phase 4.5 wraps UX and adds email migration as the wizard finale.

---

## Phase 4.5 done — 2026-05-24 *(credential hardening re-opens phase)*

Phase 4.5 steps P4.5.0–P4.5.10 shipped on branch `phase-1/pod-becomes-hot-path`. **P4.5.11–P4.5.15** (SSH credential hardening from post-ship audit) must land before the phase is declared done again; **P4.5.10 manual test is re-run after P4.5.15**.

**Deliverables**

- Eight-step wizard (explainer → deploy → verify → **email-on-edge finale**)
- Free-tier upgrade gate with pricing URL + tier refresh
- mail-fetcher on REMOTE_EDGE pod; per-account migration UI with three-checkbox consent
- VMK-wrapped account keys + SSH creds; 60s reboot recovery poll
- Manual E2E procedure: [`phase-4-5-manual-test.md`](phase-4-5-manual-test.md)

**Automated verification (closeout session)**

- Phase 4.5–scoped vitest: **132 tests passed** (22 files), including edge-tier, wizard, explainer, dashboard, email-edge-fetch UI, email-fetch package, edgeFetch rules.
- `rebootRecovery.test.ts`: **5/5** when run individually.
- `pnpm -r test`: all workspace packages passed except **`apps/extension-chromium`** (19 pre-existing `CSS.escape` / jsdom failures — unchanged from Phase 4 closeout).

**Live VPS + OAuth E2E**

- Full walkthrough in `phase-4-5-manual-test.md` is the human release gate (not CI).
- Closeout doc session ran on **Windows** without local Podman or a test VPS; **live E2E was not executed during P4.5.10 commit**. Execute the manual test on **Linux + VPS + real Gmail/Microsoft test account** before production sign-off; record pass/fail in a **private** tester note (no hosts, emails, or tokens in git).

**Branch policy:** Do **not** merge to `main` until downstream phases sign off.

---

## Notes & deviations

*(Record any decisions made differently from the strategy or prompt sequence here, with rationale.)*

### P4.5.0

- Tracker created on `phase-1/pod-becomes-hot-path` after Phase 4 closeout (`P4.9`).
- **P4.5.1–P4.5.10 titles** are scoped from the Phase 4.5 implementation prompt sequence header (explainer → upgrade gate → email-on-edge). Refine step titles when individual prompts are run if the sequence doc differs.
- `docs/architecture/beap-plan-upgrade-flow-audit.md` referenced in strategy refs; audit content lives in conversation / to be committed separately if needed.

### P4.5.1

- **Module:** `src/edge-tier-wizard/copy/explainerCopy.ts` — structured constants: headline, overview (3 paragraphs), three threats, limitations, email-on-edge (2 paragraphs).
- **Tests:** 8 pass in `copy/__tests__/explainerCopy.test.ts` (5 snapshot + 3 structure); snapshots lock tone.
- **UI:** none this step — P4.5.2 integrates copy into wizard entry shell.
- Terminology: “off-band pod” / “this computer” (not marketing “edge tier” in explainer body).
- Strategy §11 (email source on edge) referenced in prompts; verify section exists in `beap-high-assurance-strategy.md` before P4.5.5+ (may be local-only until strategy update lands).
- `git pull` had no upstream tracking branch configured; branch already on `phase-1/pod-becomes-hot-path`.
- Working tree had unstaged `beap-high-assurance-strategy.md` at P4.5.0 start — left untouched (not part of P4.5.0 commit).

### P4.5.7

- Migration UI lives under **BEAP inbox → Email accounts** (`EmailProvidersSection` + `EmailEdgeFetchControls`), not inside the wizard.
- Desktop sync skips accounts with active `edgeFetch` state.

### P4.5.8

- Reboot recovery poll (60s) replaces P4.5.7’s 30s supervisor status poll for background SSH; VMK-wrapped SSH creds persisted at migration time.
- Recovery audit events appear in dashboard Verifications tab (`key_redelivered_after_restart`, `vault_locked_waiting`, `unwrap_failed_degraded`).

### P4.5.9

- Wizard finale is step 8 (“Email on edge”); state machine transitions last-replica verify success → `finale` (not `complete`).
- “Open email accounts settings” dispatches `wrdesk:open-email-accounts-settings` → BEAP inbox view.

### P4.5.12

- **`security/zeroize.ts`:** `zeroizeBuffer`, `zeroizeString` (debug marker), `withCredential`, registered clearers + `zeroizeAllRegisteredCredentials`.
- **Buffers from IPC:** passphrases and SSH keys converted to `Buffer` at IPC boundary; wizard `sshSession` stores `Buffer` key + passphrase.
- **Exit paths:** `replicaActions` / `globalActions` / `supervisorPoll` zero in `finally`; `wizard:reset` uses `clearWizardVmCredentials()`; `app.before-quit` calls all registered clearers.
- **Tests:** `zeroize.test.ts`, `sshSession.test.ts`, `supervisorPoll.test.ts`, replica/global zero tests, `credentialConsumers.snapshot.test.ts`.

### P4.5.11

- **Main-process key read:** `readSshKeyFile.ts` validates regular file, ≤4 KB, parses via `ssh2` `parseKey`; `wizard:pickSshKeyFile` uses native file dialog.
- **Renderer:** `StepProvideVm` stores `keyFilePath` only; passphrase cleared after successful `wizard:setVmCredentials` (residual IPC exposure documented in component).
- **Tests:** `readSshKeyFile.test.ts`, `ipcCredentials.test.ts`, renderer grep in `credentialHardening.test.ts`.
- **Reset fix:** `wizard:reset` calls `clearWizardVmCredentials()` (zero-and-drop) instead of test-only reset.

### P4.5.10

- Manual test doc modeled on [`phase-4-manual-test.md`](phase-4-manual-test.md).
- **Automated closeout:** 132 Phase 4.5–scoped vitest tests pass; monorepo test run blocked only by pre-existing extension-chromium failures (19).
- **Live E2E:** not run in closeout agent environment (no Podman/VPS on Windows). Human tester must execute checklist and confirm: free/paid wizard paths, migration, inbox delivery via edge, reboot recovery, move-back, OAuth revoke/re-authorize, log redaction.
- No account info, VPS hostnames, or message bodies committed to this tracker.
