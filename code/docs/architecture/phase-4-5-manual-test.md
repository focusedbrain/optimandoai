# Phase 4.5 — Manual end-to-end test (explainer, upgrade gate, email-on-edge)

Branch: `phase-1/pod-becomes-hot-path`  
Date documented: 2026-05-24

This procedure proves the full **Phase 4.5** flow: enterprise-tone wizard explainer, **free-tier upgrade gate**, **paid-tier eight-step deployment** (including finale handoff), **per-account email migration to the edge**, **real email round-trip via mail-fetcher**, **VM reboot key recovery**, and **move-back**. It builds on the Phase 4 wizard and dashboard — see [`phase-4-manual-test.md`](phase-4-manual-test.md) for replica deploy, dashboard actions, and provider-agnostic checks not repeated here.

**Tester record (do not commit):** keep a private note of VPS hostname/IP, provider, distro, test email address, pass/fail per section, and `edge_pod_id` values observed.

---

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Podman locally** | Podman Desktop or native Podman on the machine running the BEAP Electron app. Local verification pod must start after vault unlock when edge tier is enabled. |
| **Linux VPS with root SSH** | Any provider or self-hosted server. Tester supplies host, port (default 22), user, and private key. Supported distros: Debian, Ubuntu, Fedora, RHEL, Rocky, Alma (same as Phase 4 probe). |
| **Google or Microsoft 365 test account** | A mailbox you are willing to use for migration testing. Gmail or Microsoft 365 only (edge fetch does not support generic IMAP for migration). |
| **BEAP app built and running** | On **Linux** (recommended): `pnpm install`, build pod image per `packages/beap-pod/README.md`, start Electron (`pnpm --filter electron-vite-project dev` or packaged build). Vault unlocked. |
| **Free-tier SSO session** | For upgrade-gate walkthrough. Sign out / use a separate test user on free plan. |
| **Paid-tier SSO session** | Private, Pro, Publisher, Business, or Enterprise — any paid tier. Required for deployment and email-on-edge. |
| **SSH key on VPS** | Public key in `authorized_keys` for the SSH user used in wizard and edge-fetch SSH prompts. |
| **Outbound network** | Desktop → VPS:22; VPS can pull container images; desktop can reach Google/Microsoft OAuth endpoints. |

Optional prep:

```bash
pnpm --filter @repo/beap-pod build
pnpm --filter @repo/email-fetch build
podman build -t beap-components:dev -f packages/beap-pod/Containerfile packages/beap-pod
# Install seccomp profiles per packages/beap-pod/README.md
```

Pricing URL (hardcoded Phase 4.5 rule): `https://wrdesk.com/?page_id=1080&v=5f02f0889301`

---

## Free-tier walkthrough

Use a **free-tier** SSO session. Edge tier deploy must remain blocked until paid.

### Launch explainer

1. Unlock vault; ensure local Podman / local pod is running.
2. Open header tab **Edge tier** → **Set up edge tier** (`data-testid="edge-dashboard-launch-wizard"`).
3. **Expect:** wizard opens on **Step 0 — Overview** (`data-testid="wizard-step-explainer"`).
4. **Expect:** scrollable enterprise-tone explainer (overview, threats, limitations, email-on-edge section).
5. **Expect:** primary CTA is **Upgrade Now** (`data-testid="wizard-explainer-upgrade"`), **not** “Continue to deployment”.
6. **Expect:** tier badge with refresh icon (`data-testid="tier-badge-refresh"`) and hint “Already upgraded? Click the refresh icon…”.

### Upgrade Now

1. Click **Upgrade Now**.
2. **Expect:** system browser opens the pricing URL above (same URL as `WIZARD_UPGRADE_URL` in `copy.ts`).
3. **Do not** complete checkout (unless testing upgrade path below).

### Tier refresh without upgrade

1. Return to the app; wizard still on explainer.
2. Click the **refresh** icon on the tier badge.
3. **Expect:** tier re-check runs (`wizard:refreshTier` IPC); badge still shows free tier.
4. **Expect:** CTA remains **Upgrade Now**; wizard does **not** advance to authenticate.

### Optional — upgrade path

If you have an upgrade-able test account:

1. Complete checkout in browser.
2. Return to wizard; click refresh on tier badge.
3. **Expect:** CTA changes to **Continue to deployment** (`data-testid="wizard-explainer-continue"`).
4. **Expect:** wizard advances to **Sign in** on success.

---

## Paid-tier walkthrough

Sign in with a **paid-tier** account before opening the wizard.

### Explainer (paid)

1. Open **Set up edge tier**.
2. **Expect:** explainer content identical to free tier (same copy).
3. **Expect:** primary CTA **Continue to deployment** (no Upgrade Now).
4. Click **Continue to deployment** → wizard advances to **Sign in**.

### Steps 1–7 — Deploy (Phase 4 flow + Phase 4.5 progress)

Complete the wizard per [`phase-4-manual-test.md`](phase-4-manual-test.md) with these Phase 4.5 deltas:

