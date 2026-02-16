/**
 * Strict Origin Binding for WRVault
 * ===================================
 *
 * This module implements the Web Security Model's concept of an "origin"
 * (scheme + host + port) as the canonical unit for credential binding.
 *
 * Design principles:
 *
 *   1. **Exact origin by default.**  A credential stored for
 *      `https://accounts.example.com` will NOT match `https://example.com`
 *      or `https://mail.example.com` unless the user explicitly enables
 *      subdomain sharing.
 *
 *   2. **No wildcard subdomain unless explicitly allowed.**  Subdomain
 *      expansion requires the `subdomainPolicy` field on the vault item
 *      to be set to `'share_parent'` (credential applies to the parent
 *      domain and all its subdomains) or `'share_exact_children'` (only
 *      one level of subdomains).
 *
 *   3. **Scheme matters.**  `http://example.com` and `https://example.com`
 *      are different origins.  We only treat `http` ↔ `https` as equivalent
 *      when `allowInsecureSchemeUpgrade` is true (for migration purposes).
 *
 *   4. **Port matters.**  `https://app.example.com:8443` is a different
 *      origin from `https://app.example.com`.
 *
 *   5. **Public-suffix aware.**  We never allow subdomain expansion across
 *      public suffix boundaries (e.g., `github.io` is a public suffix, so
 *      `alice.github.io` must not match `bob.github.io`).
 *
 * Wire format:
 *   Origins are stored as canonical strings: `scheme://host[:port]`
 *   Port is omitted when it's the default for the scheme (443 for https,
 *   80 for http).
 *
 * Migration:
 *   Legacy vault items store only a hostname in the `domain` field.
 *   `normalizeToOrigin()` upgrades these to full origins by assuming
 *   `https://` and default port.
 */

// ============================================================================
// §1  Core Types
// ============================================================================

/**
 * A parsed, canonical origin (scheme + host + optional non-default port).
 */
export interface ParsedOrigin {
  /** Lowercase scheme without '://' (e.g., 'https'). */
  scheme: string
  /** Lowercase hostname (e.g., 'accounts.example.com'). */
  host: string
  /** Numeric port, or null if default for the scheme. */
  port: number | null
  /** Canonical string form: `scheme://host[:port]` */
  canonical: string
}

/**
 * Controls whether a credential may match subdomains of its stored origin.
 *
 * - `'exact'`                  — Only exact origin match (default).
 * - `'share_parent'`           — Credential applies to the stored host and
 *                                all its subdomains (e.g., `example.com` also
 *                                matches `mail.example.com`).
 * - `'share_exact_children'`   — Credential stored on a parent domain matches
 *                                only immediate child subdomains (one level).
 */
export type SubdomainPolicy = 'exact' | 'share_parent' | 'share_exact_children'

/**
 * Result of an origin match evaluation.
 */
export interface OriginMatchResult {
  /** Whether the origins match under the given policy. */
  matches: boolean
  /** How the match was achieved. */
  matchType: 'exact' | 'www_equivalent' | 'subdomain_parent' | 'subdomain_child' | 'scheme_upgrade' | 'none'
  /** Confidence weight (0–100). Exact = 100, www = 95, subdomain = 60, scheme_upgrade = 50. */
  confidence: number
}

// ============================================================================
// §2  Constants
// ============================================================================

/** Default ports per scheme — omitted from canonical origin strings. */
const DEFAULT_PORTS: Record<string, number> = {
  http: 80,
  https: 443,
  ftp: 21,
}

/**
 * Well-known public suffix patterns.
 * Subdomains under these suffixes are treated as independent origins,
 * preventing cross-tenant credential leakage.
 */
const PUBLIC_SUFFIXES: readonly RegExp[] = [
  /\.github\.io$/i,
  /\.githubusercontent\.com$/i,
  /\.herokuapp\.com$/i,
  /\.netlify\.app$/i,
  /\.vercel\.app$/i,
  /\.pages\.dev$/i,
  /\.web\.app$/i,
  /\.firebaseapp\.com$/i,
  /\.azurewebsites\.net$/i,
  /\.cloudfront\.net$/i,
  /\.s3\.amazonaws\.com$/i,
  /\.appspot\.com$/i,
  /\.blogspot\.com$/i,
  /\.wordpress\.com$/i,
  /\.tumblr\.com$/i,
  /\.gitlab\.io$/i,
  /\.bitbucket\.io$/i,
  /\.surge\.sh$/i,
  /\.now\.sh$/i,
  /\.fly\.dev$/i,
  /\.render\.com$/i,
  /\.railway\.app$/i,
  /\.onrender\.com$/i,
  /\.deno\.dev$/i,
  /\.workers\.dev$/i,
  /\.r2\.dev$/i,
  /\.azurestaticapps\.net$/i,
  /\.ngrok\.io$/i,
  /\.ngrok-free\.app$/i,
  /\.loca\.lt$/i,
  /\.trycloudflare\.com$/i,
]

