# Phase 4.5 Tracker — Wizard Explainer, Upgrade Gate & Email-on-Edge

> **Phase 4.5 commits land on `phase-1/pod-becomes-hot-path`. Branch name is historical.**

Branch: `phase-1/pod-becomes-hot-path`  
Strategy ref: `docs/architecture/beap-high-assurance-strategy.md` (§4 wizard, §11 email source on edge)  
Plan audit ref: `docs/architecture/beap-plan-upgrade-flow-audit.md`  
Phase 4 ref: `docs/architecture/phase-4-tracker.md`

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
- [ ] **P4.5.10** — End-to-end manual test + phase closeout

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
| P4.5.10 | ⬜ pending | — |

---

## Phase 4.5 exit criteria (from strategy)

Phase 4 set up the edge as certificate authority for messages handed to it. Phase 4.5 makes the edge the **actual message source** for opted-in accounts: untrusted email bytes never reach the desktop first.

| Criterion | Target |
|-----------|--------|
| Wizard explainer | Enterprise-tone; free users can browse steps |
| Upgrade gate | Deploy blocked until paid tier; upgrade URL + plan refresh |
| Email-on-edge | Opted-in accounts fetched on edge only; no desktop IMAP fallback |
| Credential protocol | §11.5 — wrapped keys on tmpfs; unwrapped in container memory only |
| OAuth | Minted on desktop; edge never runs browser OAuth |

**Builds on Phase 4:** six-step wizard, dashboard, SSH deploy. Phase 4.5 wraps UX and adds email migration as the wizard finale.

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
