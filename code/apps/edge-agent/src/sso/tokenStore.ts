import type { RefreshTokenStore } from '@repo/sso'

import type { AgentStorage, AgentPersistedState } from '../storage.js'

export class AgentTokenStore implements RefreshTokenStore {
  constructor(private readonly storage: AgentStorage) {}

  async loadRefreshToken(): Promise<string | null> {
    const state = await this.storage.loadState()
    return state.refreshToken ?? null
  }

  async saveRefreshToken(refreshToken: string): Promise<void> {
    const state = await this.storage.loadState()
    await this.storage.saveState({ ...state, refreshToken })
  }

  async clearRefreshToken(): Promise<void> {
    const state = await this.storage.loadState()
    const { refreshToken: _removed, ...rest } = state
    await this.storage.saveState(rest as AgentPersistedState)
  }
}
