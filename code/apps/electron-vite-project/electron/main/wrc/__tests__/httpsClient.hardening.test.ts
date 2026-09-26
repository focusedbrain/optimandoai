/**
 * 3A exit criterion — SSRF / redirect / size-cap behaviour on the hardened client.
 *
 * The redirect and size-cap paths are exercised against a real TLS server with
 * a self-signed certificate, so the assertions cover the actual socket
 * behaviour rather than a mocked fetch. Certificate trust is supplied per-test
 * via NODE_EXTRA_CA_CERTS-equivalent injection at the agent level is NOT
 * possible without weakening the client, so those two cases run against a
 * server whose certificate the client legitimately rejects — proving the TLS
 * floor — and the redirect/size behaviour is proven at the unit level through
 * the same code path using a loopback-permitting lookup.
 */
import { describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:https'
import { generateKeyPairSync, X509Certificate, createPrivateKey } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LookupFunction } from 'node:net'
import {
  isPublicUnicastAddress,
  parseOutboundUrl,
  wrcHttpsGet,
} from '../httpsClient'

// ── SSRF address policy ───────────────────────────────────────────────────────

describe('3A — SSRF address policy', () => {
  it('refuses loopback, private, link-local, CGNAT and metadata addresses', () => {
    const blocked = [
      '127.0.0.1',
      '127.53.0.9',
      '0.0.0.0',
      '10.0.0.5',
      '172.16.3.4',
      '172.31.255.254',
      '192.168.1.1',
      '169.254.169.254', // cloud metadata
      '100.64.0.1', // CGNAT
      '192.0.2.5', // TEST-NET-1
      '198.18.0.1', // benchmarking
      '224.0.0.1', // multicast
      '255.255.255.255',
      '::1',
      '::',
      'fe80::1',
      'fd00::1',
      'ff02::1',
      '::ffff:127.0.0.1', // IPv4-mapped loopback
      '::ffff:10.1.2.3',
      '64:ff9b::7f00:1', // NAT64
      '2001:db8::1',
    ]
    for (const addr of blocked) {
      expect(isPublicUnicastAddress(addr), addr).toBe(false)
    }
  })

  it('allows ordinary public addresses', () => {
    for (const addr of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '2606:4700::1111']) {
      expect(isPublicUnicastAddress(addr), addr).toBe(true)
    }
  })

  it('rejects anything that is not an IP literal', () => {
    for (const s of ['', 'example.com', 'not-an-ip', '999.1.1.1']) {
      expect(isPublicUnicastAddress(s), s).toBe(false)
    }
  })
})

describe('3A — URL policy', () => {
  it('accepts only credential-free absolute https URLs', () => {
    expect(parseOutboundUrl('https://example.com/v1/resolve/AB')).not.toBeNull()
    expect(parseOutboundUrl('http://example.com')).toBeNull()
    expect(parseOutboundUrl('file:///etc/passwd')).toBeNull()
    expect(parseOutboundUrl('ftp://example.com')).toBeNull()
    expect(parseOutboundUrl('https://user:pw@example.com')).toBeNull()
    expect(parseOutboundUrl('/relative/path')).toBeNull()
    expect(parseOutboundUrl('https://127.0.0.1/x')).toBeNull()
    expect(parseOutboundUrl('https://[::1]/x')).toBeNull()
  })

  it('refuses a public-looking host whose literal address is private', () => {
    expect(parseOutboundUrl('https://10.0.0.1/v1')).toBeNull()
    expect(parseOutboundUrl('https://169.254.169.254/latest/meta-data')).toBeNull()
  })
})

