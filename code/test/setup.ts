/**
 * Global Vitest setup — runs before every test file in the workspace root run.
 *
 * B-8.4d-iii-5b changes:
 *   - CSS.escape polyfill: JSDOM does not implement CSS.escape; multiple
 *     autofill modules (fieldScanner, dvNlpBooster, dvSiteLearning) call
 *     CSS.escape(element.id) which crashes in the JSDOM environment.
 *   - window.innerHeight / innerWidth defaults: ensures the viewport
 *     dimensions are non-zero so guardElement's ELEMENT_OFFSCREEN check
 *     functions correctly in JSDOM.
 */

// ---------------------------------------------------------------------------
// CSS.escape polyfill
// See: https://drafts.csswg.org/cssom/#serialize-an-identifier
// ---------------------------------------------------------------------------
if (typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
  // @ts-ignore – CSS is not defined in the Node/JSDOM environment
  globalThis.CSS = {
    ...(typeof CSS !== 'undefined' ? CSS : {}),
    escape(value: string): string {
      const str = String(value)
      if (str.length === 0) return ''
      let result = ''
      const firstCodeUnit = str.charCodeAt(0)

      for (let i = 0; i < str.length; i++) {
        const codeUnit = str.charCodeAt(i)
        // Control chars (0x0000–0x001F and DEL 0x007F) → escape as \HHHHHH
        if (codeUnit === 0x0000) {
          result += '\uFFFD'
          continue
        }
        if ((codeUnit >= 0x0001 && codeUnit <= 0x001F) || codeUnit === 0x007F) {
          result += '\\' + codeUnit.toString(16) + ' '
          continue
        }
        // ASCII digits at start of string → escape numerically
        if (i === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) {
          result += '\\' + codeUnit.toString(16) + ' '
          continue
        }
        // Hyphen-minus at start if only char, OR followed by digit at pos 1
        if (i === 1 && firstCodeUnit === 0x002D &&
            (codeUnit >= 0x0030 && codeUnit <= 0x0039)) {
          result += '\\' + codeUnit.toString(16) + ' '
          continue
        }
        // Non-ASCII, alphanumeric, hyphen-minus, low-line → output as-is
        if (codeUnit >= 0x0080 ||
            codeUnit === 0x002D ||
            codeUnit === 0x005F ||
            (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
            (codeUnit >= 0x0041 && codeUnit <= 0x005A) ||
            (codeUnit >= 0x0061 && codeUnit <= 0x007A)) {
          result += str[i]
          continue
        }
        // Everything else → backslash-escape the character itself
        result += '\\' + str[i]
      }
      return result
    },
  }
}

// ---------------------------------------------------------------------------
// window.innerHeight / innerWidth defaults
// JSDOM defaults these to 0, which breaks guardElement's ELEMENT_OFFSCREEN
// check (any element with rect.bottom < 0 would still be "inside" a 0-height
// viewport). Set sensible defaults here; tests that need specific values can
// override locally.
// ---------------------------------------------------------------------------
if (typeof window !== 'undefined') {
  if (window.innerHeight === 0) {
    Object.defineProperty(window, 'innerHeight', { value: 768, writable: true, configurable: true })
  }
  if (window.innerWidth === 0) {
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true, configurable: true })
  }
}

// ── Electron main: GPU inference gate (Vitest defaults) ────────────────────
// Production must leave WRDESK_ALLOW_CPU_INFERENCE unset so Ollama calls require
// verified GPU offload. Tests default-on so fetch mocks do not hit nvidia-smi.
if (process.env.WRDESK_ALLOW_CPU_INFERENCE == null || process.env.WRDESK_ALLOW_CPU_INFERENCE === '') {
  process.env.WRDESK_ALLOW_CPU_INFERENCE = '1'
}

// ── Global mock pod server for ingestion tests (P1.12) ─────────────────────
// Since P1.12 the pod is the exclusive ingestion path.  Tests that call
// processIncomingInput() without spinning up a real pod will fail with
// "Pod connection failed" unless WR_POD_BASE_URL points at a mock server.
//
// This setup file provides a shared mock pod ingestor for ALL tests in the
// workspace. It implements the same logic as the real pod ingestor container
// (ingestInput → validateCapsule) and returns appropriate 200/422 responses.
//
// Tests that need to exercise pod-unavailability can temporarily override
// WR_POD_BASE_URL in their own beforeEach / test body; the global beforeEach
// restores the shared mock URL before each test.
// ─────────────────────────────────────────────────────────────────────────────
import http from 'node:http'
import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest'

