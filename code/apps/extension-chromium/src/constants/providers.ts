/**
 * Canonical Provider Identity Constants
 * 
 * Single source of truth for provider identity strings across
 * UI labels, storage values, and runtime resolution.
 * 
 * UI dropdowns show PROVIDER_LABELS. Storage and runtime use PROVIDER_IDS.
 * Conversion happens at save time via toProviderId().
 */

export const PROVIDER_IDS = {
  OLLAMA: 'ollama',
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
  GEMINI: 'gemini',
  GROK: 'grok',
  IMAGE_AI: 'image_ai',
} as const;

export type ProviderId = typeof PROVIDER_IDS[keyof typeof PROVIDER_IDS];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  [PROVIDER_IDS.OLLAMA]: 'Local AI',
  [PROVIDER_IDS.OPENAI]: 'OpenAI',
  [PROVIDER_IDS.ANTHROPIC]: 'Claude',
  [PROVIDER_IDS.GEMINI]: 'Gemini',
  [PROVIDER_IDS.GROK]: 'Grok',
  [PROVIDER_IDS.IMAGE_AI]: 'Image AI',
};

const LABEL_TO_ID: Record<string, ProviderId> = {};
for (const [id, label] of Object.entries(PROVIDER_LABELS)) {
  LABEL_TO_ID[label.toLowerCase()] = id as ProviderId;
  LABEL_TO_ID[id] = id as ProviderId; // identity mapping so stored IDs pass through
}

/**
 * Convert a UI label or legacy stored string to a canonical ProviderId.
 * Handles: 'Local AI' → 'ollama', 'OpenAI' → 'openai', 'Claude' → 'anthropic',
 *          'ollama' → 'ollama' (passthrough for already-normalized values),
 *          '' → '' (empty means unset / use fallback)
 */
export function toProviderId(input: string): ProviderId | '' {
  if (!input) return '';
  const normalized = input.trim().toLowerCase();
  return LABEL_TO_ID[normalized] ?? '';
}

/**
 * Get the display label for a ProviderId.
 * Returns the input unchanged if not a recognized ProviderId (graceful fallback).
 */
export function toProviderLabel(id: string): string {
  return (PROVIDER_LABELS as Record<string, string>)[id] ?? id;
}

export function isLocalProvider(providerIdOrLabel: string): boolean {
  const id = toProviderId(providerIdOrLabel);
  return id === PROVIDER_IDS.OLLAMA || id === '';
}

export function isCloudProvider(providerIdOrLabel: string): boolean {
  const id = toProviderId(providerIdOrLabel);
  return id !== '' && id !== PROVIDER_IDS.OLLAMA && id !== PROVIDER_IDS.IMAGE_AI;
}

/** Default model to use when a cloud provider is selected but model is 'auto' or empty. */
export const CLOUD_DEFAULT_MODELS: Partial<Record<ProviderId, string>> = {
  [PROVIDER_IDS.OPENAI]: 'gpt-4o-mini',
  [PROVIDER_IDS.ANTHROPIC]: 'claude-3-haiku-20240307',
  [PROVIDER_IDS.GEMINI]: 'gemini-2.0-flash',
  [PROVIDER_IDS.GROK]: 'grok-3-mini',
};

/** Map ProviderId to the key name used in the optimando-api-keys storage object. */
export const PROVIDER_API_KEY_NAMES: Partial<Record<ProviderId, string>> = {
  [PROVIDER_IDS.OPENAI]: 'OpenAI',
  [PROVIDER_IDS.ANTHROPIC]: 'Claude',
  [PROVIDER_IDS.GEMINI]: 'Gemini',
  [PROVIDER_IDS.GROK]: 'Grok',
};

/**
 * Plain-JS compatible provider map for grid scripts that cannot import TS modules.
 * Copy this block into grid-script.js / grid-script-v2.js.
 */
export const PROVIDER_MAP_FOR_GRID_JS = `
var PROVIDER_IDS = { OLLAMA:'ollama', OPENAI:'openai', ANTHROPIC:'anthropic', GEMINI:'gemini', GROK:'grok', IMAGE_AI:'image_ai' };
var LABEL_TO_PROVIDER_ID = { 'local ai':'ollama', 'openai':'openai', 'claude':'anthropic', 'gemini':'gemini', 'grok':'grok', 'image ai':'image_ai', 'ollama':'ollama', 'anthropic':'anthropic' };
function toProviderIdJS(label) { if (!label) return ''; return LABEL_TO_PROVIDER_ID[label.trim().toLowerCase()] || ''; }
function toProviderLabelJS(id) { var labels = { ollama:'Local AI', openai:'OpenAI', anthropic:'Claude', gemini:'Gemini', grok:'Grok', image_ai:'Image AI' }; return labels[id] || id; }
`;
