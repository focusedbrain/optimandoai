/** EU AI Act Art. 50(2) machine-readable provenance for synthetic text outputs. */

export const AI_MARKING_SCHEME = 'optirando-prov/1' as const

export type AiProvenanceOrigin = 'ai' | 'human' | 'mixed'

/** Provider identity: local llama.cpp/Ollama, cloud vendor, or Host AI path. */
export type AiProvenanceProvider = 'local' | 'host-ai' | `cloud:${string}` | string

export interface AiProvenance {
  synthetic: true
  modality: 'text'
  model_id: string
  provider: AiProvenanceProvider
  /** ISO-8601 UTC */
  generated_at: string
  content_sha256: string
  marking_scheme: typeof AI_MARKING_SCHEME
  origin: AiProvenanceOrigin
  human_edited: boolean
  editorial_responsible: boolean
  /** Upstream provider Content Credentials / marks, preserved verbatim when present. */
  upstream_marking?: unknown
}

export type CreateProvenanceInput = {
  model_id: string
  provider: AiProvenanceProvider
  upstream_marking?: unknown
  origin?: AiProvenanceOrigin
  human_edited?: boolean
  editorial_responsible?: boolean
  generated_at?: string
}

/** Result envelope used at generation boundaries. */
export type AiTextWithProvenance = {
  content: string
  provenance: AiProvenance
}

export const AI_VISIBLE_LABEL_LINE = '[AI-generated]'
export const AI_UNVERIFIED_PROVENANCE_LABEL = 'AI-generated (unverified provenance)'
export const AI_DISCLOSURE_ACK_KEY_MAIN = 'art50.aiDisclosure.acknowledgedAt'
export const AI_DISCLOSURE_ACK_KEY_EXTENSION = 'art50_ai_disclosure_acknowledged_at'
