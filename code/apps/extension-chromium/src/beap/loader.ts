import { AtomicBlock, Component, MiniApp, BEAPRegistry } from './types'

const MINIAPPS_API_BASE = 'http://127.0.0.1:51248/api/miniapps'

async function fetchTier<T>(tier: 'tier1' | 'tier2' | 'tier3', label: string): Promise<T[]> {
  try {
    const r = await fetch(`${MINIAPPS_API_BASE}/${tier}`)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const body = await r.json()
    if (body && body.ok && Array.isArray(body.data)) {
      console.log(`[BEAP] ${label} loaded from API`, body.data.length)
      return body.data as T[]
    }
    console.warn(`[BEAP] ${label} API response missing data array`)
  } catch (e) {
    console.error(`[BEAP] ${label} API fetch failed`, e)
  }
  return []
}

export async function loadTier3Blocks(): Promise<AtomicBlock[]> {
  return fetchTier<AtomicBlock>('tier3', 'tier3 blocks')
}

export async function loadTier2Components(): Promise<Component[]> {
  return fetchTier<Component>('tier2', 'tier2 components')
}

export async function loadTier1MiniApps(): Promise<MiniApp[]> {
  return fetchTier<MiniApp>('tier1', 'tier1 mini-apps')
}

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

  tier3Blocks.forEach(block => {
    if (block && block.id) registry.tier3.set(block.id, block)
  })

  tier2Components.forEach(component => {
    if (component && component.id) registry.tier2.set(component.id, component)
  })

  tier1MiniApps.forEach(miniApp => {
    if (miniApp && miniApp.id) registry.tier1.set(miniApp.id, miniApp)
  })

  console.log('[BEAP] Loaded registry:', {
    tier3: registry.tier3.size,
    tier2: registry.tier2.size,
    tier1: registry.tier1.size
  })

  return registry
}