// ============================================================================
// §3  Parsing
// ============================================================================

/**
 * Parse a URL / origin string into a `ParsedOrigin`.
 *
 * Accepts:
 *   - Full URLs: `https://example.com:8443/path?q=1`
 *   - Origin strings: `https://example.com:8443`
 *   - Bare hostnames: `example.com` (assumes `https`, default port)
 *   - Legacy domain fields: `www.example.com` (normalizes www)
 *
 * Returns `null` if the input is empty or unparseable.
 */
export function parseOrigin(input: string): ParsedOrigin | null {
  if (!input || typeof input !== 'string') return null
  let raw = input.trim()
  if (!raw) return null

  // If there's no scheme, prepend https://
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) {
    raw = 'https://' + raw
  }

  try {
    const url = new URL(raw)
    const scheme = url.protocol.replace(/:$/, '').toLowerCase()
    const host = url.hostname.toLowerCase()
    if (!host) return null

    // Determine port
    const explicitPort = url.port ? parseInt(url.port, 10) : null
    const isDefaultPort = explicitPort === null || explicitPort === DEFAULT_PORTS[scheme]
    const port = isDefaultPort ? null : explicitPort

    // Build canonical string
    const canonical = port !== null
      ? `${scheme}://${host}:${port}`
      : `${scheme}://${host}`

    return { scheme, host, port, canonical }
  } catch {
    return null
  }
}

/**
 * Normalize a legacy `domain` field (hostname) to a canonical origin string.
 *
 * If the input already has a scheme, it is parsed as-is.
 * If it's a bare hostname, `https://` is prepended.
 *
 * @returns Canonical origin string, or the original input if unparseable.
 */
export function normalizeToOrigin(domainOrUrl: string): string {
  const parsed = parseOrigin(domainOrUrl)
  return parsed?.canonical ?? domainOrUrl
}

/**
 * Extract the registrable domain (eTLD+1) from a hostname.
 *
 * This is a heuristic — we don't ship the full Public Suffix List.
 * For known public suffixes we return the full hostname (preventing
 * cross-tenant sharing).  For everything else we return the last two
 * labels (e.g., `accounts.example.com` → `example.com`).
 */
export function registrableDomain(host: string): string {
  const lower = host.toLowerCase()

  // Check public suffix patterns — if matched, the full hostname IS the
  // registrable domain (each tenant is isolated).
  for (const re of PUBLIC_SUFFIXES) {
    if (re.test(lower)) return lower
  }

  const labels = lower.split('.')
  if (labels.length <= 2) return lower
  return labels.slice(-2).join('.')
}

// ============================================================================
// §4  Matching
// ============================================================================

/**
 * Options controlling how origin matching is performed.
 */
export interface OriginMatchOptions {
  /** The subdomain policy for the stored credential. Default: 'exact'. */
  subdomainPolicy?: SubdomainPolicy
  /**
   * Allow `http` to match `https` (scheme upgrade).
   * Useful during migration from legacy entries that didn't record scheme.
   * Default: false.
   */
  allowInsecureSchemeUpgrade?: boolean
}

/**
 * Evaluate whether a `stored` origin matches the `current` page origin.
 *
 * This is the **core matching function** used everywhere: autofill candidate
 * lookup, QuickInsert relevance scoring, credential save deduplication, and
 * the overlay domain display.
 *
 * The match is evaluated as follows:
 *
 *   1. Parse both origins.
 *   2. Exact canonical match → confidence 100.
 *   3. www-equivalence (`www.` ↔ bare) → confidence 95.
 *   4. Scheme upgrade (http ↔ https, if allowed) → confidence 50.
 *   5. Subdomain matching (only if policy allows, and not across public
 *      suffix boundaries) → confidence 60.
 *   6. Otherwise → no match.
 */
