# Fragile contracts — code pointers

Internal note: where **behavior-critical** integrations are documented in source. **Not** a redesign spec.

| Contract | Primary locations |
|----------|-------------------|
| `window.__wrdeskInsertDraft` | `ProjectOptimizationPanel.tsx` (assign + `Window` typing), `HybridSearch.tsx` (Use / Use All) |
| `window.__wrdeskOptimizerHttp` | `wrDeskOptimizerHttpBridge.ts` (implementation + DEV shape check), `optimizerHttpInvoke.ts` (main invokes) |
| `WRDESK_FOCUS_AI_CHAT_EVENT` | `wrdeskUiEvents.ts`, `HybridSearch.tsx` (listener), `ProjectOptimizationPanel` (`focusHeaderAiChat`) |
| `WRCHAT_CHAT_FOCUS_REQUEST_EVENT` / `WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT` | `WrMultiTriggerBar.tsx`, `AddModeWizardHost.tsx` |
| `data-field` / `data-milestone-id` | `ProjectOptimizationPanel.tsx` (`flashFieldEl`, `flashMilestoneEl`, form markup) |
| `useProjectSetupChatContextStore` | `useProjectSetupChatContextStore.ts`, `HybridSearch.tsx`, `ProjectOptimizationPanel.tsx` |
| `wr-desk-projects` localStorage | `useProjectStore.ts` (persist `name`), `triggerProjectList.ts` (main reads), `chatFocusLlmPrefix.ts` (extension reads key) |
| Watchdog vs optimizer “continuous” | `WrChatWatchdogButton.tsx` + `watchdog/*` HTTP vs `fetchOptimizerTrigger.ts` + `wrDeskOptimizerHttpBridge.ts` |

See also §17 in `ui-refactor-analysis.md` for refactor constraints.
