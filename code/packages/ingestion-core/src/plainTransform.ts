/**
 * Plain (non-BEAP) content transformation.
 *
 * Wraps plain content into a candidate capsule with capsule_type = 'internal_draft'.
 */

export function buildPlainDraftPayload(body: string | Buffer): unknown {
  const text = typeof body === 'string' ? body : body.toString('utf-8');
  return {
    schema_version: 1,
    capsule_type: 'internal_draft',
    timestamp: new Date().toISOString(),
    content: text,
  };
}
