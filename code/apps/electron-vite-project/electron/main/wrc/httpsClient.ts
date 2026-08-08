/**
 * Hardened outbound HTTPS client (build item 4 / 3A).
 *
 * The only outbound HTTP path the WRC resolution client may use. It exists
 * because every byte 3B fetches comes from a party we do not trust yet: the
 * registry is a claim, the publisher domain is attacker-influenced, and a
 * resolution request is an attacker-triggerable outbound call from inside the
 * user's machine. So this client is written to be boring and refusing.
 *
 * Guarantees, each enforced here rather than left to callers:
 *  - HTTPS only. `http:` and every other scheme is refused before a socket.
 *  - `redirect: 'error'` semantics — a 3xx is a failure, never followed. A
 *    followed redirect would re-open every check below against a new origin.
 *  - TLS floor of TLS 1.2. `rejectUnauthorized` is never weakened; there is no
 *    option to weaken it, so no call site can.
 *  - Hard total timeout covering connect + headers + body, not a per-socket
 *    idle timeout that a slow drip can hold open indefinitely.
 *  - Response-size cap enforced while streaming, so an unbounded body is
 *    destroyed instead of buffered.
 *  - SSRF guard at CONNECT time via a custom `lookup`: the resolved address is
 *    checked, not the hostname. Checking the name would be defeated by DNS
 *    rebinding; checking the address the socket will actually use is not.
 *  - JSON parsing is a hook, not an assumption: callers say what they expect
 *    and get a typed failure rather than a thrown SyntaxError.
 *
 * Deliberately NOT built on the `discovery.ts` skeleton unmodified, per the
 * order: that helper has a timeout, a cache and field validation, but it
 * follows redirects, has no size cap, no address guard, and no TLS floor. What
 * is reused is its shape — typed result objects instead of throws, explicit
 * error codes, validation before the value is handed back.
 */

import { request as httpsRequest, type RequestOptions } from 'node:https'
import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { isIP, type LookupFunction } from 'node:net'

// ── Result contract ───────────────────────────────────────────────────────────

export type WrcHttpErrorCode =
  /** Not an absolute https: URL, or it carries credentials / a non-default form we refuse. */
  | 'url_rejected'
  /** The name resolved to a loopback, link-local, private, or otherwise non-public address. */
  | 'blocked_address'
  /** A 3xx response. Never followed. */
  | 'redirect_refused'
  /** Total deadline exceeded (connect + headers + body). */
  | 'timeout'
  /** Body exceeded the byte cap; the socket was destroyed mid-stream. */
  | 'response_too_large'
  /** TLS handshake or certificate failure. */
  | 'tls_error'
  /** Reached the server, got a non-2xx, non-3xx status. */
  | 'http_status'
  /** Transport failure that is none of the above. */
  | 'network_error'
  /** Body was not the JSON the caller declared it expected. */
  | 'invalid_json'

export interface WrcHttpSuccess {
  ok: true
  status: number
  /** Raw body bytes, already known to be within the cap. */
  bytes: Buffer
  /** Present only when `expectJson` was set and parsing succeeded. */
  json?: unknown
}

export interface WrcHttpFailure {
  ok: false
  code: WrcHttpErrorCode
  message: string
  /** Present for `http_status`. */
  status?: number
}

export type WrcHttpResult = WrcHttpSuccess | WrcHttpFailure

// ── Defaults ──────────────────────────────────────────────────────────────────

/** Total deadline for a single request. Registry calls are interactive. */
export const WRC_HTTP_DEFAULT_TIMEOUT_MS = 8_000

/**
 * Default body cap. The largest object the contract defines is an EVP at
 * 64 KiB canonical; 256 KiB leaves room for envelopes and proofs without ever
 * approaching a size where buffering is a denial-of-service in itself.
 */
export const WRC_HTTP_DEFAULT_MAX_BYTES = 256 * 1024

export interface WrcHttpOptions {
  /** Total deadline in ms. Default {@link WRC_HTTP_DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number
  /** Body cap in bytes. Default {@link WRC_HTTP_DEFAULT_MAX_BYTES}. */
  maxBytes?: number
  /** `Accept` header. Default `application/json`. */
  accept?: string
  /** Parse the body as JSON and fail with `invalid_json` when it is not. */
  expectJson?: boolean
  /**
   * Address-family lookup override. Tests inject a resolver so SSRF behaviour
   * can be proven without real DNS. Production leaves this unset.
   */
  lookup?: LookupFunction
}

