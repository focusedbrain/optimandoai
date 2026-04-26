/**
 * When the orchestrator build stamp changes, drop stale Host AI list/probe/P2P state and
 * notify renderers to clear persisted Host-internal selections.
 */
import fs from 'fs'
import path from 'path'
import { closeAllP2pInferenceSessions, P2pSessionLogReason } from './p2pSession/p2pInferenceSessionManager'
import { clearHostAiListTransientStateForOrchestratorBuildChange } from './listInferenceTargets'
import { ollamaManager } from '../llm/ollama-manager'

const FILENAME = 'last-host-ai-orchestrator-build-stamp.txt'

export function runHostAiInvalidationIfOrchestratorBuildChanged(args: {
  userDataDir: string
  currentStamp: string
  broadcast: () => void
}): void {
  const stamp = String(args.currentStamp ?? '').trim() || 'unknown'
  const p = path.join(args.userDataDir, FILENAME)
  let prev = ''
  try {
    prev = fs.readFileSync(p, 'utf8').trim()
  } catch {
    prev = ''
  }
  if (prev === stamp) {
    return
  }
  try {
    fs.mkdirSync(args.userDataDir, { recursive: true })
    fs.writeFileSync(p, stamp, 'utf8')
  } catch {
    /* still run invalidation */
  }

  console.log(`[HOST_AI_BUILD] orchestrator_build_changed prev=${prev || '(none)'} now=${stamp}`)
  clearHostAiListTransientStateForOrchestratorBuildChange()
  closeAllP2pInferenceSessions(P2pSessionLogReason.orchestrator_build_changed)
  try {
    ollamaManager.invalidateModelsCache()
  } catch {
    /* ignore */
  }
  args.broadcast()
}