| Progress label | Step |
|----------------|------|
| Overview | Explainer (Step 0) |
| Sign in | Authenticate |
| Provide VM | VM credentials |
| Probe & prepare | Probe + Podman |
| Replica count | Replica count |
| Deploy | Generate & deploy |
| Verify & enable | Verify & switch |
| **Email on edge** | **Finale (Step 8)** |

1. **Sign in** — refresh session & verify plan; paid gate passes.
2. **Provide VM** — enter VPS SSH credentials.
3. **Probe & prepare** — probe OK, Podman ready.
4. **Replica count** — **1 replica** recommended for first email-on-edge pass.
5. **Deploy** — observe live log; REMOTE_EDGE pod includes **mail-fetcher** container (5 containers total per P4.5.6).
6. **Verify & enable** — confirm checkbox, run verify; **Expect:** “Verification succeeded. Edge tier routing is now enabled.”
7. **Finale** — **Expect:** `data-testid="wizard-step-finale"`, title **Edge deployment complete**, migration guidance, buttons:
   - **Open email accounts settings** (`wizard-finale-open-email-accounts`)
   - **I'll do this later** (`wizard-finale-later`)

8. Click **I'll do this later** → wizard closes; dashboard shows enabled edge tier.

**Finale navigation check:** re-open wizard is not required; click **Open email accounts settings** on a second run (or from a fresh deploy) → **Expect:** app navigates to **BEAP inbox** view with email accounts panel visible (`data-testid="email-accounts-settings-section"` on standard inbox layout).

---

## Email-on-edge walkthrough

Prerequisites: paid-tier wizard complete; at least one healthy replica on dashboard; test Gmail or Microsoft 365 account connected on desktop.

### Open migration UI

1. Go to **BEAP inbox** (header tab).
2. Locate **Email accounts** / provider section (`EmailProvidersSection`).
3. On the test account row, **Expect:** **Move to edge** (`data-testid="edge-fetch-move-to-edge"`) when state is `not_on_edge`.

### Consent and SSH

1. Click **Move to edge**.
2. **Expect:** consent dialog (`data-testid="edge-fetch-consent-dialog"`) with **three** checkboxes:
   - Credentials encrypted on edge VM
   - Email may pause during edge restarts
   - Provider may show new sign-in notification
3. **Negative (consent):** leave one or more boxes unchecked → **Expect:** confirm button **disabled** (`edge-fetch-consent-confirm`).
4. Check **all three** boxes; enter SSH credentials for the replica host (same VPS as deploy).
5. Click **Move to edge** (confirm).

### OAuth and state transitions

1. **Expect:** browser OAuth for Gmail or Microsoft 365 (desktop-owned client — edge never runs browser OAuth).
2. **Expect:** row state **Migrating to edge…** then **Edge VM** / `active` (`data-testid="edge-fetch-row-{accountId}"` `data-state="active"`).
3. **Expect:** desktop **processing paused** for this account (no local IMAP sync for edge-migrated account).

### Real email round-trip

1. From an external mailbox, **send an email** to the test account address.
2. Wait for edge mail-fetcher poll + certifier path (typically 1–3 minutes depending on provider).
3. **Expect:** message appears in desktop inbox (depackaged/certified content).
4. Open **Edge tier** → **Verifications** tab.
5. **Expect:** verification rows for your `edge_pod_id` — shallow/deep `verified` for BEAP traffic; after email fetch, audit may also show recovery events (`key_redelivered_after_restart`) if reboot test ran.

CLI cross-check:

```bash
cat ~/.config/wr-desk/edge-verification-audit.json | jq '.verifications[-10:]'
```

### Desktop does not fetch provider directly

While account is **active** on edge:

1. Watch Electron/main logs during inbox sync ticks.
2. **Expect:** no IMAP/OAuth refresh log lines for the migrated `account_id` on the desktop sync path (edge fetch accounts skip local sync — see `edgeFetch` gating in sync orchestrator).
3. **Expect:** mail-fetcher on VPS handles fetch (optional: `podman exec … mail-fetcher` logs on VPS — do not paste tokens into notes).

### Log redaction check

After migration and at least one fetched message, scan main-process logs and `~/.config/wr-desk/` audit files:

- **Must NOT appear:** refresh tokens, OAuth access tokens, raw message bodies, account key hex, SSH private key material.
- **May appear:** `account_id`, `edge_pod_id`, email address (account label), verification `result` strings.

---

## Reboot recovery test

With an **active** edge-fetched account:

1. SSH to the VPS hosting the replica.
2. Restart the pod:

   ```bash
   podman pod restart beap-pod
   ```

   (Use the actual pod name from deploy if different.)

3. On desktop, within **~60 seconds** (`REBOOT_RECOVERY_POLL_MS`):
   - **Expect:** account row shows **Reconnecting…** (`awaiting_key` / `data-state="awaiting_key"`).
   - **Expect:** then returns to **Edge VM** / `active` without manual re-migration.
4. **Expect:** optional desktop notification / audit entry `key_redelivered_after_restart` in verifications tab.
5. Send **another test email** → **Expect:** arrives in inbox after edge recovery.

### Vault locked + reboot (negative)

