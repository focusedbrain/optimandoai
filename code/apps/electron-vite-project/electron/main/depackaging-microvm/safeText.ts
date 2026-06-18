/**
 * SafeText v1 — the closed, allowlist-constructed text schema (Build 1).
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * LAYERED SECURITY MODEL — which layer guarantees what
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * L1  INERT-SINK DISCIPLINE (the actual no-code guarantee)
 *     SafeText content is NEVER used in an executable context. Every consumer
 *     renders it as React text nodes, stores it via parameterized SQL, or passes
 *     it as clearly-delimited DATA in LLM prompts. Code in the text is harmless
 *     because no sink interprets it. Audit: Step 2 of the layered-sandbox
 *     refactor confirmed zero executable sinks (no innerHTML, no eval, no
 *     dangerouslySetInnerHTML, no shell interpolation, no SQL concat).
 *
 * L2  CHARACTER BLOCKLIST — encoding/invisible-char HYGIENE (this file)
 *     `toPlainTextField` strips C0/C1 controls, DEL, Unicode bidi/format
 *     controls, zero-width chars, and BOM. `validateSafeText` rejects text
 *     containing any of these on the receive side. This prevents encoding-
 *     smuggling and invisible-character attacks. It is NOT the no-code
 *     guarantee — `eval("alert(1)")` passes the blocklist intact because
 *     those are normal printable characters that appear in legitimate email.
 *     The no-code guarantee is L1 (inert sinks).
 *
 * L3  detectThreats — DEFENSE-IN-DEPTH early warning (non-load-bearing)
 *     Flags suspicious patterns (code constructs, script tags, etc.) as an
 *     additional signal. Retained for monitoring/alerting, not as a gate.
 *
 * L4  VM-IDENTITY ATTESTATION — PROVENANCE
 *     Host-provisioned ephemeral key proves the result came from a VM the
 *     host booted from a verified golden image. See crosvmProvider.ts.
 *
 * L5  STRUCTURAL POSITIVE CONSTRUCTION (this file)
 *     `constructSafeText` builds SafeTextV1 field-by-field from only permitted
 *     inputs. `validateSafeText` enforces a closed-key allowlist, type checks,
 *     length bounds, and blob-UUID format. No path exists for unexpected fields
 *     to appear. This is genuinely real positive construction at the structural
 *     level (schema shape), distinct from character-level filtering.
 *
 * The combination is stronger than any single layer. Do not mistake L2 for the
 * no-code guarantee (it is not), and do not replace L2 with a character
 * allowlist (that would break legitimate email containing <, >, {, }, =, ;).
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * TEXT-PURITY INVARIANT (Invariant 1):
 *   The depackaging worker NEVER passes through the rich decoded MIME/JSON. It
 *   POSITIVELY CONSTRUCTS a fresh object containing ONLY the explicitly-permitted,
 *   type-checked plain-text fields below, and discards everything else. Active
 *   content (HTML with handlers, scripts, `data:` URIs as markup, attachments)
 *   is not "stripped" — it is simply never copied into safe-text; it leaves the
 *   guest only as opaque encrypted blobs referenced by `attachment_refs`.
 *
 * This is the OPPOSITE of a denylist. A denylist would take the original HTML and
 * try to remove dangerous parts; positive construction means the schema DEFINES
 * what a valid safe-text field is, and nothing outside it can exist.
 */

/** The only shape trusted layers ever see for depackaged text. */
export interface SafeTextV1 {
  readonly schema: 'safe-text/v1'
  /** Plain-text subject (header value only; never HTML). */
  readonly subject: string
  /** Plain-text body — concatenation of `text/plain` parts only. Never HTML. */
  readonly body_text: string
  /** Opaque blob handles for original artifacts. NEVER bytes, NEVER keys. */
  readonly attachment_refs: readonly string[]
}

export const SAFE_TEXT_SCHEMA = 'safe-text/v1' as const

/** Bounded limits (defense-in-depth; the guest is also resource-capped). */
export const SAFE_TEXT_LIMITS = {
  MAX_SUBJECT_CHARS: 2_000,
  MAX_BODY_CHARS: 1_000_000,
  MAX_ATTACHMENT_REFS: 256,
  /** blob_id is a UUID emitted by the worker. */
  BLOB_ID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
} as const

/**
 * Reduce an arbitrary decoded string to a disciplined plain-text field:
 *   - Unicode NFC normalization.
 *   - Normalize CRLF/CR to LF.
 *   - Remove C0/C1 control characters EXCEPT tab/newline (no NUL, no escape
 *     sequences, no bidi/format controls that could smuggle structure).
 *   - Hard length cap.
 *
 * This does NOT attempt to "sanitize HTML" — callers must only pass `text/plain`
 * content here. HTML/markup parts are never routed through this function; they
 * become encrypted blobs instead.
 */
