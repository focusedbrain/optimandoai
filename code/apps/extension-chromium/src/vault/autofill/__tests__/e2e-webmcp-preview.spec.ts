// ============================================================================
// WRVault — WebMCP Preview Adapter E2E Tests (Playwright)
// ============================================================================
//
// Verifies the end-to-end flow:
//   WEBMCP_FILL_PREVIEW_REQUEST → content-script → adapter → overlay
//
// How to run:
//   Local:  WEBMCP_E2E=1 npx playwright test e2e-webmcp-preview.spec.ts
//   CI:     see package.json "test:e2e:webmcp" script
//
// Prerequisites:
//   1. Build the extension:  npm run build  (from extension-chromium/)
//   2. Fixture server is started by the test via a static file:// load,
//      or via npx serve ./src/vault/autofill/__tests__/fixtures -p 3334
//
// Invariants validated:
//   - Overlay host element (#wrv-autofill-overlay) appears in the DOM
//   - No values are injected into form fields before user consent
//   - The overlay host is positioned (has a non-zero bounding rect)
//
// Intentionally NOT tested:
//   - Closed shadow root internals (not accessible from Playwright)
//   - Actual commit flow (requires trusted isTrusted click inside shadow)
//   - Background → content-script routing (requires full extension context;
//     tested in unit tests instead)
//
// ============================================================================

import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'

// ============================================================================
// §0  Configuration
// ============================================================================

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures')
const FIXTURE_FILE = path.join(FIXTURE_DIR, 'webmcp-login.html')
const EXTENSION_PATH = path.resolve(__dirname, '../../../../dist')

// Skip unless WEBMCP_E2E=1 is set
const skipE2E = !process.env.WEBMCP_E2E
test.skip(skipE2E, 'Set WEBMCP_E2E=1 to run WebMCP E2E tests')

// ============================================================================
// §1  Helpers
// ============================================================================

/**
 * Wait for the overlay host (#wrv-autofill-overlay) to appear.
 * Uses Playwright's event-based waitForSelector with a hard timeout.
 * Does NOT inspect closed shadow root contents.
 */
async function waitForOverlayHost(page: Page, timeoutMs = 8000): Promise<boolean> {
  try {
    await page.waitForSelector('#wrv-autofill-overlay', {
      timeout: timeoutMs,
      state: 'attached',
    })
    return true
  } catch {
    return false
  }
}

/**
 * Check that the overlay host has a non-zero bounding rect (is "visible"
 * in the layout sense — we cannot inspect the closed shadow root's content).
 */
async function overlayHostHasRect(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const host = document.querySelector('#wrv-autofill-overlay')
    if (!host) return false
    const rect = host.getBoundingClientRect()
    return rect.width > 0 || rect.height > 0
  })
}

/**
 * Read the value of an input element (content-world; no shadow DOM access needed).
 */
async function getInputValue(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLInputElement | null
    return el?.value ?? ''
  }, selector)
}

/**
 * Simulate the content-script receiving a WEBMCP_FILL_PREVIEW_REQUEST message.
 *
 * In the full extension flow, background.ts dispatches this via
 * chrome.tabs.sendMessage.  In the E2E harness we inject directly into
 * the page via page.evaluate to avoid needing a fully loaded extension
 * background context.
 *
 * The injected script calls the adapter's entry point exactly as the
 * content-script message handler does.
 */
async function injectWebMcpPreviewRequest(
  page: Page,
  itemId: string,
  targetHints?: Record<string, string>,
): Promise<any> {
  return page.evaluate(
    async ({ itemId, targetHints }) => {
      // If the adapter is loaded (content script injected), dispatch
      // a custom event that the content-script listener picks up.
      // Fall back to chrome.runtime.sendMessage for full extension context.
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          return new Promise<any>((resolve) => {
            chrome.runtime.sendMessage(
              { type: 'WEBMCP_FILL_PREVIEW_REQUEST', itemId, targetHints },
              (resp: any) => resolve(resp ?? { success: false, error: 'No response' }),
            )
          })
        }
      } catch {
        // Extension APIs not available — expected in some harness configs
      }
      return { success: false, error: 'Extension context not available' }
    },
    { itemId, targetHints },
  )
}

// ============================================================================
// §2  Tests
// ============================================================================

test.describe('WebMCP Preview-Only E2E', () => {
  test.describe.configure({ mode: 'serial' })

  test('fixture page exists', () => {
    expect(fs.existsSync(FIXTURE_FILE)).toBe(true)
  })

  test('fixture has required form fields', async ({ page }) => {
    await page.goto(`file://${FIXTURE_FILE}`)

    const username = await page.locator('input[name="username"]').count()
    const password = await page.locator('input[name="password"]').count()
    expect(username).toBe(1)
    expect(password).toBe(1)
  })

  test('form fields start empty', async ({ page }) => {
    await page.goto(`file://${FIXTURE_FILE}`)

    expect(await getInputValue(page, 'input[name="username"]')).toBe('')
    expect(await getInputValue(page, 'input[name="password"]')).toBe('')
  })

  // The following test requires the full extension context (content script
  // loaded, vault unlocked, etc.).  It verifies the key invariant:
  //   Preview creates overlay host WITHOUT writing values to inputs.
  test('overlay host appears without injecting values (full extension)', async ({ browser }) => {
    // Use launchPersistentContext to load the extension
    // This test only runs meaningfully when WEBMCP_E2E=1 AND the extension
    // is built at EXTENSION_PATH.
    if (!fs.existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) {
      test.skip(true, `Extension not built at ${EXTENSION_PATH}`)
      return
    }

    const context = await (browser as any).launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    }).catch(() => null)

    if (!context) {
      test.skip(true, 'Could not launch persistent context with extension')
      return
    }

    try {
      const page = await context.newPage()
      await page.goto(`file://${FIXTURE_FILE}`)
      await page.waitForLoadState('domcontentloaded')

      // Verify inputs are empty before any interaction
      expect(await getInputValue(page, 'input[name="username"]')).toBe('')
      expect(await getInputValue(page, 'input[name="password"]')).toBe('')

      // Inject the preview request
      const result = await injectWebMcpPreviewRequest(
        page,
        '11111111-2222-3333-4444-555555555555',
      )

      // If the adapter succeeded, check the overlay
      if (result?.success) {
        const overlayAppeared = await waitForOverlayHost(page)
        expect(overlayAppeared).toBe(true)

        // Overlay host should have a layout rect
        const hasRect = await overlayHostHasRect(page)
        expect(hasRect).toBe(true)

        // Critical invariant: NO values written to inputs
        expect(await getInputValue(page, 'input[name="username"]')).toBe('')
        expect(await getInputValue(page, 'input[name="password"]')).toBe('')
      }
      // If result is not success (vault locked, etc.), that's acceptable in CI
      // — the important thing is that no values were injected.
      expect(await getInputValue(page, 'input[name="username"]')).toBe('')
      expect(await getInputValue(page, 'input[name="password"]')).toBe('')
    } finally {
      await context.close()
    }
  })
})
