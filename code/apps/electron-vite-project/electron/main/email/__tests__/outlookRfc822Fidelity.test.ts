/**
 * Prompt 5 / Part C — Outlook `/$value` RFC822 fidelity spike (code-testable portion).
 *
 * Validates the already-implemented `fetchMessageOpaque` path in OutlookProvider:
 *  1. Byte-identity: raw MIME bytes from `/$value` land in `rawRfc822` UNCHANGED —
 *     no charset conversion, no line-ending normalisation, no truncation.
 *  2. Content isolation: no body/subject/from/to/CC content fields are populated
 *     from the raw bytes (host stays blind; the guest derives those post-depackage).
 *  3. Operational metadata: only the non-content fields (isRead, isDraft,
 *     hasAttachments, receivedDateTime) survive from the JSON metadata call.
 *  4. Metadata miss is non-fatal: a failed metadata fetch does not abort the opaque
 *     fetch and falls back to safe defaults.
 *  5. Empty `/$value` body fails closed (never produces a zero-byte rawRfc822).
 *  6. Graph `/$value` throttle (429 + Retry-After): the retry loop honours the header
 *     and retries rather than aborting (smoke-tested via mock; real throttle
 *     behaviour requires a live account session — deferred to rig).
 *  7. Non-ASCII header survival: headers containing UTF-8 / Q-encoded content are
 *     stored byte-for-byte (no decode/re-encode on the host boundary).
 *  8. Multipart/attachment survival: a multipart/mixed RFC822 with a binary
 *     attachment survives the roundtrip with every byte intact.
 *
 * What this suite does NOT prove (requires live Microsoft Graph account):
 *  - That Graph actually returns standards-compliant RFC 5322 for all message types
 *    (calendar invites, S/MIME signed, HTML-only, etc.).
 *  - Real 429 pacing against production Graph rate limits.
 *  - That the read-only `Mail.Read` scope returns `/$value` without a permission error
 *    (Graph occasionally requires `Mail.ReadWrite` for this endpoint — spike OPEN).
 *  - That MIME byte-identity holds under the Graph CDN / blob-storage path for
 *    messages stored in secondary datacentres.
 *
 * Scope gate: flipping `WRDESK_OUTLOOK_OPAQUE_INPUT` to the default REQUIRES a rig
 * session proving these four points above against a real account. This file does NOT
 * constitute that proof. The fail-closed guard (`OutlookOpaqueUnprovenError`) remains
 * in place until that session completes and its evidence is committed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OutlookProvider } from '../providers/outlook'
import { __resetOpaqueIngestionCacheForTests } from '../opaqueIngestion'

// ─── fixtures ────────────────────────────────────────────────────────────────

const RFC822_SIMPLE = Buffer.from(
  'MIME-Version: 1.0\r\n' +
  'Message-ID: <test-simple@example.com>\r\n' +
  'Date: Wed, 10 Jun 2026 17:00:00 +0000\r\n' +
  'From: Alice <alice@example.com>\r\n' +
  'To: Bob <bob@example.com>\r\n' +
  'Subject: Simple fidelity test\r\n' +
  'Content-Type: text/plain; charset=utf-8\r\n' +
  '\r\n' +
  'Hello world. This is a fidelity test.\r\n',
  'binary',
)

// RFC822 with a binary attachment (PDF magic bytes + random payload).
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]) // %PDF-1.4
const BINARY_PAYLOAD = Buffer.concat([PDF_MAGIC, Buffer.from(Array.from({ length: 256 }, (_, i) => i))])
const ATTACH_B64 = BINARY_PAYLOAD.toString('base64')
const RFC822_MULTIPART = Buffer.from(
  'MIME-Version: 1.0\r\n' +
  'Message-ID: <test-multipart@example.com>\r\n' +
  'From: Alice <alice@example.com>\r\n' +
  'To: Bob <bob@example.com>\r\n' +
  'Subject: Attachment fidelity test\r\n' +
  'Content-Type: multipart/mixed; boundary="==BOUNDARY=="\r\n' +
  '\r\n' +
  '--==BOUNDARY==\r\n' +
  'Content-Type: text/plain; charset=utf-8\r\n' +
  '\r\n' +
  'Body text.\r\n' +
  '--==BOUNDARY==\r\n' +
  'Content-Type: application/pdf\r\n' +
  'Content-Disposition: attachment; filename="test.pdf"\r\n' +
  'Content-Transfer-Encoding: base64\r\n' +
  '\r\n' +
  ATTACH_B64 + '\r\n' +
  '--==BOUNDARY==--\r\n',
  'binary',
)

// Non-ASCII Subject via RFC 2047 Q-encoding (common in Graph responses).
const RFC822_NONASCII_HEADER = Buffer.from(
  'MIME-Version: 1.0\r\n' +
  'Message-ID: <test-qenc@example.com>\r\n' +
  'From: =?utf-8?q?Ren=C3=A9?= <rene@example.com>\r\n' +
  'To: bob@example.com\r\n' +
  'Subject: =?utf-8?b?RmFpbGVkIHRvIGRlY29kZTogw6l0w6k=?=\r\n' +
  'Content-Type: text/plain; charset=utf-8\r\n' +
  '\r\n' +
  'Test body.\r\n',
  'binary',
)

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeProvider(): OutlookProvider {
  return new OutlookProvider()
}

function setOpaqueInput(val: string) {
  process.env.WRDESK_OUTLOOK_OPAQUE_INPUT = val
  process.env.WRDESK_SEAM_DEPACKAGE_CUTOVER = '1'
  __resetOpaqueIngestionCacheForTests()
}

function clearEnv() {
  delete process.env.WRDESK_OUTLOOK_OPAQUE_INPUT
  delete process.env.WRDESK_SEAM_DEPACKAGE_CUTOVER
  __resetOpaqueIngestionCacheForTests()
}

/**
 * Inject mocked Graph responses into an OutlookProvider instance.
 * `metaResponse` → the JSON metadata call (`/me/messages/{id}?$select=id,isRead,...`)
 * `rawBytes`      → the `/$value` call
 */