// ── SSRF address policy ───────────────────────────────────────────────────────

function ipv4IsPublic(addr: string): boolean {
  const p = addr.split('.').map((n) => Number(n))
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b] = p as [number, number, number, number]
  if (a === 0) return false // "this network"
  if (a === 10) return false // RFC1918
  if (a === 127) return false // loopback
  if (a === 169 && b === 254) return false // link-local incl. cloud metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return false // RFC1918
  if (a === 192 && b === 168) return false // RFC1918
  if (a === 192 && b === 0) return false // IETF protocol assignments / 192.0.0.0/24, 192.0.2.0/24
  if (a === 198 && (b === 18 || b === 19)) return false // benchmarking
  if (a === 198 && b === 51) return false // TEST-NET-2
  if (a === 203 && b === 0) return false // TEST-NET-3
  if (a === 100 && b >= 64 && b <= 127) return false // CGNAT
  if (a >= 224) return false // multicast, reserved, broadcast
  return true
}

function ipv6IsPublic(raw: string): boolean {
  const addr = raw.toLowerCase().split('%')[0] ?? ''
  if (addr === '::' || addr === '::1') return false // unspecified / loopback
  // IPv4-mapped and IPv4-compatible forms inherit the IPv4 verdict.
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped?.[1]) return ipv4IsPublic(mapped[1])
  if (/^::\d+\.\d+\.\d+\.\d+$/.test(addr)) return false
  if (addr.startsWith('fe8') || addr.startsWith('fe9') || addr.startsWith('fea') || addr.startsWith('feb')) {
    return false // link-local fe80::/10
  }
  if (addr.startsWith('fc') || addr.startsWith('fd')) return false // unique local fc00::/7
  if (addr.startsWith('ff')) return false // multicast
  if (addr.startsWith('2001:db8')) return false // documentation
  if (addr.startsWith('64:ff9b')) return false // NAT64 — reaches an IPv4 destination we did not vet
  return true
}

/**
 * True when the literal address is routable on the public internet.
 * Everything not positively recognised as public is refused: this is an
 * allowlist in spirit even though it reads as a set of exclusions, because the
 * two family branches both end in an explicit `true` only after the checks.
 */
export function isPublicUnicastAddress(addr: string): boolean {
  const family = isIP(addr)
  if (family === 4) return ipv4IsPublic(addr)
  if (family === 6) return ipv6IsPublic(addr)
  return false
}

/** Guarded `lookup` — refuses to hand the socket a non-public address. */
function guardedLookup(base: LookupFunction): LookupFunction {
  const fn = ((hostname: string, options: unknown, callback: unknown) => {
    const cb = (typeof options === 'function' ? options : callback) as (
      err: NodeJS.ErrnoException | null,
      address?: string | LookupAddress[],
      family?: number,
    ) => void
    const opts = (typeof options === 'function' ? {} : options) as Record<string, unknown>

    const inner = base as unknown as (
      h: string,
      o: unknown,
      c: (err: NodeJS.ErrnoException | null, address?: string | LookupAddress[], family?: number) => void,
    ) => void

    inner(hostname, opts, (err, address, family) => {
      if (err) {
        cb(err)
        return
      }
      const list: LookupAddress[] = Array.isArray(address)
        ? address
        : [{ address: String(address), family: Number(family ?? 0) }]
      const blocked = list.find((a) => !isPublicUnicastAddress(a.address))
      if (blocked || list.length === 0) {
        const e = new Error(
          `WRC_BLOCKED_ADDRESS: ${hostname} resolved to non-public address ${blocked?.address ?? '(none)'}`,
        ) as NodeJS.ErrnoException
        e.code = 'WRC_BLOCKED_ADDRESS'
        cb(e)
        return
      }
      if (Array.isArray(address)) cb(null, list)
      else cb(null, list[0]!.address, list[0]!.family)
    })
  }) as unknown as LookupFunction
  return fn
}

