/**
 * Map orchestrator / extension `optimando-api-keys` (flat Record<string,string>)
 * to OCRRouter CloudAIConfig so inbox LLM and handshake model list stay aligned.
 */

import type { CloudAIConfig, VisionProvider } from './types'
import { ocrRouter } from './router'

const VISION_KEY_ORDER: VisionProvider[] = ['OpenAI', 'Claude', 'Gemini', 'Grok']

/**
 * Build CloudAIConfig from a flat key bag (OpenAI, Claude, Gemini, Grok, plus optional custom names).
 * Only vision providers are placed in `apiKeys`.
 *
 * Roadmap 0.15 / D-37: a stored key is not consent. The config stays local
 * (`preference: 'local'`, no cloud for images); keys only make a cloud model selectable
 * where the user picks one explicitly.
 */
export function cloudConfigFromOptimandoApiKeysRecord(
  raw: Record<string, unknown> | null | undefined,
): CloudAIConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const apiKeys: Partial<Record<VisionProvider, string>> = {}
  for (const p of VISION_KEY_ORDER) {
    const v = raw[p]
    if (typeof v === 'string' && v.trim()) {
      apiKeys[p] = v.trim()
    }
  }
  if (Object.keys(apiKeys).length === 0) return null
  return {
    apiKeys,
    preference: 'local',
    useCloudForImages: false,
  }
}

/**
 * Key sync from the extension (`POST /api/ocr/config`): take the keys, never the
 * `preference` / `useCloudForImages` the sync sends (it derives them from key presence).
 */
export function cloudConfigFromKeySync(body: { apiKeys?: unknown } | null | undefined): CloudAIConfig {
  const keys = body?.apiKeys && typeof body.apiKeys === 'object' ? (body.apiKeys as Record<string, unknown>) : null
  return cloudConfigFromOptimandoApiKeysRecord(keys) ?? { apiKeys: {}, preference: 'local', useCloudForImages: false }
}

/**
 * On startup: if orchestrator has `optimando-api-keys`, hydrate ocrRouter so inbox LLM sees cloud keys
 * before any extension POST (e.g. keys written by a previous session).
 */
export async function bootstrapOcrRouterFromOrchestratorKeys(): Promise<void> {
  const { getOrchestratorService } = await import('../orchestrator-db/service')
  const service = getOrchestratorService()
  await service.connect()
  const stored = await service.get<Record<string, string>>('optimando-api-keys')
  if (!stored || typeof stored !== 'object') {
    console.log('[MAIN] No optimando-api-keys in orchestrator — ocrRouter bootstrap skipped')
    return
  }
  const config = cloudConfigFromOptimandoApiKeysRecord(stored)
  if (!config) {
    console.log('[MAIN] optimando-api-keys has no vision provider keys — ocrRouter bootstrap skipped')
    return
  }
  ocrRouter.setCloudConfig(config)
  console.log('[MAIN] Bootstrapped ocrRouter cloud config from orchestrator')
}
