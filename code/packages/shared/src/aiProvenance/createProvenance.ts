import { sha256HexUtf8 } from './sha256'
import {
  AI_MARKING_SCHEME,
  type AiProvenance,
  type AiTextWithProvenance,
  type CreateProvenanceInput,
} from './types'

export function createProvenance(content: string, input: CreateProvenanceInput): AiProvenance {
  const p: AiProvenance = {
    synthetic: true,
    modality: 'text',
    model_id: input.model_id || 'unknown',
    provider: input.provider || 'local',
    generated_at: input.generated_at ?? new Date().toISOString(),
    content_sha256: sha256HexUtf8(content ?? ''),
    marking_scheme: AI_MARKING_SCHEME,
    origin: input.origin ?? 'ai',
    human_edited: input.human_edited ?? false,
    editorial_responsible: input.editorial_responsible ?? false,
  }
  if (input.upstream_marking !== undefined) {
    p.upstream_marking = input.upstream_marking
  }
  return p
}

export function finalizeAiText(
  content: string,
  input: CreateProvenanceInput,
): AiTextWithProvenance {
  return { content, provenance: createProvenance(content, input) }
}

/** Re-hash and mark origin mixed after a human edit of AI content. */
export function markHumanEdited(prev: AiProvenance, newContent: string): AiProvenance {
  return {
    ...prev,
    content_sha256: sha256HexUtf8(newContent ?? ''),
    origin: prev.origin === 'human' ? 'human' : 'mixed',
    human_edited: true,
  }
}

/** Deployer takes editorial responsibility (Art. 50(4) exemption path). */
export function markEditorialResponsible(prev: AiProvenance): AiProvenance {
  return {
    ...prev,
    editorial_responsible: true,
  }
}

export function isAiProvenance(value: unknown): value is AiProvenance {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    v.synthetic === true &&
    v.modality === 'text' &&
    v.marking_scheme === AI_MARKING_SCHEME &&
    typeof v.content_sha256 === 'string' &&
    typeof v.model_id === 'string'
  )
}

/** Extract upstream marking fields from a provider JSON body when present. */
export function extractUpstreamMarking(body: unknown): unknown | undefined {
  if (!body || typeof body !== 'object') return undefined
  const o = body as Record<string, unknown>
  const keys = [
    'content_credentials',
    'contentCredentials',
    'c2pa',
    'provenance',
    'ai_provenance',
    'synthetic_content',
  ] as const
  const found: Record<string, unknown> = {}
  for (const k of keys) {
    if (o[k] !== undefined) found[k] = o[k]
  }
  return Object.keys(found).length > 0 ? found : undefined
}
