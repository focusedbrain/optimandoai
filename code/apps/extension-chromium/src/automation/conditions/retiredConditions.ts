/**
 * Retired Event Tag condition types.
 *
 * `wrcode_valid` was retired because the concept it named does not exist.
 * Channel provenance (SPF / DKIM / DMARC) and publisher resolution are
 * MANDATORY and structural: they run in the depackaging pipeline before any WR
 * code is extracted, and a message that fails them yields no code and no
 * affordance at all [IX.3.1, XVI]. There is therefore no such class as a
 * "WRCode-stamped email" that a per-trigger checkbox could opt into — the
 * check is not a filter a user can enable, and never was.
 *
 * Stored agent configurations may still carry the condition. Dropping it is
 * not a downgrade: nothing ever produced the verdict it read
 * (`NormalizedEvent.wrcodeValid` had no writer), and no email has ever reached
 * this routing path — its input is WR Chat and OCR text. Keeping the entry
 * would be worse than dropping it, because an unrecognized condition type is
 * exactly the kind of thing an evaluator can mishandle.
 *
 * A future condition over the Channel Provenance Record would be a DIFFERENT
 * condition with a different name and honest semantics (it would read a
 * verdict the pipeline actually produces). It is not a rename of this one.
 */

/** Condition types that were removed and must never be evaluated again. */
export const RETIRED_EVENT_TAG_CONDITION_TYPES: readonly string[] = Object.freeze([
  'wrcode_valid',
])

export function isRetiredEventTagCondition(condition: unknown): boolean {
  if (typeof condition !== 'object' || condition === null) return false
  const type = (condition as { type?: unknown }).type
  return typeof type === 'string' && RETIRED_EVENT_TAG_CONDITION_TYPES.includes(type)
}

/**
 * Drop retired conditions from a stored `eventTagConditions` array. Applied at
 * every read boundary so a stale config cannot reach an evaluator, where it
 * would land in an `unknown condition type` branch.
 */
export function stripRetiredConditions<T>(conditions: readonly T[] | null | undefined): T[] {
  if (!Array.isArray(conditions)) return []
  return conditions.filter((c) => !isRetiredEventTagCondition(c))
}
