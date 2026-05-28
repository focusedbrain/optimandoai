import type { AgentStorage, AgentPersistedState } from './storage.js'

export async function markPaired(
  storage: AgentStorage,
  patch: Partial<AgentPersistedState>,
): Promise<void> {
  const prev = await storage.loadState()
  await storage.saveState({
    ...prev,
    ...patch,
    phase: 'paired',
  })
}
