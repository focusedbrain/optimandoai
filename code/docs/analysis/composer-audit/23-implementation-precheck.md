# Implementation precheck (Phase 1–2)

Brief answers validated in code before layout/composer work.

## 1. Is `BeapInboxDashboard` actually unused?

**Yes in the Electron renderer import graph.** `grep` of `apps/electron-vite-project/src` shows **no** `import … BeapInboxDashboard` from any file other than the component file itself. `BeapBulkInboxDashboard` is only referenced from its own file and enum/source constants (e.g. `ConnectEmailLaunchSource`).

**Caveat:** `electron/main` still calls `notifyBeapInboxDashboard` after sync—IPC may target a future window or dead path; not a blocker for inbox layout changes.

## 2. Where is `orchestratorSessionId` consumed?

In **`BeapInlineComposer.tsx`**, `sessionId` state is included only in a **`console.log`** payload (`logPayload.orchestratorSessionId`). It is **not** passed into `executeDeliveryAction(config)` and **`BeapPackageConfig`** in `BeapPackageBuilder.ts` has **no** `orchestratorSessionId` field (grep in builder shows no match).

**Conclusion:** Orchestrator session selection is **not** part of the send contract today—logging only. No change required for Phase 1–2 send behavior.

## 3. Multiple active PDF extraction paths?

**Yes — distinct entry points:**

| Path | Role |
|------|------|
| `electron/main.ts` — `POST /api/parser/pdf/extract` | HTTP route used by **`HybridSearch`** context upload (renderer `fetch` to localhost). |
| `electron/main/email/pdf-extractor.ts` — `extractPdfText` | Used by **email/inbox** pipeline (`ipc.ts`, `gateway.ts`, `messageRouter.ts`) for message attachments. |
| `electron/main/vault/hsContextOcrJob.ts` | Vault HS context jobs; same pdf.js `getTextContent` strategy (comment references alignment with `pdf-extractor`). |
| Extension `beap-builder/parserService.ts` | Can call Electron `…/api/parser/pdf/extract` from extension context. |

**Conclusion:** HybridSearch and inbox email paths are **separate** implementations sharing pdf.js-style extraction. Phase 1–2 explicitly **does not** change any of these.
