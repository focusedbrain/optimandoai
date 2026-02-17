# Release Notes — WebMCP Preview-Only Adapter

**Version:** 0.0.1-webmcp-preview
**Date:** 2026-02-16

## Added

- WebMCP preview-only fast path for overlay creation. External MCP tools
  can request autofill preview via `WEBMCP_FILL_PREVIEW`; values are
  committed only when the user clicks Insert (isTrusted gesture required).
- Background IPC sender gate: all side-effect messages now validate
  `sender.id === chrome.runtime.id`, blocking cross-extension invocation.
- Per-tab rate limiting (2 s) for WebMCP requests with automatic cleanup
  on tab close (`chrome.tabs.onRemoved`).
- Audit log redaction: no secrets, PII, raw UUIDs, or DOM selectors in
  logs. HA mode elevates severity (`info`→`warn`, `warn`→`security`).

## Security Notes

- Core files unchanged: `committer.ts`, `hardening.ts`, `mutationGuard.ts`,
  `originPolicy.ts`, `haMode.ts`.
- No new runtime dependencies added.
- Adapter is a leaf module with zero reverse dependencies.

## Known Issues

- 32 pre-existing test failures in quarantine (unrelated to WebMCP).
  Run `npm run test:quarantine` to inspect. Tracked for follow-up.
- `OverlaySession.origin` type uses `'quickselect'` placeholder for
  WebMCP sessions; cosmetic fix deferred.
