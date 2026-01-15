import { MiniApp, AtomicBlock, RuntimeState, Component, BEAPRegistry } from './types' // import types

// interpolateStateBindings: resolves {{state.key}} patterns in UI properties using provided state
function interpolateStateBindings(block: AtomicBlock, state: Record<string, any>, namespace?: string): void {
  if (!block.ui) return
  
  // Interpolate all UI string properties
  for (const prop in block.ui) {
    const value: any = (block.ui as any)[prop]
    if (typeof value === 'string' && value.startsWith('{{state.') && value.endsWith('}}')) {
      const stateKey = value.slice(8, -2) // extract key from {{state.key}}
      if (state[stateKey] !== undefined) {
        (block.ui as any)[prop] = state[stateKey]
      }
    }
  }
  
  // If namespace provided, update behaviour state keys to use namespaced references
  if (namespace && block.behaviour) {
    for (const eventKey in block.behaviour) {
      const action = block.behaviour[eventKey]
      if (action && typeof action === 'object') {
        // Update state keys to be namespaced
        if (action.key && !action.key.includes('.')) {
          action.key = `${namespace}.${action.key}`
        }
        if (action.source && !action.source.includes('.')) {
          action.source = `${namespace}.${action.source}`
        }
      }
    }
  }
}

// createRuntimeState: provides a small in-memory state with optional sessionStorage persistence
export function createRuntimeState(namespace?: string, opts?: { persistToFile?: boolean }): { 
  state: RuntimeState, 
  set: (k:string,v:any)=>void, 
  get:(k:string)=>any, 
  persist:(key?:string)=>Promise<string|undefined>, 
  increment:(k:string)=>void,
  subscribe:(key:string,listener:(value:any)=>void)=>void,
  unsubscribe:(key:string,listener:(value:any)=>void)=>void
} {
  const state: RuntimeState = {} // in-memory state object
  const listeners: Map<string, Set<(value:any)=>void>> = new Map() // state change listeners
  const storageKey = namespace ? `beap_state_${namespace}` : undefined // sessionStorage key when namespace provided
  const fileName = namespace ? `beap_state_${namespace}.json` : `beap_state.json`
  let tempFilePath: string | undefined

  // try to detect Node / Electron filesystem APIs via dynamic require
  let fs: any = undefined
  try {
    const req = (globalThis as any).require
    if (typeof req === 'function') {
      const os = req('os')
      const path = req('path')
      fs = req('fs')
      tempFilePath = path.join(os.tmpdir(), fileName)
      // if file exists, load into state
      try {
        if (fs.existsSync(tempFilePath)) {
          const raw = fs.readFileSync(tempFilePath, 'utf8')
          if (raw) Object.assign(state, JSON.parse(raw))
        }
      } catch {}
    }
  } catch {}

  // fallback: load any persisted state from sessionStorage
  if (storageKey) {
    try {
      const raw = sessionStorage.getItem(storageKey) // read raw JSON
      if (raw) Object.assign(state, JSON.parse(raw)) // merge into in-memory state
    } catch {}
  }

  // persist: writes to sessionStorage and optionally to a temp file (Node) or triggers a download (browser)
  async function persist(key?: string): Promise<string|undefined> {
    // always update sessionStorage when available
    if (storageKey) {
      try { sessionStorage.setItem(storageKey, JSON.stringify(state)) } catch {}
    }

    if (opts && opts.persistToFile) {
      // Node/Electron path
      if (fs && tempFilePath) {
        try {
          if (key) {
            // write single key as plain text with .txt extension
            const path = (globalThis as any).require('path')
            const txtPath = path.join((globalThis as any).require('os').tmpdir(), `${namespace || 'beap_state'}_${key}.txt`)
            const val = state[key]
            const out = typeof val === 'string' ? val : JSON.stringify(val)
            fs.writeFileSync(txtPath, out, 'utf8')
            return txtPath
          } else {
            fs.writeFileSync(tempFilePath, JSON.stringify(state), 'utf8')
            return tempFilePath
          }
        } catch (e) {
          // fallthrough to browser fallback if writing fails
        }
      }

      // Browser fallback: trigger download and return a download token (no real path available in browser)
      try {
        if (key) {
          const val = state[key]
          const out = typeof val === 'string' ? val : JSON.stringify(val)
          const blob = new Blob([out], { type: 'text/plain' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `${namespace || 'beap_state'}_${key}.txt`
          document.body.appendChild(a)
          a.click()
          a.remove()
          URL.revokeObjectURL(url)
          return `download:${namespace || 'beap_state'}_${key}.txt`
        } else {
          const blob = new Blob([JSON.stringify(state)], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = fileName
          document.body.appendChild(a)
          a.click()
          a.remove()
          URL.revokeObjectURL(url)
          return `download:${fileName}`
        }
      } catch {}
    }

    return undefined
  }

  // increment: increment a numeric state value
  function increment(k: string) {
    const current = state[k]
    if (typeof current === 'number') {
      state[k] = current + 1
    } else {
      state[k] = 1 // initialize to 1 if not a number
    }
  }

  // subscribe: register a listener for state changes
  function subscribe(key: string, listener: (value:any)=>void) {
    if (!listeners.has(key)) {
      listeners.set(key, new Set())
    }
    listeners.get(key)!.add(listener)
  }
  
  // unsubscribe: remove a listener
  function unsubscribe(key: string, listener: (value:any)=>void) {
    const keyListeners = listeners.get(key)
    if (keyListeners) {
      keyListeners.delete(listener)
    }
  }
  
  // notifyListeners: trigger all listeners for a state key
  function notifyListeners(key: string, value: any) {
    const keyListeners = listeners.get(key)
    if (keyListeners) {
      keyListeners.forEach(listener => {
        try {
          listener(value)
        } catch (e) {
          console.error(`[BEAP] Error in state listener for key "${key}":`, e)
        }
      })
    }
  }

  return {
    state, // expose state object
    set: (k, v) => { 
      state[k] = v
      notifyListeners(k, v) // notify listeners of change
    },
    get: (k) => state[k], // simple getter
    persist, // returns Promise<string|undefined> (file path, download token, or undefined)
    increment: (k) => {
      const current = state[k]
      const newValue = typeof current === 'number' ? current + 1 : 1
      state[k] = newValue
      notifyListeners(k, newValue) // notify listeners of change
    },
    subscribe, // register state change listener
    unsubscribe // remove state change listener
  }
}

// assembleMiniApp: create a lightweight MiniApp wrapper with generated id (for backward compatibility with old Tier3-only flow)
export function assembleMiniApp(blocks: AtomicBlock[]): { id: string, blocks: AtomicBlock[] } {
  return {
    id: 'ma_' + Math.random().toString(36).slice(2), // deterministic-ish short id
    blocks // included blocks
  }
}

// resolveComponent: resolve a tier2 component into its constituent tier3 blocks
export function resolveComponent(component: Component, registry: BEAPRegistry, namespace?: string): AtomicBlock[] {
  const resolved: AtomicBlock[] = []
  
  component.blocks.forEach(blockId => {
    const block = registry.tier3.get(blockId)
    if (block) {
      // Clone the block and apply component bindings
      const clonedBlock: AtomicBlock = JSON.parse(JSON.stringify(block))
      
      // Apply bindings from component to block
      if (component.bindings && component.bindings[blockId]) {
        const bindings = component.bindings[blockId]
        if (clonedBlock.ui) {
          // Merge bindings into UI properties
          Object.assign(clonedBlock.ui, bindings)
        }
      }
      
      // Merge component behaviour into block behaviour
      if (component.behaviour) {
        if (!clonedBlock.behaviour) clonedBlock.behaviour = {}
        Object.assign(clonedBlock.behaviour, component.behaviour)
      }
      
      // CRITICAL FIX #1: Interpolate {{state.key}} patterns using component state
      if (component.state) {
        interpolateStateBindings(clonedBlock, component.state, namespace)
      }
      
      resolved.push(clonedBlock)
    } else {
      console.warn(`[BEAP] Block not found in registry: ${blockId}`)
    }
  })
  
  return resolved
}

// resolveMiniApp: resolve a tier1 mini-app into its constituent tier3 blocks via tier2 components
export function resolveMiniApp(miniApp: MiniApp, registry: BEAPRegistry): AtomicBlock[] {
  const resolved: AtomicBlock[] = []
  
  miniApp.components.forEach((componentId, index) => {
    const component = registry.tier2.get(componentId)
    if (component) {
      // Clone component and apply mini-app bindings
      const clonedComponent: Component = JSON.parse(JSON.stringify(component))
      
      // CRITICAL FIX #2: Create namespace for component instance to prevent state collisions
      const namespace = `${componentId}[${index}]`
      
      // Initialize component state if not present
      if (!clonedComponent.state) {
        clonedComponent.state = {}
      }
      
      // Apply bindings from mini-app to component
      // Support both array-style (component[0]) and direct component id bindings
      const bindingKey = namespace
      const bindings = miniApp.bindings?.[bindingKey] || miniApp.bindings?.[componentId]
      
      if (bindings) {
        // Parse {{state.key}} patterns and replace with actual values from mini-app state
        for (const key in bindings) {
          const value = bindings[key]
          if (typeof value === 'string' && value.startsWith('{{state.') && value.endsWith('}}')) {
            const stateKey = value.slice(8, -2) // extract key from {{state.key}}
            if (miniApp.state && miniApp.state[stateKey] !== undefined) {
              clonedComponent.state[key] = miniApp.state[stateKey]
            }
          } else {
            clonedComponent.state[key] = value
          }
        }
      }
      
      // Resolve component to blocks with namespace for state isolation
      const blocks = resolveComponent(clonedComponent, registry, namespace)
      
      resolved.push(...blocks)
    } else {
      console.warn(`[BEAP] Component not found in registry: ${componentId}`)
    }
  })
  
  return resolved
}
