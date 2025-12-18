import { MiniApp, AtomicBlock, RuntimeState } from './types' // import types

// createRuntimeState: provides a small in-memory state with optional sessionStorage persistence
export function createRuntimeState(namespace?: string): { state: RuntimeState, set: (k:string,v:any)=>void, get:(k:string)=>any, persist:()=>void } {
  const state: RuntimeState = {} // in-memory state object
  const storageKey = namespace ? `beap_state_${namespace}` : undefined // sessionStorage key when namespace provided
  // load any persisted state from sessionStorage
  if (storageKey) {
    try {
      const raw = sessionStorage.getItem(storageKey) // read raw JSON
      if (raw) Object.assign(state, JSON.parse(raw)) // merge into in-memory state
    } catch {}
  }
  return {
    state, // expose state object
    set: (k, v) => { state[k] = v }, // simple setter
    get: (k) => state[k], // simple getter
    persist: () => {
      if (storageKey) {
        try { sessionStorage.setItem(storageKey, JSON.stringify(state)) } catch {} // persist to sessionStorage
      }
    }
  }
}

// assembleMiniApp: create a lightweight MiniApp wrapper with generated id
export function assembleMiniApp(blocks: AtomicBlock[]): MiniApp {
  return {
    id: 'ma_' + Math.random().toString(36).slice(2), // deterministic-ish short id
    blocks // included blocks
  }
}
