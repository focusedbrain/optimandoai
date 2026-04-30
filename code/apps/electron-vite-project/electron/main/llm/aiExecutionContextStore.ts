/**
 * Persists {@link AiExecutionContext} from the model selector (Sandbox + Host) under userData.
 */

import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type { AiExecutionContext, AiExecutionContextInput, AiExecutionLane } from './aiExecutionTypes'

const FILE_NAME = 'ai-execution-context.json'

function storePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

function isLane(v: unknown): v is AiExecutionLane {
  return v === 'local' || v === 'ollama_direct' || v === 'beap'
}

export function normalizeAiExecutionContextInput(raw: AiExecutionContextInput): AiExecutionContext | null {
  if (!raw || typeof raw !== 'object') return null
  const lane = (raw as AiExecutionContextInput).lane
  if (!isLane(lane)) return null
  const model = typeof raw.model === 'string' ? raw.model.trim() : ''
  if (!model) return null
  const baseUrl =
    typeof raw.baseUrl === 'string' && raw.baseUrl.trim() ? raw.baseUrl.trim().replace(/\/$/, '') : undefined
  const handshakeId =
    typeof raw.handshakeId === 'string' && raw.handshakeId.trim() ? raw.handshakeId.trim() : undefined
  const peerDeviceId =
    typeof raw.peerDeviceId === 'string' && raw.peerDeviceId.trim() ? raw.peerDeviceId.trim() : undefined
  const models = Array.isArray(raw.models)
    ? raw.models.map((m) => String(m).trim()).filter(Boolean)
    : undefined
  return {
    lane,
    model,
    baseUrl,
    handshakeId,
    peerDeviceId,
    beapReady: typeof raw.beapReady === 'boolean' ? raw.beapReady : undefined,
    ollamaDirectReady: typeof raw.ollamaDirectReady === 'boolean' ? raw.ollamaDirectReady : undefined,
    models: models?.length ? [...new Set(models)] : undefined,
    selectionSource: raw.selectionSource === 'user' ? 'user' : undefined,
  }
}

export function readStoredAiExecutionContext(): AiExecutionContext | null {
  try {
    const p = storePath()
    if (!fs.existsSync(p)) return null
    const j = JSON.parse(fs.readFileSync(p, 'utf-8')) as unknown
    if (!j || typeof j !== 'object') return null
    const o = j as Record<string, unknown>
    return normalizeAiExecutionContextInput({
      lane: o.lane as AiExecutionLane,
      model: typeof o.model === 'string' ? o.model : '',
      baseUrl: typeof o.baseUrl === 'string' ? o.baseUrl : undefined,
      handshakeId: typeof o.handshakeId === 'string' ? o.handshakeId : undefined,
      peerDeviceId: typeof o.peerDeviceId === 'string' ? o.peerDeviceId : undefined,
      beapReady: typeof o.beapReady === 'boolean' ? o.beapReady : undefined,
      ollamaDirectReady: typeof o.ollamaDirectReady === 'boolean' ? o.ollamaDirectReady : undefined,
      models: Array.isArray(o.models) ? (o.models as unknown[]).map((x) => String(x)) : undefined,
      selectionSource: o.selectionSource === 'user' ? 'user' : undefined,
    })
  } catch (e) {
    console.warn('[AiExecutionContext] read failed:', e)
    return null
  }
}

export function writeStoredAiExecutionContext(ctx: AiExecutionContext): void {
  const p = storePath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const payload = JSON.stringify(
    {
      ...ctx,
        selectionSource: ctx.selectionSource ?? 'user',
      updatedAt: new Date().toISOString(),
    },
    null,
    2,
  )
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(tmp, payload, 'utf-8')
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p)
    } catch {
      /* ignore */
    }
    fs.renameSync(tmp, p)
  } finally {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
    } catch {
      /* ignore */
    }
  }
}

export function clearStoredAiExecutionContext(): void {
  try {
    const p = storePath()
    if (fs.existsSync(p)) fs.unlinkSync(p)
  } catch {
    /* ignore */
  }
}