export function matchOrigin(
  stored: string,
  current: string,
  options: OriginMatchOptions = {},
): OriginMatchResult {
  const NO_MATCH: OriginMatchResult = { matches: false, matchType: 'none', confidence: 0 }

  const sp = parseOrigin(stored)
  const cp = parseOrigin(current)
  if (!sp || !cp) return NO_MATCH

  const policy = options.subdomainPolicy ?? 'exact'
  const allowSchemeUpgrade = options.allowInsecureSchemeUpgrade ?? false

  // ── Gate: ports must match ──
  if (sp.port !== cp.port) return NO_MATCH

  // ── 1. Exact canonical match ──
  if (sp.canonical === cp.canonical) {
    return { matches: true, matchType: 'exact', confidence: 100 }
  }

  // ── 2. Scheme match or upgrade ──
  const schemesEqual = sp.scheme === cp.scheme
  const schemeUpgraded = allowSchemeUpgrade &&
    ((sp.scheme === 'http' && cp.scheme === 'https') ||
     (sp.scheme === 'https' && cp.scheme === 'http'))

  if (!schemesEqual && !schemeUpgraded) return NO_MATCH

  // ── 3. www-equivalence (same host modulo www. prefix) ──
  const spBare = sp.host.replace(/^www\./, '')
  const cpBare = cp.host.replace(/^www\./, '')
  if (spBare === cpBare) {
    return {
      matches: true,
      matchType: schemeUpgraded ? 'scheme_upgrade' : 'www_equivalent',
      confidence: schemeUpgraded ? 50 : 95,
    }
  }

  // ── 4. Subdomain matching (only if policy allows) ──
  if (policy === 'exact') return NO_MATCH

  // Never allow subdomain matching across public suffix boundaries
  const spReg = registrableDomain(sp.host)
  const cpReg = registrableDomain(cp.host)
  if (spReg !== cpReg) return NO_MATCH

  if (policy === 'share_parent') {
    // stored = example.com, current = sub.example.com → match
    // stored = sub.example.com, current = example.com → match
    if (cp.host.endsWith('.' + sp.host) || sp.host.endsWith('.' + cp.host)) {
      return {
        matches: true,
        matchType: cp.host.endsWith('.' + sp.host) ? 'subdomain_child' : 'subdomain_parent',
        confidence: 60,
      }
    }
  }

  if (policy === 'share_exact_children') {
    // stored = example.com, current = sub.example.com (one level only)
    if (cp.host.endsWith('.' + sp.host)) {
      const prefix = cp.host.slice(0, -(sp.host.length + 1))
      // Only one level: no dots in the prefix
      if (!prefix.includes('.')) {
        return { matches: true, matchType: 'subdomain_child', confidence: 60 }
      }
    }
  }

  return NO_MATCH
}

// ============================================================================
// §5  Public Suffix Detection
// ============================================================================

/**
 * Check if a hostname falls under a known public suffix.
 * Auto-insert should be blocked or downgraded on these domains
 * to prevent cross-tenant credential leakage.
 */
export function isPublicSuffix(host: string): boolean {
  return PUBLIC_SUFFIXES.some(re => re.test(host.toLowerCase()))
}

// ============================================================================
// §6  QuickInsert Relevance Classification
// ============================================================================

/**
 * Relevance tier for QuickInsert result ordering.
 *
 * - `exact_origin`  — credential stored for this exact origin (highest priority)
 * - `www_equivalent` — credential for www.host ↔ bare host
 * - `subdomain`     — credential matched via subdomain policy
 * - `same_domain`   — same registrable domain but no policy allows sharing
 * - `global`        — no domain association, or different domain entirely
 */
export type RelevanceTier =
  | 'exact_origin'
  | 'www_equivalent'
  | 'subdomain'
  | 'same_domain'
  | 'global'

/**
 * Classify a vault entry's relevance to the current page origin.
 *
 * This is used by QuickInsert to:
 *   1. Show exact-origin matches prominently.
 *   2. Show same-domain matches in a secondary group.
 *   3. Hide global/cross-domain entries unless the user expands.
 */
export function classifyRelevance(
  storedDomain: string | undefined,
  currentOrigin: string,
  subdomainPolicy: SubdomainPolicy = 'exact',
): RelevanceTier {
  // No stored domain → global credential
  if (!storedDomain) return 'global'

  const result = matchOrigin(storedDomain, currentOrigin, { subdomainPolicy })

  if (!result.matches) {
    // Check if same registrable domain (informational, no fill privilege)
    const sp = parseOrigin(storedDomain)
    const cp = parseOrigin(currentOrigin)
    if (sp && cp && registrableDomain(sp.host) === registrableDomain(cp.host)) {
      return 'same_domain'
    }
    return 'global'
  }

  switch (result.matchType) {
    case 'exact': return 'exact_origin'
    case 'www_equivalent': return 'www_equivalent'
    case 'subdomain_child':
    case 'subdomain_parent': return 'subdomain'
    case 'scheme_upgrade': return 'exact_origin' // same host, different scheme
    default: return 'global'
  }
}

/**
 * Numeric weight for sorting QuickInsert results.
 * Higher = more relevant = shown first.
 */
export function relevanceWeight(tier: RelevanceTier): number {
  switch (tier) {
    case 'exact_origin':   return 100
    case 'www_equivalent': return 90
    case 'subdomain':      return 60
    case 'same_domain':    return 30
    case 'global':         return 0
  }
}