export function toPlainTextField(raw: string, maxChars: number): string {
  let s = typeof raw === 'string' ? raw : ''
  // NFC normalize (collapses confusable composed/decomposed forms).
  try {
    s = s.normalize('NFC')
  } catch {
    /* normalize can throw on lone surrogates in some runtimes; fall through */
  }
  // CRLF / CR → LF.
  s = s.replace(/\r\n?/g, '\n')
  // Strip C0 controls except \t (0x09) and \n (0x0A); strip DEL + C1 controls;
  // strip Unicode bidi/format controls (U+200B–200F, U+202A–202E, U+2066–2069, U+FEFF).
  s = s.replace(
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g,
    '',
  )
  if (s.length > maxChars) s = s.slice(0, maxChars)
  return s
}

/**
 * POSITIVE CONSTRUCTION of a SafeTextV1. Builds the object field-by-field from
 * only the permitted inputs. There is no path for any other field to appear.
 */
export function constructSafeText(input: {
  subjectRaw: string
  plainTextBodyRaw: string
  attachmentBlobIds: readonly string[]
}): SafeTextV1 {
  const subject = toPlainTextField(input.subjectRaw, SAFE_TEXT_LIMITS.MAX_SUBJECT_CHARS)
  const body_text = toPlainTextField(input.plainTextBodyRaw, SAFE_TEXT_LIMITS.MAX_BODY_CHARS)
  const attachment_refs = input.attachmentBlobIds
    .filter((id) => typeof id === 'string' && SAFE_TEXT_LIMITS.BLOB_ID_RE.test(id))
    .slice(0, SAFE_TEXT_LIMITS.MAX_ATTACHMENT_REFS)
  return { schema: SAFE_TEXT_SCHEMA, subject, body_text, attachment_refs }
}

export type SafeTextValidation =
  | { ok: true; value: SafeTextV1 }
  | { ok: false; reason: string }

/** Permitted top-level keys — the closed-world allowlist. */
const ALLOWED_KEYS = new Set(['schema', 'subject', 'body_text', 'attachment_refs'])

// eslint-disable-next-line no-control-regex
const FORBIDDEN_PLAINTEXT_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/

/**
 * RECEIVE-SIDE re-validation (never trust the worker/upstream blindly).
 * Rejects anything that is not exactly a closed SafeTextV1:
 *   - any unexpected top-level key → reject (allowlist).
 *   - wrong types / bad schema tag → reject.
 *   - control/format characters in text fields → reject (encoding discipline).
 *   - attachment_refs that aren't well-formed opaque blob_ids → reject.
 */
export function validateSafeText(input: unknown): SafeTextValidation {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'not_an_object' }
  }
  const obj = input as Record<string, unknown>

  for (const key of Object.keys(obj)) {
    if (!ALLOWED_KEYS.has(key)) return { ok: false, reason: `unexpected_key:${key}` }
  }
  if (obj.schema !== SAFE_TEXT_SCHEMA) return { ok: false, reason: 'bad_schema_tag' }
  if (typeof obj.subject !== 'string') return { ok: false, reason: 'subject_not_string' }
  if (typeof obj.body_text !== 'string') return { ok: false, reason: 'body_text_not_string' }
  if (!Array.isArray(obj.attachment_refs)) return { ok: false, reason: 'attachment_refs_not_array' }

  if (obj.subject.length > SAFE_TEXT_LIMITS.MAX_SUBJECT_CHARS) return { ok: false, reason: 'subject_too_long' }
  if (obj.body_text.length > SAFE_TEXT_LIMITS.MAX_BODY_CHARS) return { ok: false, reason: 'body_text_too_long' }
  if (FORBIDDEN_PLAINTEXT_RE.test(obj.subject)) return { ok: false, reason: 'subject_control_chars' }
  if (FORBIDDEN_PLAINTEXT_RE.test(obj.body_text)) return { ok: false, reason: 'body_text_control_chars' }

  if (obj.attachment_refs.length > SAFE_TEXT_LIMITS.MAX_ATTACHMENT_REFS) {
    return { ok: false, reason: 'too_many_attachment_refs' }
  }
  for (const ref of obj.attachment_refs) {
    if (typeof ref !== 'string' || !SAFE_TEXT_LIMITS.BLOB_ID_RE.test(ref)) {
      return { ok: false, reason: 'bad_attachment_ref' }
    }
  }

  return {
    ok: true,
    value: {
      schema: SAFE_TEXT_SCHEMA,
      subject: obj.subject,
      body_text: obj.body_text,
      attachment_refs: [...(obj.attachment_refs as string[])],
    },
  }
}