// ── URL policy ────────────────────────────────────────────────────────────────

/**
 * Accept only a plain absolute https URL. Credentials in the URL are refused
 * because they would be sent to whatever the name resolves to.
 */
export function parseOutboundUrl(raw: string): URL | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'https:') return null
  if (u.username || u.password) return null
  if (!u.hostname) return null
  // A literal non-public address is refused before DNS even runs.
  if (isIP(u.hostname) !== 0 && !isPublicUnicastAddress(u.hostname)) return null
  return u
}

// ── Request ───────────────────────────────────────────────────────────────────

/**
 * Perform one hardened GET. Never throws; every outcome is a typed result.
 *
 * There is no `followRedirects`, no `insecure`, and no `agent` parameter on
 * purpose: each would be a way for a future call site to opt out of one of the
 * guarantees above.
 */
export function wrcHttpsGet(url: string, options: WrcHttpOptions = {}): Promise<WrcHttpResult> {
  const timeoutMs = options.timeoutMs ?? WRC_HTTP_DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? WRC_HTTP_DEFAULT_MAX_BYTES
  const parsed = parseOutboundUrl(url)

  if (!parsed) {
    return Promise.resolve({
      ok: false,
      code: 'url_rejected',
      message: 'Only credential-free absolute https URLs to public addresses are allowed',
    })
  }

  return new Promise<WrcHttpResult>((resolve) => {
    let settled = false
    const finish = (r: WrcHttpResult) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      resolve(r)
    }

    const reqOptions: RequestOptions = {
      protocol: 'https:',
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      headers: {
        Accept: options.accept ?? 'application/json',
        'Accept-Encoding': 'identity',
        'User-Agent': 'WRDesk-WRC-Client/1.0',
      },
      // TLS floor. rejectUnauthorized is left at its secure default and is
      // intentionally not exposed as an option anywhere in this module.
      minVersion: 'TLSv1.2',
      lookup: guardedLookup(options.lookup ?? (dnsLookup as unknown as LookupFunction)),
    }

    const req = httpsRequest(reqOptions, (res) => {
      const status = res.statusCode ?? 0

      if (status >= 300 && status < 400) {
        res.destroy()
        finish({
          ok: false,
          code: 'redirect_refused',
          message: `Redirect (${status}) refused; the client never follows redirects`,
          status,
        })
        return
      }

      const chunks: Buffer[] = []
      let total = 0
      res.on('data', (c: Buffer) => {
        total += c.length
        if (total > maxBytes) {
          res.destroy()
          req.destroy()
          finish({
            ok: false,
            code: 'response_too_large',
            message: `Response exceeded ${maxBytes} bytes and was discarded`,
          })
          return
        }
        chunks.push(c)
      })
      res.on('error', (e: Error) => {
        finish({ ok: false, code: 'network_error', message: e.message })
      })
      res.on('end', () => {
        if (settled) return
        const bytes = Buffer.concat(chunks)
        if (status < 200 || status >= 300) {
          finish({ ok: false, code: 'http_status', message: `HTTP ${status}`, status })
          return
        }
        if (!options.expectJson) {
          finish({ ok: true, status, bytes })
          return
        }
        try {
          finish({ ok: true, status, bytes, json: JSON.parse(bytes.toString('utf8')) })
        } catch {
          finish({ ok: false, code: 'invalid_json', message: 'Response body was not valid JSON' })
        }
      })
    })

    const deadline = setTimeout(() => {
      req.destroy()
      finish({ ok: false, code: 'timeout', message: `Request exceeded ${timeoutMs} ms` })
    }, timeoutMs)
    if (typeof deadline.unref === 'function') deadline.unref()

    req.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'WRC_BLOCKED_ADDRESS') {
        finish({ ok: false, code: 'blocked_address', message: e.message })
        return
      }
      const tlsish =
        typeof e.code === 'string' &&
        (e.code.startsWith('ERR_TLS') ||
          e.code.startsWith('CERT_') ||
          e.code.startsWith('UNABLE_TO_') ||
          e.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
          e.code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
          e.code === 'EPROTO')
      finish({
        ok: false,
        code: tlsish ? 'tls_error' : 'network_error',
        message: e.message,
      })
    })

    req.end()
  })
}
