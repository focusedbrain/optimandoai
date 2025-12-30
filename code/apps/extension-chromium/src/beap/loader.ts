import { AtomicBlock, Component, MiniApp, BEAPRegistry } from './types' // import type definitions

// loadTier3Blocks: robust loader using multiple fallback strategies
// Strategy A: bundler-time glob import via import.meta.glob (if available)
// Strategy B: runtime-injected global window.__BEAP_TIER3_BLOCKS
// Strategy C: fetch an index.json from extension assets as a best-effort
export async function loadTier3Blocks(): Promise<AtomicBlock[]> {
  // Strategy A: try bundler-time glob (works when files are included at build)
  try {
    // @ts-ignore - import.meta.glob typing may not be present in all environments
    if (typeof (import.meta as any).glob === 'function') {
      const modules = (import.meta as any).glob('../../electron/main/miniapps/tier3/*.json', { eager: true, as: 'json' }) // Vite glob
      const blocks: AtomicBlock[] = []
      for (const key in modules) {
        const mod = modules[key] as any
        if (Array.isArray(mod)) {
          mod.forEach((m: any) => blocks.push(m)) // module exported as array
        } else if (mod && typeof mod === 'object') {
          blocks.push(mod as AtomicBlock) // single-module export
        }
      }
      if (blocks.length) return blocks // return if found
    }
  } catch (e) {
    console.warn('[BEAP] import.meta.glob failed', e) // non-fatal
  }

  // Strategy B: runtime-provided global variable (injected by bootstrap or host)
  try {
    const g = (window as any).__BEAP_TIER3_BLOCKS
    if (Array.isArray(g)) return g as AtomicBlock[] // return if populated
  } catch {}

  // Strategy C: best-effort fetch from extension assets (index.json lists filenames)
  try {
    const base = (chrome && chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL('') : '' // extension base url
    // Best-effort: try to fetch an index file listing tier3 JSON filenames
    const idxUrl = base + 'miniapps/tier3/index.json'
    const r = await fetch(idxUrl)
    if (r.ok) {
      const list = await r.json()
      if (Array.isArray(list)) {
        const blocks: AtomicBlock[] = []
        await Promise.all(list.map(async (name: string) => {
          try {
            const fr = await fetch(base + 'miniapps/tier3/' + name)
            if (fr.ok) blocks.push(await fr.json()) // collect block
          } catch (e) {}
        }))
        if (blocks.length) return blocks // return if any fetched
      }
    }
  } catch (e) {
    console.warn('[BEAP] fetch index failed', e) // non-fatal fallback
  }

  console.warn('[BEAP] No tier3 blocks found') // final fallback warning
  return [] // return empty list when nothing found
}

// loadTier2Components: load tier2 components using similar strategy to tier3
export async function loadTier2Components(): Promise<Component[]> {
  // Strategy A: bundler-time glob
  try {
    // @ts-ignore
    if (typeof (import.meta as any).glob === 'function') {
      const modules = (import.meta as any).glob('../../electron/main/miniapps/tier2/*.json', { eager: true, as: 'json' })
      const components: Component[] = []
      for (const key in modules) {
        const mod = modules[key] as any
        if (Array.isArray(mod)) {
          mod.forEach((m: any) => components.push(m))
        } else if (mod && typeof mod === 'object') {
          components.push(mod as Component)
        }
      }
      if (components.length) return components
    }
  } catch (e) {
    console.warn('[BEAP] tier2 import.meta.glob failed', e)
  }

  // Strategy B: runtime-provided global
  try {
    const g = (window as any).__BEAP_TIER2_COMPONENTS
    if (Array.isArray(g)) return g as Component[]
  } catch {}

  // Strategy C: fetch from extension assets
  try {
    const base = (chrome && chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL('') : ''
    const idxUrl = base + 'miniapps/tier2/index.json'
    const r = await fetch(idxUrl)
    if (r.ok) {
      const list = await r.json()
      if (Array.isArray(list)) {
        const components: Component[] = []
        await Promise.all(list.map(async (name: string) => {
          try {
            const fr = await fetch(base + 'miniapps/tier2/' + name)
            if (fr.ok) components.push(await fr.json())
          } catch (e) {}
        }))
        if (components.length) return components
      }
    }
  } catch (e) {
    console.warn('[BEAP] tier2 fetch index failed', e)
  }

  console.warn('[BEAP] No tier2 components found')
  return []
}

// loadTier1MiniApps: load tier1 mini-apps using similar strategy
export async function loadTier1MiniApps(): Promise<MiniApp[]> {
  // Strategy A: bundler-time glob
  try {
    // @ts-ignore
    if (typeof (import.meta as any).glob === 'function') {
      const modules = (import.meta as any).glob('../../electron/main/miniapps/tier1/*.json', { eager: true, as: 'json' })
      const miniApps: MiniApp[] = []
      for (const key in modules) {
        const mod = modules[key] as any
        if (Array.isArray(mod)) {
          mod.forEach((m: any) => miniApps.push(m))
        } else if (mod && typeof mod === 'object') {
          miniApps.push(mod as MiniApp)
        }
      }
      if (miniApps.length) return miniApps
    }
  } catch (e) {
    console.warn('[BEAP] tier1 import.meta.glob failed', e)
  }

  // Strategy B: runtime-provided global
  try {
    const g = (window as any).__BEAP_TIER1_MINIAPPS
    if (Array.isArray(g)) return g as MiniApp[]
  } catch {}

  // Strategy C: fetch from extension assets
  try {
    const base = (chrome && chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL('') : ''
    const idxUrl = base + 'miniapps/tier1/index.json'
    const r = await fetch(idxUrl)
    if (r.ok) {
      const list = await r.json()
      if (Array.isArray(list)) {
        const miniApps: MiniApp[] = []
        await Promise.all(list.map(async (name: string) => {
          try {
            const fr = await fetch(base + 'miniapps/tier1/' + name)
            if (fr.ok) miniApps.push(await fr.json())
          } catch (e) {}
        }))
        if (miniApps.length) return miniApps
      }
    }
  } catch (e) {
    console.warn('[BEAP] tier1 fetch index failed', e)
  }

  console.warn('[BEAP] No tier1 mini-apps found')
  return []
}

// loadAllTiers: convenience function to load all tiers and build registry
export async function loadAllTiers(): Promise<BEAPRegistry> {
  const [tier3Blocks, tier2Components, tier1MiniApps] = await Promise.all([
    loadTier3Blocks(),
    loadTier2Components(),
    loadTier1MiniApps()
  ])

  const registry: BEAPRegistry = {
    tier3: new Map(),
    tier2: new Map(),
    tier1: new Map()
  }

  // Populate tier3 map - ensure we have an array
  if (Array.isArray(tier3Blocks) && tier3Blocks.length > 0) {
    tier3Blocks.forEach(block => {
      if (block && block.id) {
        registry.tier3.set(block.id, block)
      }
    })
  }
  
  // Populate tier2 map - ensure we have an array
  if (Array.isArray(tier2Components) && tier2Components.length > 0) {
    tier2Components.forEach(component => {
      if (component && component.id) {
        registry.tier2.set(component.id, component)
      }
    })
  }
  
  // Populate tier1 map - ensure we have an array
  if (Array.isArray(tier1MiniApps) && tier1MiniApps.length > 0) {
    tier1MiniApps.forEach(miniApp => {
      if (miniApp && miniApp.id) {
        registry.tier1.set(miniApp.id, miniApp)
      }
    })
  }

  console.log('[BEAP] Loaded registry:', {
    tier3: registry.tier3.size,
    tier2: registry.tier2.size,
    tier1: registry.tier1.size
  })

  return registry
}
