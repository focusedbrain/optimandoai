/**
 * Resolves {@link AiExecutionContext} for inbox and other main-process LLM callers.
 *
 * Order: persisted selector snapshot → first LAN `ollama_direct` row → first BEAP-ready row → local tags.
 */

import { getSandboxOllamaDirectRouteCandidate } from '../internalInference/sandboxHostAiOllamaDirectCandidate'
import { listSandboxHostInternalInferenceTargets } from '../internalInference/listInferenceTargets'
import { getHandshakeDbForInternalInference } from '../internalInference/dbAccess'
import { getHostAiLedgerRoleSummaryFromDb } from '../internalInference/hostAiEffectiveRole'
import { getInstanceId, getOrchestratorMode, isSandboxMode } from '../orchestrator/orchestratorModeStore'
import { ollamaManager } from './ollama-manager'
import type { AiExecutionContext, ResolveAiExecutionContextResult } from './aiExecutionTypes'
import { readStoredAiExecutionContext } from './aiExecutionContextStore'

export const NO_AI_MODEL_SELECTED = 'No AI model selected'

function enrichOllamaDirectBase(ctx: AiExecutionContext): AiExecutionContext {
  if (ctx.lane !== 'ollama_direct') return ctx
  const hid = ctx.handshakeId?.trim()
  if (!hid) return ctx
  const cand = getSandboxOllamaDirectRouteCandidate(hid)
  const base = typeof cand?.base_url === 'string' ? cand.base_url.trim().replace(/\/$/, '') : ''
  const peer =
    typeof cand?.peer_host_device_id === 'string' && cand.peer_host_device_id.trim()
      ? cand.peer_host_device_id.trim()
      : ctx.peerDeviceId
  if (!base) return { ...ctx, peerDeviceId: peer }
  return { ...ctx, baseUrl: base, peerDeviceId: peer }
}

function rowModelName(m: { model: string | null; model_id: string | null }): string {
  const a = String(m.model ?? '').trim()
  if (a && a !== 'checking' && a !== 'unavailable') return a
  const b = String(m.model_id ?? '').trim()
  return b
}

async function fallbackFromListSandbox(): Promise<AiExecutionContext | null> {
  const { targets } = await listSandboxHostInternalInferenceTargets()
  const visible = (t: (typeof targets)[0]) => t.visibleInModelSelector !== false

  const odl = targets.filter(
    (t) =>
      t.execution_transport === 'ollama_direct' &&
      visible(t) &&
      rowModelName(t) &&
      String(t.handshake_id ?? '').trim(),
  )
  if (odl.length > 0) {
    const t = odl[0]!
    const model = rowModelName(t)
    const models = [
      ...new Set(
        targets
          .filter((x) => x.handshake_id === t.handshake_id && rowModelName(x))
          .map((x) => rowModelName(x)),
      ),
    ]
    let ctx: AiExecutionContext = {
      lane: 'ollama_direct',
      model,
      handshakeId: t.handshake_id,
      peerDeviceId: t.host_device_id,
      ollamaDirectReady: t.ollamaDirectReady ?? true,
      beapReady: t.beapReady,
      models: models.length ? models : undefined,
    }
    ctx = enrichOllamaDirectBase(ctx)
    return ctx
  }

  const beap = targets.filter(
    (t) =>
      t.beapReady === true &&
      t.canChat === true &&
      visible(t) &&
      rowModelName(t) &&
      String(t.handshake_id ?? '').trim(),
  )
  if (beap.length > 0) {
    const t = beap[0]!
    const model = rowModelName(t)
    return {
      lane: 'beap',
      model,
      handshakeId: t.handshake_id,
      peerDeviceId: t.host_device_id,
      beapReady: true,
      ollamaDirectReady: t.ollamaDirectReady,
    }
  }

  return null
}

async function tryLocalContext(): Promise<AiExecutionContext | null> {
  const name = await ollamaManager.getEffectiveChatModelName()
  if (!name) return null
  return {
    lane: 'local',
    model: name,
    baseUrl: 'http://127.0.0.1:11434',
  }
}

/**
 * Persisted `orchestrator-mode.json` can disagree with handshake-derived roles (ledger is authoritative
 * for Host AI — mirrors `shouldApplySandboxOllamaInferenceRouting` in `chatWithContextRagOllamaGeneration.ts`).
 */
export async function isEffectiveSandboxSideForAiExecution(): Promise<boolean> {
  if (isSandboxMode()) return true
  const db = await getHandshakeDbForInternalInference()
  const om = getOrchestratorMode()
  const summary = getHostAiLedgerRoleSummaryFromDb(db, getInstanceId().trim(), String(om.mode))
  return summary.can_probe_host_endpoint
}

export async function resolveAiExecutionContextForLlm(): Promise<ResolveAiExecutionContextResult> {
  const stored = readStoredAiExecutionContext()

  if (stored && stored.model) {
    let ctx = stored
    if (ctx.lane === 'ollama_direct') {
      ctx = enrichOllamaDirectBase(ctx)
    }

    if (!(await isEffectiveSandboxSideForAiExecution())) {
      if (ctx.lane === 'ollama_direct' || ctx.lane === 'beap') {
        const local = await tryLocalContext()
        if (local) return { ok: true, ctx: local }
        return { ok: false, error: NO_AI_MODEL_SELECTED }
      }
      return { ok: true, ctx: { ...ctx, baseUrl: ctx.baseUrl ?? 'http://127.0.0.1:11434' } }
    }

    if (ctx.lane === 'ollama_direct' || ctx.lane === 'beap') {
      if (!ctx.handshakeId?.trim()) {
        const fb = await fallbackFromListSandbox()
        if (fb) return { ok: true, ctx: fb }
        const local = await tryLocalContext()
        if (local) return { ok: true, ctx: local }
        return { ok: false, error: NO_AI_MODEL_SELECTED }
      }
      return { ok: true, ctx }
    }

    return { ok: true, ctx: { ...ctx, baseUrl: ctx.baseUrl ?? 'http://127.0.0.1:11434' } }
  }

  if (await isEffectiveSandboxSideForAiExecution()) {
    const fb = await fallbackFromListSandbox()
    if (fb) return { ok: true, ctx: fb }
  }

  const local = await tryLocalContext()
  if (local) return { ok: true, ctx: local }

  return { ok: false, error: NO_AI_MODEL_SELECTED }
}
