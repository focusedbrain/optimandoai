import { MiniApp, AtomicBlock, RuntimeState } from './types'

export function createRuntimeState(namespace?: string): { state: RuntimeState, set: (k:string,v:any)=>void, get:(k:string)=>any, persist:()=>void } {
  const state: RuntimeState = {}
  const storageKey = namespace ? `beap_state_${namespace}` : undefined
  // load any persisted state
  if (storageKey) {
    try {
      const raw = sessionStorage.getItem(storageKey)
      if (raw) Object.assign(state, JSON.parse(raw))
    } catch {}
  }
  return {
    state,
    set: (k, v) => { state[k] = v },
    get: (k) => state[k],
    persist: () => {
      if (storageKey) {
        try { sessionStorage.setItem(storageKey, JSON.stringify(state)) } catch {}
      }
    }
  }
}

export function assembleMiniApp(blocks: AtomicBlock[]): MiniApp {
  return {
    id: 'ma_' + Math.random().toString(36).slice(2),
    blocks
  }
}
