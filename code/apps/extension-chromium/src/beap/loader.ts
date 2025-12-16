import { AtomicBlock } from './types'

// Attempt to load tier3 JSON blocks using multiple strategies.
// Primary strategy: try import.meta.glob (bundler-time). Fallback: window.__BEAP_TIER3_BLOCKS

export async function loadTier3Blocks(): Promise<AtomicBlock[]> {
  // Strategy A: import.meta.glob (Vite / bundlers)
  try {
    // @ts-ignore - import.meta may not be typed
    if (typeof (import.meta as any).glob === 'function') {
      const modules = (import.meta as any).glob('../../electron/main/miniapps/tier3/*.json', { eager: true, as: 'json' })
      const blocks: AtomicBlock[] = []
      for (const key in modules) {
        const mod = modules[key] as any
        if (Array.isArray(mod)) {
          mod.forEach((m: any) => blocks.push(m))
        } else if (mod && typeof mod === 'object') {
          blocks.push(mod as AtomicBlock)
        }
      }
      if (blocks.length) return blocks
    }
  } catch (e) {
    console.warn('[BEAP] import.meta.glob failed', e)
  }

  // Strategy B: runtime-provided global (the page or background can populate this)
  try {
    const g = (window as any).__BEAP_TIER3_BLOCKS
    if (Array.isArray(g)) return g as AtomicBlock[]
  } catch {}

  // Strategy C: try to fetch index.json under extension assets (best-effort)
  try {
    const base = (chrome && chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL('') : ''
    // You may place the tier3 files under extension assets at runtime
    // Best-effort: fetch a known index.json
    const idxUrl = base + 'miniapps/tier3/index.json'
    const r = await fetch(idxUrl)
    if (r.ok) {
      const list = await r.json()
      if (Array.isArray(list)) {
        const blocks: AtomicBlock[] = []
        await Promise.all(list.map(async (name: string) => {
          try {
            const fr = await fetch(base + 'miniapps/tier3/' + name)
            if (fr.ok) blocks.push(await fr.json())
          } catch (e) {}
        }))
        if (blocks.length) return blocks
      }
    }
  } catch (e) {
    console.warn('[BEAP] fetch index failed', e)
  }

  console.warn('[BEAP] No tier3 blocks found')
  return []
}
