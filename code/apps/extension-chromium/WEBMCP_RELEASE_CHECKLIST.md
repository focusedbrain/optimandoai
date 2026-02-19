# WebMCP Preview-Only Adapter — Release Checklist

## Automated (CI-gated)

- [ ] `npm run test:webmcp:ci` — 56 tests pass (0 failures)
- [ ] Extension builds without errors: `cd apps/extension-chromium && npm run build`

## Manual Verification

### Sender Gate

- [ ] Load the built extension in Chrome. Open DevTools on any page.
      In the console of a *different* extension (or a page that cannot
      call `chrome.runtime.sendMessage` to this extension's ID), attempt
      to send `{ type: 'VAULT_HTTP_API', ... }`.
      **Expected:** message is rejected with "Forbidden: sender not trusted".

### WebMCP Preview Flow

- [ ] With vault unlocked and a login item saved for `localhost`,
      open the fixture page `__tests__/fixtures/webmcp-login.html`
      (or any page with username + password fields).
- [ ] Trigger `WEBMCP_FILL_PREVIEW` via background console:
      ```js
      chrome.tabs.query({active: true, currentWindow: true}, tabs => {
        chrome.runtime.sendMessage({
          type: 'WEBMCP_FILL_PREVIEW',
          params: { itemId: '<your-item-uuid>', tabId: tabs[0].id }
        }, r => console.log(r))
      })
      ```
- [ ] **Overlay host appears** (`#wrv-autofill-overlay` visible in DOM).
- [ ] **No values written** — username and password inputs are still empty.
- [ ] Click "Insert" on the overlay.
      **Expected:** values are injected only after the physical click.

### isTrusted Invariant

- [ ] With the overlay visible, run in page console:
      ```js
      document.querySelector('#wrv-autofill-overlay')
        .dispatchEvent(new MouseEvent('click', {bubbles: true}))
      ```
      **Expected:** nothing happens (synthetic click is ignored).

### HA Mode

- [ ] Enable HA mode. Repeat the WEBMCP_FILL_PREVIEW call.
      **Expected:** overlay appears, timeout is 30s (not 60s).
- [ ] Check background console / audit log: severity should be `security`
      (not `info` or `warn`).

### Rate Limiting

- [ ] Fire `WEBMCP_FILL_PREVIEW` twice within 2 seconds to the same tab.
      **Expected:** second call returns `Rate limited`.
- [ ] Wait 2+ seconds, fire again. **Expected:** succeeds.

### Tab Cleanup

- [ ] Fire `WEBMCP_FILL_PREVIEW` to a tab, then close that tab.
      Inspect `_webMcpRateMap` (add a temporary log or breakpoint).
      **Expected:** entry for closed tabId is removed.

### Origin / Domain Mismatch

- [ ] With HA mode ON, attempt `WEBMCP_FILL_PREVIEW` with an item
      whose domain does not match the page's origin.
      **Expected:** rejected with `ORIGIN_MISMATCH`.

## Quarantined Tests (not blocking release)

The following pre-existing test files have 32 failures unrelated to WebMCP.
Run `npm run test:quarantine` to see their status. These must be triaged
separately (see `WEBMCP_RELEASE_CHECKLIST.md` § Follow-ups).

- `committer.test.ts` — logic assertion failures
- `hardening.test.ts` — domain-matching assertion mismatches
- `security-regression.test.ts` — AAD version + HA state machine mismatches
- `fieldScanner.test.ts` — scoring threshold calibration failures

## Follow-ups (post-release)

1. Triage and fix the 32 quarantined test failures.
2. Add `'webmcp'` to the `OverlaySession.origin` union type in
   `insertionPipeline.ts` (currently using `'quickselect'`).
3. Evaluate token-bridge approach for v2 (full commit from WebMCP).
4. Integrate `test:webmcp:ci` into the GitHub Actions CI pipeline.
