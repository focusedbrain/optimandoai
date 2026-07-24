/**
 * Mode-model warm-on-trigger — speech bubble or interval enable (batch-04 strategy B).
 * Strategy A also pre-warms the mode model with extended keep_alive when triggered.
 */

import { getModeById } from '../customModes/customModesStore'
import { getHandshakeDbForInternalInference } from '../internalInference/dbAccess'
import { isEffectiveSandboxNode } from '../sandbox/sandboxOutboundPolicy'
import { resolveAdaptiveWarmupStrategy } from './adaptiveWarmupStrategy'
import { resolveDeclaredLocalOllamaModel } from './resolveDeclaredModelAvailability'
import { warmModel } from './warmModel'

const L = '[WARMUP]'

export type ModeWarmTrigger = 'speech_bubble' | 'interval'

export function scheduleModeModelWarmOnTrigger(modeId: string, trigger: ModeWarmTrigger): void {
  const id = modeId?.trim()
  if (!id) return

  void runModeModelWarmOnTrigger(id, trigger).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(`${L} mode trigger error detail=${JSON.stringify(msg.slice(0, 160))}`)
  })
}

async function runModeModelWarmOnTrigger(modeId: string, trigger: ModeWarmTrigger): Promise<void> {
  const db = await getHandshakeDbForInternalInference()
  if (isEffectiveSandboxNode(db)) return

  const mode = getModeById(modeId)
  if (!mode) return

  const declaredModelId = mode.modelName?.trim()
  if (!declaredModelId) return

  /**
   * Warm the actually installed/active model, never a stale declared tag (e.g. Ollama-era
   * `gemma4:12b-it-q8_0` in old mode configs). `resolveDeclaredLocalOllamaModel` logs
   * `[MODEL_FALLBACK]` loudly when the declared tag is not installed.
   */
  const resolution = await resolveDeclaredLocalOllamaModel(declaredModelId, 'mode_warmup_trigger')
  if (!resolution.ok) {
    console.log(
      `${L} mode model=${declaredModelId} skipped reason=${resolution.reason} (trigger=${trigger})`,
    )
    return
  }
  const modelId = resolution.actualModel

  const strategy = await resolveAdaptiveWarmupStrategy()
  console.log(`${L} mode model=${modelId} warming (trigger=${trigger})`)

  const t0 = Date.now()
  const onDone = (result: Awaited<ReturnType<typeof warmModel>>) => {
    if (result.ok) {
      console.log(`${L} mode model=${modelId} warmed in ${Date.now() - t0}ms`)
    } else if (result.skippedReason) {
      console.log(`${L} mode model=${modelId} skipped reason=${result.skippedReason}`)
    }
  }

  if (strategy.kind === 'warm_on_trigger') {
    void warmModel(modelId).then(onDone)
    return
  }

  onDone(await warmModel(modelId))
}
