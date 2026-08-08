/**
 * Isolated transport interface for the WRC resolution client.
 *
 * The WRC service is a later, separate deliverable. Per the delta v1.1 WRC
 * deferral, Phase 3 is built contract-first: everything above this interface is
 * real client logic, everything below it is swappable. Tests inject a
 * contract-faithful double; production injects {@link createWrcHttpTransport}.
 * When the live service arrives, only the factory changes — no verification,
 * no policy, and no call site moves.
 *
 * The DNS channel lives here too, deliberately. It is a transport concern and
 * it is the one channel a test cannot stub by intercepting HTTP, so leaving it
 * outside the interface would make the dual-channel logic untestable and
 * quietly tempt someone to skip it in tests — which is exactly the leg that
 * must never be skipped.
 */

import { resolveTxt } from 'node:dns/promises'
import { wrcHttpsGet, type WrcHttpErrorCode } from './httpsClient'

export type WrcTransportErrorCode = WrcHttpErrorCode | 'dns_error' | 'not_configured'

export type WrcTransportResult =
  | { ok: true; value: unknown }
  | { ok: false; code: WrcTransportErrorCode; message: string; status?: number }

export type WrcTxtResult =
  | { ok: true; records: string[] }
  | { ok: false; code: WrcTransportErrorCode; message: string }

export interface WrcTransport {
  /** `GET /v1/resolve/{part}` — the registry CLAIM. */
  resolve(publisherPart: string): Promise<WrcTransportResult>
  /** `GET /v1/publishers/{part}/catalog/head`. */
  catalogHead(publisherPart: string): Promise<WrcTransportResult>
  /** `GET /v1/publishers/{part}/entries/{entry_id}` → DualAssuranceEnvelope. */
  entry(publisherPart: string, entryId: string): Promise<WrcTransportResult>
  /** `GET /v1/objects/{sha256}` → DualAssuranceEnvelope for any published object. */
  object(hash: string): Promise<WrcTransportResult>
  /** Publisher-served `https://<domain>/.well-known/wr/manifest`. */
  publisherManifest(domain: string): Promise<WrcTransportResult>
  /** DNS TXT for `_wr.<domain>`. */
  wrTxtRecords(domain: string): Promise<WrcTxtResult>
}

/** Per-object byte caps. The EVP budget is enforced again after decode (§3.3). */
const OBJECT_MAX_BYTES = 128 * 1024
const HEAD_MAX_BYTES = 16 * 1024
const MANIFEST_MAX_BYTES = 32 * 1024

function toResult(r: Awaited<ReturnType<typeof wrcHttpsGet>>): WrcTransportResult {
  if (!r.ok) return { ok: false, code: r.code, message: r.message, status: r.status }
  return { ok: true, value: r.json }
}

export interface WrcHttpTransportConfig {
  /** Registry base origin, e.g. `https://wrc.example.com`. */
  registryBaseUrl: string
  timeoutMs?: number
}

/**
 * Production transport. Every call goes through the hardened client; there is
 * no second HTTP path, which is what makes "used by 3B exclusively" checkable.
 */
export function createWrcHttpTransport(config: WrcHttpTransportConfig): WrcTransport {
  const base = config.registryBaseUrl.replace(/\/+$/, '')
  const t = config.timeoutMs

  const get = async (url: string, maxBytes: number): Promise<WrcTransportResult> =>
    toResult(await wrcHttpsGet(url, { maxBytes, timeoutMs: t, expectJson: true }))

  return {
    resolve: (part) => get(`${base}/v1/resolve/${encodeURIComponent(part)}`, HEAD_MAX_BYTES),
    catalogHead: (part) =>
      get(`${base}/v1/publishers/${encodeURIComponent(part)}/catalog/head`, HEAD_MAX_BYTES),
    entry: (part, entryId) =>
      get(
        `${base}/v1/publishers/${encodeURIComponent(part)}/entries/${encodeURIComponent(entryId)}`,
        OBJECT_MAX_BYTES,
      ),
    object: (hash) => get(`${base}/v1/objects/${encodeURIComponent(hash)}`, OBJECT_MAX_BYTES),
    publisherManifest: (domain) =>
      get(`https://${domain}/.well-known/wr/manifest`, MANIFEST_MAX_BYTES),
    async wrTxtRecords(domain) {
      try {
        const records = await resolveTxt(`_wr.${domain}`)
        return { ok: true, records: records.map((parts) => parts.join('')) }
      } catch (e) {
        return { ok: false, code: 'dns_error', message: e instanceof Error ? e.message : String(e) }
      }
    },
  }
}

/**
 * Transport that refuses everything. This is the default until an operator
 * configures a registry: an unconfigured deployment must fail closed and say
 * so, not silently behave as if nothing resolves.
 */
export function createUnconfiguredWrcTransport(): WrcTransport {
  const refuse = async (): Promise<WrcTransportResult> => ({
    ok: false,
    code: 'not_configured',
    message: 'No WRC registry is configured for this deployment',
  })
  return {
    resolve: refuse,
    catalogHead: refuse,
    entry: refuse,
    object: refuse,
    publisherManifest: refuse,
    async wrTxtRecords() {
      return {
        ok: false,
        code: 'not_configured',
        message: 'No WRC registry is configured for this deployment',
      }
    },
  }
}
