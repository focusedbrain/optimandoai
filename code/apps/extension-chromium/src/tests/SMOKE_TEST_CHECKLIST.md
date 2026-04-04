# WR Chat — manual smoke test checklist

Run these after changes that touch WR Chat surfaces, capture flow, tag normalisation, `promptContext` routing, InputCoordinator / listener gates, or agent-box updates (Prompts 1–8).

---

## SURFACE: Docked Sidepanel

- [ ] Open the extension sidebar → **WR Chat** is visible in the docked sidepanel.
- [ ] Click the **capture** control → a region-selection overlay appears on the page.
- [ ] Draw a region → **Trigger Name** and **Command** fields appear **in the sidepanel** (not only in the overlay).
- [ ] In **dark theme**, both fields show a **visible outline** (focus/hover states are readable).
- [ ] In **Trigger Name**, type `#a1` → the field **normalises** display (e.g. `#a1`, consistent casing).
- [ ] Type a **command** → both trigger and command fields stay populated as expected.
- [ ] Click **Save** → **exactly one** new user message appears in the **sidepanel** thread (screenshot attachment + command text; no duplicate rows).
- [ ] **InputCoordinator** routes to agent **A1** → the **agent box** for A1 updates in the **sidepanel** (not another surface).
- [ ] A confirmation such as **"[Agent: A1] responded"** (or equivalent) appears in the **sidepanel** thread.
- [ ] **Popup WR Chat** and **Dashboard WR Chat** show **no** new messages from this capture (isolation).

---

## SURFACE: Popup WR Chat

- [ ] Open **popup** WR Chat (WR Chat in the popup surface).
- [ ] Click **capture** → overlay appears on the active tab.
- [ ] Select a region → **Trigger Name** and **Command** appear **in the popup** WR Chat UI.
- [ ] **Dark theme**: both fields have a **visible outline**.
- [ ] Type `#a1` in Trigger Name → **normalised** display.
- [ ] Enter a command → both fields populated.
- [ ] **Save** → **one** message in the **popup** thread (screenshot + command).
- [ ] Routing → correct **agent box** updates **in the popup**.
- [ ] **"[Agent: …] responded"** (or equivalent) appears in the **popup** thread.
- [ ] **Sidepanel** and **Dashboard** WR Chat show **no** new messages from this flow.

---

## SURFACE: Dashboard WR Chat

- [ ] Open **Dashboard** WR Chat (dashboard surface).
- [ ] **Capture** → overlay on screen.
- [ ] Select region → **Trigger Name** and **Command** in the **dashboard** WR Chat panel.
- [ ] **Dark theme**: field outlines **visible**.
- [ ] `#a1` → **normalised** in Trigger Name.
- [ ] Command text → both fields correct.
- [ ] **Save** → **one** message in the **dashboard** thread.
- [ ] **Agent box** updates **on the dashboard** for the routed agent.
- [ ] Response confirmation in the **dashboard** thread.
- [ ] **Sidepanel** and **Popup** show **no** extra messages from this capture.

---

## Cross-surface isolation

- [ ] Start **capture from sidepanel** while **popup** WR Chat is open → **popup** thread and state are **unchanged** by that capture.
- [ ] **Capture from popup** while **dashboard** is open → **dashboard** is **unchanged**.
- [ ] **Capture from dashboard** while **sidepanel** is open → **sidepanel** thread is **unchanged**.

---

## Automated checks (developer / CI)

- [ ] `npm run test:wrchat` (or `npx vitest run src/tests/wrChatPipeline.test.ts`) completes with **no failures**.
- [ ] All **`normaliseTriggerTag`** cases in `wrChatPipeline.test.ts` pass.
- [ ] All **`surfaceFromSource`** cases pass (including `unknown` → `sidepanel` fallback).
- [ ] All **InputCoordinator** routing cases pass (WR Chat tag, keyword gate, strict reject, capability / expected-context path).
- [ ] **SHOW_TRIGGER_PROMPT** surface gating tests pass (`promptContext` matches only the intended surface).

---

## Note on full `npm test`

The extension package may include additional legacy suites; for WR Chat pipeline verification, prefer **`npm run test:wrchat`** so failures in unrelated tests do not block WR Chat validation.
