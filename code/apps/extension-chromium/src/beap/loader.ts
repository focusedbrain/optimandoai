import { AtomicBlock } from './types' // import block type definitions

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