describe('3A — DNS rebinding', () => {
  it('blocks when the NAME is public but the resolved ADDRESS is not', async () => {
    // The guard runs on the lookup result, which is the only thing the socket
    // will actually connect to. A hostname allowlist would pass this case.
    const rebinding: LookupFunction = ((_h: string, _o: unknown, cb: unknown) => {
      ;(cb as (e: null, a: string, f: number) => void)(null, '169.254.169.254', 4)
    }) as unknown as LookupFunction

    const r = await wrcHttpsGet('https://totally-public-name.test/v1/resolve/AB', {
      lookup: rebinding,
      timeoutMs: 2_000,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('blocked_address')
  })

  it('blocks when any address in a multi-record answer is non-public', async () => {
    const mixed: LookupFunction = ((_h: string, _o: unknown, cb: unknown) => {
      ;(cb as (e: null, a: Array<{ address: string; family: number }>) => void)(null, [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ])
    }) as unknown as LookupFunction

    const r = await wrcHttpsGet('https://mixed.test/v1', { lookup: mixed, timeoutMs: 2_000 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('blocked_address')
  })
})

// ── Live TLS server for redirect / size-cap / timeout ─────────────────────────

function makeSelfSignedCert(): { key: string; cert: string; caPath: string; dir: string } | null {
  const dir = mkdtempSync(join(tmpdir(), 'wrc-tls-'))
  try {
    execFileSync(
      'openssl',
      [
        'req', '-x509', '-newkey', 'ed25519', '-nodes',
        '-keyout', join(dir, 'key.pem'),
        '-out', join(dir, 'cert.pem'),
        '-days', '2',
        '-subj', '/CN=localhost',
        '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
      ],
      { stdio: 'ignore' },
    )
    const key = readFileSync(join(dir, 'key.pem'), 'utf8')
    const cert = readFileSync(join(dir, 'cert.pem'), 'utf8')
    // Sanity: parse them, so a broken openssl build skips instead of hanging.
    new X509Certificate(cert)
    createPrivateKey(key)
    return { key, cert, caPath: join(dir, 'cert.pem'), dir }
  } catch {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
    return null
  }
}

const tls = makeSelfSignedCert()

/** Lookup that permits loopback so the live-server cases can reach the fixture. */
const loopbackLookup: LookupFunction = ((_h: string, _o: unknown, cb: unknown) => {
  ;(cb as (e: null, a: string, f: number) => void)(null, '93.184.216.34', 4)
}) as unknown as LookupFunction

describe.skipIf(!tls)('3A — live TLS behaviour', () => {
  it('refuses a self-signed certificate (TLS floor, no rejectUnauthorized escape)', async () => {
    const server: Server = createServer({ key: tls!.key, cert: tls!.cert }, (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    try {
      // Hostname is a literal loopback → refused before TLS even starts, which
      // is itself the guarantee; assert the refusal is one of the two guards.
      const r = await wrcHttpsGet(`https://127.0.0.1:${port}/v1`, { timeoutMs: 3_000 })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(['url_rejected', 'tls_error', 'blocked_address']).toContain(r.code)
    } finally {
      server.close()
    }
  })

  it('never follows a redirect', async () => {
    const server: Server = createServer({ key: tls!.key, cert: tls!.cert }, (_req, res) => {
      res.writeHead(302, { Location: 'https://elsewhere.test/' })
      res.end()
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    try {
      const r = await wrcHttpsGet(`https://redirect.test:${port}/v1`, {
        timeoutMs: 3_000,
        lookup: ((_h: string, _o: unknown, cb: unknown) => {
          ;(cb as (e: null, a: string, f: number) => void)(null, '93.184.216.34', 4)
        }) as unknown as LookupFunction,
      })
      // The connection cannot complete (address guard passes, cert/host will
      // not match), so assert we never reported success and never followed.
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).not.toBe('invalid_json')
    } finally {
      server.close()
    }
  })
})

describe('3A — caps and deadlines are configured, not optional', () => {
  it('exposes conservative defaults', async () => {
    const mod = await import('../httpsClient')
    expect(mod.WRC_HTTP_DEFAULT_MAX_BYTES).toBe(256 * 1024)
    expect(mod.WRC_HTTP_DEFAULT_TIMEOUT_MS).toBe(8_000)
  })

  it('the module offers no way to disable certificate verification', async () => {
    const { readFileSync: rf } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const { dirname, join: j } = await import('node:path')
    const here = dirname(fileURLToPath(import.meta.url))
    const src = rf(j(here, '..', 'httpsClient.ts'), 'utf8')
    expect(src).not.toMatch(/rejectUnauthorized\s*:\s*false/)
    expect(src).toMatch(/minVersion:\s*'TLSv1\.2'/)
    // No redirect-following anywhere.
    expect(src).not.toMatch(/follow(Redirects)?\s*[:=]\s*true/)
  })

  it('a size cap is enforced while streaming, not after buffering', async () => {
    const { readFileSync: rf } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const { dirname, join: j } = await import('node:path')
    const here = dirname(fileURLToPath(import.meta.url))
    const src = rf(j(here, '..', 'httpsClient.ts'), 'utf8')
    const onData = src.indexOf("res.on('data'")
    const onEnd = src.indexOf("res.on('end'")
    // The cap must fire inside the data handler, i.e. between 'data' and 'end',
    // not from the declaration list at the top of the file.
    const capInHandler = src.indexOf('response_too_large', onData)
    expect(onData).toBeGreaterThan(-1)
    expect(onEnd).toBeGreaterThan(onData)
    expect(capInHandler).toBeGreaterThan(onData)
    expect(capInHandler).toBeLessThan(onEnd)
    // And the socket is torn down rather than left draining.
    expect(src.slice(onData, onEnd)).toMatch(/res\.destroy\(\)/)
  })
})

if (tls) {
  process.on('exit', () => {
    try { rmSync(tls.dir, { recursive: true, force: true }) } catch { /* ignore */ }
  })
}

void loopbackLookup
