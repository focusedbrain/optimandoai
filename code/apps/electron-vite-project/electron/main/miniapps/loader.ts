import * as fs from 'fs/promises'
import * as path from 'path'
import { fileURLToPath } from 'url'

// Resolve ESM dirname for this module
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// When bundled, this module is in dist-electron; when in dev, it's under electron/main/miniapps.
// Use project root one level above dist-electron (bundle) or main folder (dev), then point to electron/main/miniapps.
const PROJECT_ROOT = path.resolve(__dirname, '..')
const MINIAPPS_ROOT = path.resolve(PROJECT_ROOT, 'electron', 'main', 'miniapps')

type TierName = 'tier1' | 'tier2' | 'tier3'

async function loadTier(tier: TierName): Promise<any[]> {
  const tierDir = path.join(MINIAPPS_ROOT, tier)
  try {
    const entries = await fs.readdir(tierDir)
    const jsonFiles = entries.filter((f) => f.toLowerCase().endsWith('.json'))

    const results: any[] = []
    for (const file of jsonFiles) {
      const filePath = path.join(tierDir, file)
      try {
        const raw = await fs.readFile(filePath, 'utf-8')
        results.push(JSON.parse(raw))
      } catch (err) {
        console.error(`[MiniApps] Failed to load ${tier}/${file}:`, err)
      }
    }
    return results
  } catch (err) {
    console.error(`[MiniApps] Failed to read tier directory ${tierDir}:`, err)
    return []
  }
}

export async function loadTier1MiniApps(): Promise<any[]> {
  return loadTier('tier1')
}

export async function loadTier2MiniApps(): Promise<any[]> {
  return loadTier('tier2')
}

export async function loadTier3MiniApps(): Promise<any[]> {
  return loadTier('tier3')
}

export async function loadAllMiniApps(): Promise<{ tier1: any[]; tier2: any[]; tier3: any[] }> {
  const [tier1, tier2, tier3] = await Promise.all([
    loadTier1MiniApps(),
    loadTier2MiniApps(),
    loadTier3MiniApps()
  ])
  return { tier1, tier2, tier3 }
}