1. With account active on edge, **lock the vault** (or simulate vault locked at recovery time).
2. Restart pod on VPS (`podman pod restart …`).
3. **Expect:** account stays **Reconnecting…** / `awaiting_key`.
4. **Expect:** notification: edge account waiting for **vault unlock** to resume email fetching.
5. Unlock vault; wait for next recovery poll (~60s).
6. **Expect:** account returns to **active** without re-migration.

---

## Provider notification check

1. In Google Account security or Microsoft account **Recent activity**, locate the sign-in from the edge VM region/IP after migration or first fetch.
2. **Expect:** new sign-in / app access notification from the provider.
3. **Approve** or acknowledge if the provider requires it for continued access.

---

## Move-back test

1. On the migrated account row, click **Move back to this computer** (`edge-fetch-move-back`).
2. **Expect:** warning dialog with move-back copy (`EDGE_FETCH_MOVE_BACK_WARNING`).
3. Confirm; supply SSH credentials; complete flow.
4. **Expect:** state returns to **This computer** / `not_on_edge`.
5. **Expect:** desktop resumes direct provider sync for that account (IMAP/OAuth on desktop path).
6. Send a test email → **Expect:** arrives via desktop fetch path.

---

## OAuth revoke / degraded / re-authorize (negative)

1. With account **active** on edge, revoke app access in Google or Microsoft security settings (remove WR Desk / OAuth app access for the test account).
2. Wait for mail-fetcher to fail refresh on edge.
3. **Expect:** desktop row transitions to **degraded** (`data-testid="edge-fetch-reauthorize"` visible).
4. Click **Re-authorize**; complete consent + OAuth again.
5. **Expect:** account returns to **active**; email fetch resumes.

---

## Pass criteria (Phase 4.5 done)

| Check | Expected |
|-------|----------|
| Free-tier explainer | Upgrade Now + tier refresh; deploy blocked |
| Paid-tier explainer | Continue to deployment |
| Eight-step wizard | Deploy + verify + **finale** handoff |
| Email migration | Consent (3 boxes), OAuth, migrating → active |
| Real email via edge | Inbox delivery + edge_pod_id in verification audit |
| No desktop fallback | Migrated account skips local IMAP while active |
| VM reboot recovery | Reconnecting… → active within ~60s; second email arrives |
| Vault locked reboot | awaiting_key + notification until unlock |
| Consent tamper | Confirm disabled until all boxes checked |
| OAuth revoke | degraded → Re-authorize → active |
| Move-back | Restores desktop fetch |
| Logs | No credentials, tokens, or message bodies in logs |
| Automated tests | Phase 4.5 vitest green; `pnpm -r test` modulo pre-existing extension failures |

---

## Automated verification (from repo root)

Phase 4.5–focused vitest (2026-05-24 closeout):

```bash
pnpm exec vitest run \
  apps/electron-vite-project/electron/main/edge-tier \
  apps/electron-vite-project/electron/main/wizard \
  apps/electron-vite-project/src/edge-tier-wizard \
  apps/electron-vite-project/src/edge-tier-dashboard \
  apps/electron-vite-project/src/components/email-edge-fetch \
  apps/electron-vite-project/electron/main/email/edgeFetch/__tests__ \
  packages/email-fetch
```

**Result:** 22 test files, **132 tests passed** (Windows closeout run). Reboot recovery suite: 5/5 when run individually (`rebootRecovery.test.ts`).

Full monorepo:

```bash
pnpm -r test
```

**Pre-existing failures (not Phase 4.5 regressions):** `apps/extension-chromium` — 19 tests (`CSS.escape` undefined in jsdom, selector escaping). All other workspace packages completed successfully before extension-chromium failed the recursive run.

---

## Phase 4.5 commits (reference)

| Commit | Step |
|--------|------|
| `83e9ae40` | P4.5.0 tracker |
| `43c186cc` | P4.5.1 explainer copy |
| `42e4d838` | P4.5.2 explainer step + tier CTA |
| `b90ce196` | P4.5.3 TierBadgeWithRefresh |
| `177c9045` | P4.5.4 mail-fetcher stub |
| `ac1749f3` | P4.5.5 mail-fetcher implementation |
| `7b5ff96c` | P4.5.6 REMOTE_EDGE mail-fetcher container |
| `750af26f` | P4.5.7 per-account fetch-via-edge UI |
| `593ae906` | P4.5.8 VM reboot recovery + key re-delivery |
| `5f810f5a` | P4.5.9 wizard finale / email handoff |
| *(this commit)* | P4.5.10 manual test + closeout |

Builds on Phase 4 commits — see [`phase-4-manual-test.md`](phase-4-manual-test.md).

---

## Notes

- **No CI E2E:** real OAuth and VPS interaction cannot run in CI; this document is the release gate.
- **No telemetry** in Phase 4.5 (deferred to Phase 6).
- **Do not merge** `phase-1/pod-becomes-hot-path` to `main` until downstream phases sign off.
- SSH credentials for edge-fetch migration are VMK-wrapped locally (P4.5.8); wizard deploy SSH keys are still ephemeral per Phase 4.
- Strategy refs: §4 wizard, §11 email source on edge (`beap-high-assurance-strategy.md`).
