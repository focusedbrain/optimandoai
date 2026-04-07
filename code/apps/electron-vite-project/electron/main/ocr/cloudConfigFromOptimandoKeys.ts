/**
 * Map orchestrator / extension `optimando-api-keys` (flat Record<string,string>)
 * to OCRRouter CloudAIConfig so inbox LLM and handshake model list stay aligned.
 */

import type { CloudAIConfig, VisionProvider } from './types'
import { ocrRouter } from './router'

const VISION_KEY_ORDER: VisionProvider[] = ['OpenAI', 'Claude', 'Gemini', 'Grok']

/**
 * Build CloudAIConfig from a flat key bag (OpenAI, Claude, Gemini, Grok, plus optional custom names).
 * Only vision providers are placed in `apiKeys`; preference is `auto` when any vision key exists.
 */
export function cloudConfigFromOptimandoApiKeysRecord(
  raw: Record<string, string> | null | undefined,
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
    preference: 'auto',
    useCloudForImages: true,
  }
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
