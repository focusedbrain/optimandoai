/**
 * Utility: find the first string in a JSON-like value that exceeds `maxLen`.
 *
 * Used by the validator role (P1.4) to enforce MAX_STRING_LENGTH before the
 * structural validation pass, closing the audit gap documented in
 * docs/architecture/beap-ingestor-audit-2026-05-24.md §3.3.
 *
 * Does NOT throw. Returns null when every string is within the limit.
 * The depth guard (100) is defensive — the validator already enforces
 * MAX_JSON_DEPTH (50) before calling this.
 */

export interface StringLengthViolation {
  /** Dot-bracket path to the offending string, e.g. "root.header.content". */
  path: string;
  /** Actual character count of the offending string. */
  length: number;
}

export function findOversizedString(
  value: unknown,
  maxLen: number,
  path = 'root',
  depth = 0,
): StringLengthViolation | null {
  if (depth > 100) return null;

  if (typeof value === 'string') {
    return value.length > maxLen ? { path, length: value.length } : null;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const r = findOversizedString(value[i], maxLen, `${path}[${i}]`, depth + 1);
      if (r) return r;
    }
    return null;
  }

  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const r = findOversizedString(
        (value as Record<string, unknown>)[key],
        maxLen,
        `${path}.${key}`,
        depth + 1,
      );
      if (r) return r;
    }
  }

  return null;
}
