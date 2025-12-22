import { MiniApp, AtomicBlock, RuntimeState } from './types' // import types

// createRuntimeState: provides a small in-memory state with optional sessionStorage persistence
export function createRuntimeState(namespace?: string, opts?: { persistToFile?: boolean }): { state: RuntimeState, set: (k:string,v:any)=>void, get:(k:string)=>any, persist:(key?:string)=>Promise<string|undefined> } {
  const state: RuntimeState = {} // in-memory state object
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

  return {
    state, // expose state object
    set: (k, v) => { state[k] = v }, // simple setter
    get: (k) => state[k], // simple getter
    persist // returns Promise<string|undefined> (file path, download token, or undefined)
  }
}

// assembleMiniApp: create a lightweight MiniApp wrapper with generated id
export function assembleMiniApp(blocks: AtomicBlock[]): MiniApp {
  return {
    id: 'ma_' + Math.random().toString(36).slice(2), // deterministic-ish short id
    blocks // included blocks
  }
}