// Lazily imported so that tests not using ingestion-core don't pay the cost.
async function handlePodIngestRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== 'POST' || req.url !== '/ingest') {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
    return
  }

  const chunks: Buffer[] = []
  for await (const c of req as AsyncIterable<Buffer>) chunks.push(c)
  const raw = Buffer.concat(chunks).toString('utf8')

  let parsed: Record<string, unknown>
  try { parsed = JSON.parse(raw) as Record<string, unknown> }
  catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Invalid JSON in request body' }))
    return
  }

  const rawInput = {
    body: String(parsed['body'] ?? ''),
    mime_type: parsed['mime_type'] as string | undefined,
    headers: parsed['headers'] as Record<string, string> | undefined,
    filename: parsed['filename'] as string | undefined,
  }
  const sourceType = (parsed['source_type'] as string) ?? 'api'
  const transportMeta = {
    channel_id: parsed['channel_id'] as string | undefined,
    message_id: parsed['message_id'] as string | undefined,
    sender_address: parsed['sender_address'] as string | undefined,
    recipient_address: parsed['recipient_address'] as string | undefined,
  }

  const { ingestInput, validateCapsule } = await import('@repo/ingestion-core')

  let candidate: Awaited<ReturnType<typeof ingestInput>>
  try { candidate = ingestInput(rawInput, sourceType as any, transportMeta) }
  catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: String(err) }))
    return
  }

  const vr = validateCapsule(candidate)
  const body = vr.success
    ? JSON.stringify({ valid: true, needs_depackaging: vr.validated.capsule.capsule_type === 'message_package', validated: vr.validated })
    : JSON.stringify({ valid: false, reason: vr.reason, details: vr.details })

  res.writeHead(vr.success ? 200 : 422, {
    'Content-Type': 'application/json',
    'Content-Length': String(Buffer.byteLength(body)),
  })
  res.end(body)
}

let _globalMockPodServer: http.Server | null = null
let _globalMockPodUrl: string | null = null
// Snapshot of WR_POD_BASE_URL at the start of the test file (may be set by CI).
const _envPodUrlAtStartup = process.env['WR_POD_BASE_URL']

beforeAll(async () => {
  if (_envPodUrlAtStartup) return // CI already has a real pod running — skip mock

  _globalMockPodServer = http.createServer((req, res) => {
    handlePodIngestRequest(req, res).catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: String(err) }))
    })
  })
  await new Promise<void>((resolve, reject) => {
    _globalMockPodServer!.listen(0, '127.0.0.1', () => resolve())
    _globalMockPodServer!.once('error', reject)
  })
  const addr = _globalMockPodServer.address() as { port: number }
  _globalMockPodUrl = `http://127.0.0.1:${addr.port}`
})

afterAll(async () => {
  if (_globalMockPodServer) {
    await new Promise<void>((res) => _globalMockPodServer!.close(() => res()))
    _globalMockPodServer = null
  }
})

beforeEach(() => {
  // Only set if the test hasn't already set a URL (allows override for unavailability tests).
  if (_globalMockPodUrl && process.env['WR_POD_BASE_URL'] == null) {
    process.env['WR_POD_BASE_URL'] = _globalMockPodUrl
  }
})

afterEach(() => {
  // Restore: if the test modified WR_POD_BASE_URL and the global mock is running,
  // clear it so the next test's beforeEach can re-set it.
  if (_globalMockPodUrl && process.env['WR_POD_BASE_URL'] !== _globalMockPodUrl) {
    delete process.env['WR_POD_BASE_URL']
  }
  // If the test cleared it (delete), restore it for the next test.
  if (_globalMockPodUrl && process.env['WR_POD_BASE_URL'] == null) {
    // Do not restore here — beforeEach of the next test will set it.
  }
})
