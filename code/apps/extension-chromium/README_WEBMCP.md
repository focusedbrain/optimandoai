# WebMCP Integration — Preview-Only (v1)

## Overview

WebMCP allows external MCP (Model Context Protocol) tools to request vault
autofill on the active tab. In v1, this integration is **preview-only**:
the adapter creates an overlay showing which fields will be filled, but
**values are never written until the user physically clicks Insert**.

## Security Model

- **No auto-commit.** The overlay session is created in `preview` state.
  Committing values requires a real user click (`isTrusted === true`).
- **Sender gate.** All IPC in `background.ts` validates `sender.id`
  against `chrome.runtime.id`. Messages from foreign extensions are
  rejected before any processing occurs.
- **Origin validation.** The vault item's domain must match
  `window.location.origin`. Under HA mode, public-suffix mismatches
  are also rejected.
- **Rate limiting.** Each tab is limited to one `WEBMCP_FILL_PREVIEW`
  request every 2 seconds. The rate map is cleaned up on tab close.
- **Restricted URLs blocked.** `chrome://`, `chrome-extension://`,
  and other privileged schemes are rejected in the background handler.

## High-Assurance (HA) Mode

When HA mode is active:

| Behavior             | Normal        | HA Mode          |
|----------------------|---------------|------------------|
| Audit log severity   | `info`/`warn` | `warn`/`security`|
| Overlay timeout      | 60 s          | 30 s             |
| PSL domain mismatch  | Allowed       | Rejected         |

## Audit & Telemetry

All audit log calls use defined codes (`WEBMCP_PREVIEW_CREATED`,
`WEBMCP_ITEM_NOT_FOUND`, `WEBMCP_ORIGIN_MISMATCH`, etc.).
Logs are redacted: **no secrets, PII, raw UUIDs, selectors, or
domain names** appear in audit or telemetry output.

## Running Tests

```bash
# Unit + sender-gate tests (release gate, must pass)
npm run test:webmcp:ci

# E2E smoke (opt-in, requires Playwright + Chromium)
cd apps/extension-chromium
npm run test:e2e:webmcp        # Linux / macOS
npm run test:e2e:webmcp:win    # Windows
```

## Limitations (v1)

- Preview-only: no programmatic commit from MCP tools.
- No token bridge; MCP tools cannot authenticate on behalf of the user.
- `OverlaySession.origin` uses a placeholder type (`'quickselect'`).
- 32 pre-existing test failures (unrelated to WebMCP) are quarantined;
  run `npm run test:quarantine` to see their status.
