# Open questions and risk register

## Purpose
Tracks uncertainties and risks before implementation.

## Files
N/A.

## Ownership
N/A.

## Rendering path
N/A.

## Inputs and outputs
N/A.

## Dependencies
N/A.

## Data flow
N/A.

## UX impact
N/A.

## Current issues

### Open questions
1. **`BeapInboxDashboard` usage** — Grep of `apps/electron-vite-project` shows **no** `import … BeapInboxDashboard` from other components (only the file itself + main/email notifier names). **Likely dead code** in the renderer; confirm before deleting — IPC `notifyBeapInboxDashboard` may still expect a future or alternate window.
2. **Orchestrator session:** Does `sessionId` change runtime behavior beyond logging? — Trace `orchestratorSessionId` in `executeDeliveryAction`.
3. **Sidepanel BEAP builder parity:** How much does docked extension match `popup-chat.tsx`? — Needs `sidepanel.tsx` read.
4. **PDF port:** Is orchestrator always on 51248 in dev and prod?
5. **Concurrent refine:** Can inbox + compose both set `useDraftRefineStore` in conflicting ways?

### Risk register
| Risk | Likelihood | Impact | Mitigation idea |
|------|------------|--------|-----------------|
| Full-width layout breaks keyboard shortcuts | Med | Med | Test `EmailInboxBulkView` key handler with compose |
| Reusing extension components bloats Electron bundle | Med | Low | Lazy load / separate chunk |
| PDF OCR request expands scope | High | Med | Phase OCR separately |
| Moving context upload breaks Prompt 5 flows | Med | High | Feature flag or dual-mount period |

## Old vs new comparison
N/A.

## Reuse potential
N/A.

## Change risk
N/A.

## Notes
Update this file after spikes.
