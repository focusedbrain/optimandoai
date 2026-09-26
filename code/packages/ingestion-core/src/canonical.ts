/**
 * WR Handshake canonical serialization (Phase 2 — A8) [VII.6.1.3, XII.5 pattern]
 *
 * One shared module producing deterministic, byte-identical serializations of
 * JSON-shaped objects. Every WR signature covers the COMPLETE canonical form
 * of an object minus its signature field, prefixed with a domain-separation
 * tag equal to the object's type + version. Signing a partial object is
 * structurally unrepresentable through this module: there is no field-subset
 * parameter anywhere in the API.
 *
 * Canonical form rules (fully specified):
 *  - UTF-8 bytes of a JSON text with NO insignificant whitespace.
 *  - Object members sorted by key, lexicographically by UTF-16 code units
 *    (RFC 8785 §3.2.3 ordering).
 *  - Array element order is significant and preserved.
 *  - Strings serialized via JSON.stringify escaping (deterministic).
 *  - Numbers MUST be safe integers. Floats, NaN, ±Infinity, -0 and values
 *    outside Number.MAX_SAFE_INTEGER are rejected — integer-only
 *    representation guarantees cross-platform byte identity.
 *  - Absence of a field: a property whose value is `undefined` is treated as
 *    ABSENT (not serialized). `null` is a present, significant value.
 *  - No other value types (functions, symbols, bigints, Dates) are accepted.
 *
 * Domain separation: every hash/signature input is prefixed with
 * `WRH1|<type>|v<version>|` so bytes signed for one object class can never
 * verify for another [Q3].
 */

// ── JSON value model ──────────────────────────────────────────────────────────

export type CanonicalJsonValue =
  | string
  | number
  | boolean
  | null
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue | undefined }

export class CanonicalizationError extends Error {
  constructor(
    message: string,
    /** JSON-pointer-ish path to the offending value, for diagnostics. */
    readonly path: string,
  ) {
    super(`${message} (at ${path})`)
    this.name = 'CanonicalizationError'
  }
}

// ── Canonical serializer ──────────────────────────────────────────────────────

function serializeValue(value: unknown, path: string, out: string[]): void {
  if (value === null) {
    out.push('null')
    return
  }
  switch (typeof value) {
    case 'string':
      out.push(JSON.stringify(value))
      return
    case 'boolean':
      out.push(value ? 'true' : 'false')
      return
    case 'number': {
      if (!Number.isSafeInteger(value)) {
        throw new CanonicalizationError(
          `Canonical form allows safe integers only, got ${String(value)}`,
          path,
        )
      }
      // -0 would serialize as "0" via String() but is a distinct IEEE value;
      // normalize explicitly so equal objects hash equal.
      out.push(String(value === 0 ? 0 : value))
      return
    }
    case 'object': {
      if (Array.isArray(value)) {
        out.push('[')
        for (let i = 0; i < value.length; i++) {
          if (i > 0) out.push(',')
          if (value[i] === undefined) {
            throw new CanonicalizationError('Array elements must not be undefined', `${path}[${i}]`)
          }
          serializeValue(value[i], `${path}[${i}]`, out)
        }
        out.push(']')
        return
      }
      const obj = value as Record<string, unknown>
      const proto = Object.getPrototypeOf(obj)
      if (proto !== Object.prototype && proto !== null) {
        throw new CanonicalizationError('Only plain objects are canonicalizable', path)
      }
      // Sort by UTF-16 code units — default JS string comparison semantics.
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort()
      out.push('{')
      for (let i = 0; i < keys.length; i++) {
        if (i > 0) out.push(',')
        out.push(JSON.stringify(keys[i]), ':')
        serializeValue(obj[keys[i]], `${path}.${keys[i]}`, out)
      }
      out.push('}')
      return
    }
    default:
      throw new CanonicalizationError(`Type ${typeof value} is not canonicalizable`, path)
  }
}

/** Deterministic canonical JSON text of a value. Throws CanonicalizationError. */
export function canonicalJsonString(value: CanonicalJsonValue): string {
  const out: string[] = []
  serializeValue(value, '$', out)
  return out.join('')
}

/** Deterministic canonical UTF-8 bytes of a value. */
export function canonicalJsonBytes(value: CanonicalJsonValue): Uint8Array {
  return new TextEncoder().encode(canonicalJsonString(value))
}

// ── Domain separation ─────────────────────────────────────────────────────────

const DOMAIN_TAG_PREFIX = 'WRH1'

/**
 * Domain-separation tag for an object type + version. Prepended to every
 * hash/signature input so signatures can never be replayed across object
 * classes or versions [Q3].
 */
export function domainTag(objectType: string, version: number): Uint8Array {
  if (!/^[a-z0-9_.-]+$/i.test(objectType)) {
    throw new CanonicalizationError(`Invalid domain-tag object type: ${objectType}`, '$')
  }
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new CanonicalizationError(`Invalid domain-tag version: ${String(version)}`, '$')
  }
  return new TextEncoder().encode(`${DOMAIN_TAG_PREFIX}|${objectType}|v${version}|`)
}

/**
 * The exact byte string a signature over `value` covers:
 * domainTag(type, version) || canonicalJsonBytes(value).
 *
 * Callers pass the COMPLETE object minus its signature field; there is
 * deliberately no way to select a field subset here.
 */
export function signingBytes(
  objectType: string,
  version: number,
  value: CanonicalJsonValue,
): Uint8Array {
  const tag = domainTag(objectType, version)
  const body = canonicalJsonBytes(value)
  const out = new Uint8Array(tag.length + body.length)
  out.set(tag, 0)
  out.set(body, tag.length)
  return out
}