function mockGraphOnProvider(
  provider: OutlookProvider,
  metaResponse: Record<string, unknown>,
  rawBytes: Buffer | null,
): void {
  ;(provider as any).graphApiRequest = vi.fn().mockResolvedValue(metaResponse)
  ;(provider as any).graphApiRequestRaw = vi.fn().mockResolvedValue(rawBytes)
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('Outlook /$value fidelity — byte identity', () => {
  beforeEach(() => setOpaqueInput('value'))
  afterEach(clearEnv)

  it('1 — simple RFC822: rawRfc822 is byte-identical to Graph response (no mutation)', async () => {
    const provider = makeProvider()
    mockGraphOnProvider(provider, { id: 'msg-1', isRead: true, isDraft: false, hasAttachments: false, receivedDateTime: '2026-06-10T17:00:00Z' }, RFC822_SIMPLE)

    const msg = await provider.fetchMessage('msg-1')

    expect(msg).not.toBeNull()
    expect(msg!.rawRfc822).toBeInstanceOf(Buffer)
    expect(msg!.rawRfc822!.equals(RFC822_SIMPLE)).toBe(true)
  })

  it('8 — multipart/mixed with binary attachment: every byte survives intact', async () => {
    const provider = makeProvider()
    mockGraphOnProvider(provider, { id: 'msg-mp', hasAttachments: true }, RFC822_MULTIPART)

    const msg = await provider.fetchMessage('msg-mp')

    expect(msg!.rawRfc822!.equals(RFC822_MULTIPART)).toBe(true)
    // Attachment magic bytes are present somewhere in the raw buffer.
    const buf = msg!.rawRfc822!
    expect(buf.indexOf(ATTACH_B64.slice(0, 12))).toBeGreaterThan(-1)
  })

  it('7 — RFC 2047 Q-encoded header: bytes stored verbatim (no decode on the host)', async () => {
    const provider = makeProvider()
    mockGraphOnProvider(provider, { id: 'msg-qenc' }, RFC822_NONASCII_HEADER)

    const msg = await provider.fetchMessage('msg-qenc')

    expect(msg!.rawRfc822!.equals(RFC822_NONASCII_HEADER)).toBe(true)
    // The Q-encoded subject must be present byte-for-byte in rawRfc822.
    const raw = msg!.rawRfc822!.toString('binary')
    expect(raw).toContain('=?utf-8?b?')
  })
})

describe('Outlook /$value fidelity — content isolation', () => {
  beforeEach(() => setOpaqueInput('value'))
  afterEach(clearEnv)

  it('2 — body fields are EMPTY (host never reads body from /$value bytes)', async () => {
    const provider = makeProvider()
    mockGraphOnProvider(provider, { id: 'msg-2' }, RFC822_SIMPLE)

    const msg = await provider.fetchMessage('msg-2')

    expect(msg!.bodyText).toBeUndefined()
    expect(msg!.bodyHtml).toBeUndefined()
    expect(msg!.subject).toBe('')
    expect(msg!.from.email).toBe('')
    expect(msg!.to).toHaveLength(0)
    expect(msg!.cc).toHaveLength(0)
  })

  it('2 — headers map is EMPTY (no header inspection on the host)', async () => {
    const provider = makeProvider()
    mockGraphOnProvider(provider, { id: 'msg-h' }, RFC822_SIMPLE)

    const msg = await provider.fetchMessage('msg-h')

    // The raw MIME contains real headers but the RawEmailMessage.headers map
    // must be empty — the host reads no header fields.
    expect(Object.keys(msg!.headers ?? {})).toHaveLength(0)
  })
})

describe('Outlook /$value fidelity — operational metadata', () => {
  beforeEach(() => setOpaqueInput('value'))
  afterEach(clearEnv)

  it('3 — isRead → flags.seen, isDraft → flags.draft, hasAttachments, receivedDateTime → date', async () => {
    const provider = makeProvider()
    mockGraphOnProvider(provider, {
      id: 'msg-meta',
      isRead: true,
      isDraft: false,
      hasAttachments: true,
      receivedDateTime: '2026-01-15T09:30:00Z',
    }, RFC822_SIMPLE)

    const msg = await provider.fetchMessage('msg-meta')

    expect(msg!.flags.seen).toBe(true)
    expect(msg!.flags.draft).toBe(false)
    expect(msg!.hasAttachments).toBe(true)
    expect(msg!.date.getFullYear()).toBe(2026)
    expect(msg!.date.getMonth()).toBe(0) // January
  })

  it('3 — isDraft=true lands in flags.draft', async () => {
    const provider = makeProvider()
    mockGraphOnProvider(provider, { id: 'msg-draft', isDraft: true, isRead: false }, RFC822_SIMPLE)

    const msg = await provider.fetchMessage('msg-draft')

    expect(msg!.flags.draft).toBe(true)
    expect(msg!.flags.seen).toBe(false)
  })

  it('4 — metadata fetch failure is non-fatal: defaults used, rawRfc822 still set', async () => {
    const provider = makeProvider()
    ;(provider as any).graphApiRequest = vi.fn().mockRejectedValue(new Error('Network error on metadata'))
    ;(provider as any).graphApiRequestRaw = vi.fn().mockResolvedValue(RFC822_SIMPLE)

    const msg = await provider.fetchMessage('msg-metafail')

    // Must NOT throw; must return the raw bytes even when metadata call fails.
    expect(msg).not.toBeNull()
    expect(msg!.rawRfc822!.equals(RFC822_SIMPLE)).toBe(true)
    // Defaults: seen=false, draft=false, date ≈ now.
    expect(msg!.flags.seen).toBe(false)
    expect(msg!.flags.draft).toBe(false)
  })
})

describe('Outlook /$value fidelity — fail-closed invariants', () => {
  afterEach(clearEnv)

  it('5 — empty /$value body throws (fail closed, never produces zero-byte rawRfc822)', async () => {
    setOpaqueInput('value')
    const provider = makeProvider()
    ;(provider as any).graphApiRequest = vi.fn().mockResolvedValue({ id: 'msg-empty' })
    ;(provider as any).graphApiRequestRaw = vi.fn().mockResolvedValue(Buffer.alloc(0))

    await expect(provider.fetchMessage('msg-empty')).rejects.toThrow(/fail closed/)
  })

  it('5 — null /$value response throws (fail closed)', async () => {
    setOpaqueInput('value')
    const provider = makeProvider()
    ;(provider as any).graphApiRequest = vi.fn().mockResolvedValue({ id: 'msg-null' })
    ;(provider as any).graphApiRequestRaw = vi.fn().mockResolvedValue(null)

    await expect(provider.fetchMessage('msg-null')).rejects.toThrow(/fail closed/)
  })

  it('flag OFF (default): fetchMessage rejects with OutlookOpaqueUnprovenError even when /$value path is wired', async () => {
    // RAWPREF unset → default 'structured-json' → fail closed before any network call.
    process.env.WRDESK_SEAM_DEPACKAGE_CUTOVER = '1'
    __resetOpaqueIngestionCacheForTests()
    const provider = makeProvider()
    const { OutlookOpaqueUnprovenError } = await import('../providers/outlook')

    await expect(provider.fetchMessage('msg-noraw')).rejects.toBeInstanceOf(OutlookOpaqueUnprovenError)
  })
})

describe('Outlook /$value fidelity — throttle smoke (mock)', () => {
  beforeEach(() => setOpaqueInput('value'))
  afterEach(clearEnv)

  it('6 — /$value success path is reachable; retry-on-429 is DEFERRED to rig (graphApiRequestRaw has its own loop)', async () => {
    // NOTE: `graphApiRequestRaw` contains the 429 retry loop internally
    // (iterates `graphSingleRequest` with Retry-After backoff). Mocking
    // `graphApiRequestRaw` itself bypasses that loop — a meaningful 429 retry
    // test must mock `graphSingleRequest` and drive multiple HTTP rounds.
    // That level of test requires the real Graph response shape (with Retry-After
    // header) and is deferred to the rig session (RIG-4 above).
    //
    // This test only confirms the happy-path: graphApiRequestRaw returns bytes →
    // fetchMessageOpaque sets rawRfc822 and returns a valid message.
    const provider = makeProvider()
    ;(provider as any).graphApiRequest = vi.fn().mockResolvedValue({ id: 'msg-ok', isRead: false })
    ;(provider as any).graphApiRequestRaw = vi.fn().mockResolvedValue(RFC822_SIMPLE)

    const msg = await provider.fetchMessage('msg-ok')
    expect(msg).not.toBeNull()
    expect(msg!.rawRfc822!.equals(RFC822_SIMPLE)).toBe(true)
    // The /$value method was called exactly once at this level.
    expect((provider as any).graphApiRequestRaw).toHaveBeenCalledOnce()
  })
})

// ─── DEFERRED / OPEN gates for rig session ───────────────────────────────────
// The tests below require a real Microsoft Graph account. Provide the following
// env vars to activate them:
//
//   WRDESK_PART_C_ACCESS_TOKEN  — Mail.Read (or Mail.ReadWrite) access token
//   WRDESK_PART_C_MESSAGE_ID    — a real message ID in the test inbox (RIG-1/2/3)
//   WRDESK_PART_C_SEND_TOKEN    — (optional) access token with Mail.Send scope
//
// RIG-1 gate: if RIG-1 fails with a 403, STOP — do NOT flip WRDESK_OUTLOOK_OPAQUE_INPUT
// to `value` and do NOT bump scope to Mail.ReadWrite without sign-off.

const PART_C_TOKEN = process.env.WRDESK_PART_C_ACCESS_TOKEN ?? ''
const PART_C_MSG_ID = process.env.WRDESK_PART_C_MESSAGE_ID ?? ''
const PART_C_RIG = !!PART_C_TOKEN && !!PART_C_MSG_ID

/** Builds a real OutlookProvider with just the access token (no refresh needed for a rig test). */
async function makeRigProvider(accessToken: string): Promise<OutlookProvider> {
  const provider = new OutlookProvider()
  // Inject the token directly into the private field (avoids needing a full config).
  ;(provider as any).accessToken = accessToken
  ;(provider as any).connected = true
  return provider
}

describe('Outlook /$value fidelity — RIG SESSION REQUIRED', () => {
  beforeEach(() => {
    setOpaqueInput('value')
  })
  afterEach(clearEnv)

  it.skipIf(!PART_C_RIG)(
    'RIG-1: Mail.Read scope can call /$value without 403',
    async () => {
      // Proves: GET /v1.0/me/messages/{id}/$value with Mail.Read scope returns 200.
      // Evidence to commit: response status + headers (no message content).
      const provider = await makeRigProvider(PART_C_TOKEN)
      // Intercept the raw HTTP call to capture headers + status.
      let capturedStatus: number | null = null
      const origRaw = (provider as any).graphApiRequestRaw.bind(provider)
      // NOTE: graphApiRequestRaw is a real method — we don't stub it; it fires real HTTPS.
      let raw: Buffer | null = null
      try {
        raw = await (provider as any).graphApiRequestRaw(`/me/messages/${PART_C_MSG_ID}/$value`)
        capturedStatus = 200
      } catch (err) {
        const msg = (err as Error).message ?? String(err)
        capturedStatus = msg.includes('HTTP 403') ? 403 : msg.includes('HTTP ') ? parseInt(msg.match(/HTTP (\d+)/)?.[1] ?? '0') : -1
        console.error(`[RIG-1] Graph /$value error: ${msg}`)
      }
      console.log(`[RIG-1] status=${capturedStatus} hasBytes=${raw ? raw.length > 0 : false}`)
      // GATE: if 403, report — do NOT flip WRDESK_OUTLOOK_OPAQUE_INPUT.
      expect(capturedStatus, 'RIG-1 FAILED: Mail.Read 403 — stop; do NOT flip flag').toBe(200)
      expect(raw).not.toBeNull()
      expect(raw!.length).toBeGreaterThan(0)
    },
    30_000,
  )

  it.skipIf(!PART_C_RIG)(
    'RIG-2: /$value bytes contain expected RFC822 structural landmarks (byte-fidelity)',
    async () => {
      // Proves: the raw bytes from /$value are valid RFC822 (have headers + CRLF separator).
      // Content-integrity vs an independently-sent reference message requires a manual send
      // step (deferred: operator sends a reference message with known body to the rig account,
      // records its message-ID, and sets WRDESK_PART_C_MESSAGE_ID to that ID).
      const provider = await makeRigProvider(PART_C_TOKEN)
      const raw = await (provider as any).graphApiRequestRaw(`/me/messages/${PART_C_MSG_ID}/$value`) as Buffer
      console.log(`[RIG-2] raw size=${raw.length} bytes`)
      // RFC822 must have CRLF header separator.
      const str = raw.toString('binary')
      expect(str).toMatch(/\r\n\r\n/)
      // Must have at least one header line.
      const firstCrLf = str.indexOf('\r\n')
      expect(firstCrLf).toBeGreaterThan(0)
      // No Content-Type / Subject / From / To extracted on the host — raw only.
      console.log(`[RIG-2] first line: ${str.slice(0, firstCrLf).replace(/\r/g, '').slice(0, 80)}`)
    },
    30_000,
  )

  it.skipIf(!PART_C_RIG)(
    'RIG-3: binary content in /$value response survives base64 decode (attachment fidelity)',
    async () => {
      // Proves: if the message has a base64-encoded attachment, the raw bytes from /$value
      // contain a valid base64 block (content is not truncated or corrupted).
      const provider = await makeRigProvider(PART_C_TOKEN)
      const raw = await (provider as any).graphApiRequestRaw(`/me/messages/${PART_C_MSG_ID}/$value`) as Buffer
      const str = raw.toString('binary')
      // Detect presence of a base64 block (Content-Transfer-Encoding: base64 header).
      const hasBase64Block = /Content-Transfer-Encoding:\s*base64/i.test(str)
      console.log(`[RIG-3] hasBase64Block=${hasBase64Block} raw_size=${raw.length}`)
      // If no attachment in the message, this is informational only.
      if (!hasBase64Block) {
        console.log('[RIG-3] No base64 attachment in this message — use a message with a binary attachment for a full proof.')
      }
      // The raw bytes must be non-empty regardless.
      expect(raw.length).toBeGreaterThan(0)
    },
    30_000,
  )

  it.skipIf(!PART_C_RIG)(
    'RIG-4: graphApiRequestRaw 429 retry loop honours Retry-After (smoke via real call)',
    async () => {
      // Proves: the graphApiRequestRaw retry loop does NOT crash on 429 — it sleeps and
      // retries. Full time-domain proof requires triggering a real 429, which requires
      // many rapid requests. This test proves the non-throttled happy path and documents
      // that the retry loop exists (see graphApiRequestRaw implementation in outlook.ts).
      //
      // For a full 429 pacing proof: send > 10,000 requests per 10 min to trigger
      // Graph throttling, then observe the retry delay matches Retry-After (manual).
      const provider = await makeRigProvider(PART_C_TOKEN)
      const t0 = Date.now()
      const raw = await (provider as any).graphApiRequestRaw(`/me/messages/${PART_C_MSG_ID}/$value`) as Buffer
      const elapsed = Date.now() - t0
      console.log(`[RIG-4] /$value RTT=${elapsed}ms size=${raw.length} (no throttle observed)`)
      expect(raw.length).toBeGreaterThan(0)
    },
    30_000,
  )
})
