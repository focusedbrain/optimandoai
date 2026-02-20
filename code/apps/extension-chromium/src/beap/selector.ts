/**
 * BEAP Multi-Tier Selection Engine
 * 
 * Implements a production-ready selection algorithm using RELATIVE DOMINANCE
 * instead of static score thresholds. Ensures deterministic, predictable results
 * while preferring higher abstraction tiers when appropriate.
 */

import { AtomicBlock, Component, MiniApp, BEAPRegistry } from './types'

// ============================================================================
// TYPES
// ============================================================================

export type ScoredItem = {
  item: AtomicBlock | Component | MiniApp
  tier: 1 | 2 | 3
  score: number
}

export type NormalizedIntent = {
  intent: string
  features: string[]
  constraints: string[]
}

export type SelectionResult = {
  baseTier: 1 | 2 | 3
  selectedItems: ScoredItem[]
  resolvedBlocks: AtomicBlock[]
  stats: {
    tier1Count: number
    tier2Count: number
    tier3Count: number
    gapsFilled: number
    duplicatesRemoved: number
  }
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Minimum score to be considered (filters noise)
  MIN_FLOOR: 0.20,
  
  // Score gap required for base tier to be selected over next-best tier
  // For example: bestT1=0.50, bestT2=0.42 → gap=0.08 > 0.05 → select T1
  // Makes selection stable across all score ranges (scale-independent)
  MIN_BASE_GAP: 0.05,
  
  // Score gap threshold for Tier-2 multi-selection
  // For example: topT2=0.477, otherT2=0.410 → gap=0.067 > 0.05 → exclude
  // Includes all T2 components within this gap from the top score
  MAX_T2_GAP: 0.05,
  
  // Max blocks to select for Tier-3 fallback
  T3_MAX_BLOCKS: 5
} as const

// ============================================================================
// STAGE 1: SPLIT BY TIER
// ============================================================================

type TierSplit = {
  tier1: ScoredItem[]
  tier2: ScoredItem[]
  tier3: ScoredItem[]
}

export function splitByTier(scored: ScoredItem[]): TierSplit {
  const tier1: ScoredItem[] = []
  const tier2: ScoredItem[] = []
  const tier3: ScoredItem[] = []
  
  for (const item of scored) {
    if (item.tier === 1) tier1.push(item)
    else if (item.tier === 2) tier2.push(item)
    else if (item.tier === 3) tier3.push(item)
  }
  
  // Ensure each tier is sorted descending by score
  tier1.sort((a, b) => b.score - a.score)
  tier2.sort((a, b) => b.score - a.score)
  tier3.sort((a, b) => b.score - a.score)
  
  return { tier1, tier2, tier3 }
}

// ============================================================================
// STAGE 2: SCORE GAP-BASED BASE TIER DECISION
// ============================================================================

export function decideBaseTier(split: TierSplit): 1 | 2 | 3 {
  const bestT1 = split.tier1.length > 0 ? split.tier1[0].score : 0
  const bestT2 = split.tier2.length > 0 ? split.tier2[0].score : 0
  const bestT3 = split.tier3.length > 0 ? split.tier3[0].score : 0
  
  // Determine which tier has the highest score
  const highestScore = Math.max(bestT1, bestT2, bestT3)
  
  // If all scores are below floor, fallback to Tier-3
  if (highestScore < CONFIG.MIN_FLOOR) {
    return 3
  }
  
  // Compute gaps from the highest score tier to the next best tier
  if (bestT1 === highestScore && bestT1 > CONFIG.MIN_FLOOR) {
    // Tier-1 has highest score
    // Check gap to next best tier (T2 or T3)
    const nextBestScore = Math.max(bestT2, bestT3)
    const gap = bestT1 - nextBestScore
    
    if (gap >= CONFIG.MIN_BASE_GAP) {
      return 1
    }
  }
  
  if (bestT2 === highestScore && bestT2 > CONFIG.MIN_FLOOR) {
    // Tier-2 has highest score
    // Check gap to Tier-3
    const gap = bestT2 - bestT3
    
    if (gap >= CONFIG.MIN_BASE_GAP) {
      return 2
    }
  }
  
  // No clear separation, fallback to Tier-3
  return 3
}

// ============================================================================
// STAGE 3: BASE BLOCK SELECTION
// ============================================================================

export function selectBaseBlocks(
  baseTier: 1 | 2 | 3,
  split: TierSplit
): ScoredItem[] {
  if (baseTier === 1) {
    // Tier-1: Select ONLY top mini-app
    return split.tier1.length > 0 ? [split.tier1[0]] : []
  }
  
  if (baseTier === 2) {
    // Tier-2: Multi-select all within score gap of top score
    const tier2 = split.tier2
    if (tier2.length === 0) return []
    
    const topScore = tier2[0].score
    
    // Include all components where (topScore - componentScore) <= MAX_T2_GAP
    return tier2.filter(item => {
      const gap = topScore - item.score
      return gap <= CONFIG.MAX_T2_GAP
    })
  }
  
  // Tier-3: Select top N blocks
  return split.tier3.slice(0, CONFIG.T3_MAX_BLOCKS)
}

// ============================================================================
// STAGE 4: DOWNWARD EXPANSION
// ============================================================================

export function expandDownward(
  selectedItems: ScoredItem[],
  registry: BEAPRegistry
): AtomicBlock[] {
  const resolvedBlocks: AtomicBlock[] = []
  
  for (const item of selectedItems) {
    if (item.tier === 1) {
      // Tier-1 → Tier-2 → Tier-3
      const miniApp = item.item as MiniApp
      const tier1Blocks = resolveTier1Dependencies(miniApp, registry)
      resolvedBlocks.push(...tier1Blocks)
    } else if (item.tier === 2) {
      // Tier-2 → Tier-3
      const component = item.item as Component
      const tier2Blocks = resolveTier2Dependencies(component, registry)
      resolvedBlocks.push(...tier2Blocks)
    } else {
      // Tier-3: Already atomic
      resolvedBlocks.push(item.item as AtomicBlock)
    }
  }
  
  return resolvedBlocks
}

function resolveTier1Dependencies(
  miniApp: MiniApp,
  registry: BEAPRegistry
): AtomicBlock[] {
  const blocks: AtomicBlock[] = []
  
  for (let index = 0; index < miniApp.components.length; index++) {
    const componentId = miniApp.components[index]
    const component = registry.tier2.get(componentId)
    
    if (!component) {
      console.warn(`[Selector] Tier-1 references missing Tier-2: ${componentId}`)
      continue
    }
    
    // Create namespace for component instance
    const namespace = `${componentId}[${index}]`
    
    // Clone and apply mini-app bindings
    const clonedComponent: Component = JSON.parse(JSON.stringify(component))
    
    if (!clonedComponent.state) {
      clonedComponent.state = {}
    }
    
    // Apply mini-app bindings to component
    if (miniApp.bindings && miniApp.bindings[componentId]) {
      Object.assign(clonedComponent.state, miniApp.bindings[componentId])
    }
    
    // Resolve component to Tier-3 blocks
    const componentBlocks = resolveTier2Dependencies(clonedComponent, registry, namespace)
    blocks.push(...componentBlocks)
  }
  
  return blocks
}

function resolveTier2Dependencies(
  component: Component,
  registry: BEAPRegistry,
  namespace?: string
): AtomicBlock[] {
  const blocks: AtomicBlock[] = []
  
  for (const blockId of component.blocks) {
    const block = registry.tier3.get(blockId)
    
    if (!block) {
      console.warn(`[Selector] Tier-2 references missing Tier-3: ${blockId}`)
      continue
    }
    
    // Clone block and apply component bindings
    const clonedBlock: AtomicBlock = JSON.parse(JSON.stringify(block))
    
    // Apply bindings from component to block
    if (component.bindings && component.bindings[blockId]) {
      const bindings = component.bindings[blockId]
      if (clonedBlock.ui) {
        Object.assign(clonedBlock.ui, bindings)
      }
    }
    
    // Merge component behaviour into block behaviour
    if (component.behaviour) {
      if (!clonedBlock.behaviour) clonedBlock.behaviour = {}
      Object.assign(clonedBlock.behaviour, component.behaviour)
    }
    
    // Interpolate state bindings
    if (component.state) {
      interpolateStateBindings(clonedBlock, component.state, namespace)
    }
    
    blocks.push(clonedBlock)
  }
  
  return blocks
}

function interpolateStateBindings(
  block: AtomicBlock,
  state: Record<string, any>,
  namespace?: string
): void {
  if (!block.ui) return
  
  // Interpolate all UI string properties
  for (const prop in block.ui) {
    const value: any = (block.ui as any)[prop]
    if (typeof value === 'string' && value.startsWith('{{state.') && value.endsWith('}}')) {
      const stateKey = value.slice(8, -2) // extract key from {{state.key}}
      const resolvedKey = namespace ? `${namespace}.${stateKey}` : stateKey
      if (!block.ui.props) block.ui.props = {}
      block.ui.props.stateKey = resolvedKey
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

// ============================================================================
// STAGE 5: CAPABILITY GAP FILL
// ============================================================================

export type ScoredBlock = ScoredItem

/**
 * Normalize a capability/feature string for stable matching.
 *
 * We intentionally keep matching strict: a feature is satisfied only when it
 * exactly matches one of the strings in `block.provides` after normalization.
 *
 * (Synonyms/rewrites belong in the intent normalizer and/or in the library
 * data, not in selector logic.)
 */
function normalizeCapability(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Deterministically finds the highest-scoring Tier-3 provider block for a feature.
 *
 * - Only searches Tier-3 scored blocks (caller supplies Tier-3 list)
 * - Prefers higher score
 * - Tie-break: lexicographically smallest block id (stable/deterministic)
 *
 * Why Tier-3 only?
 * - Stages 2–4 already decide the base tier and expand Tier-1/Tier-2 downward.
 * - Stage 5 is only for filling missing capabilities with the smallest units
 *   (atomic blocks) so the system stays composable and scalable.
 */
export function findBestProvider(feature: string, tier3: ScoredBlock[]): ScoredBlock | null {
  const wanted = normalizeCapability(feature)
  if (!wanted) return null

  let best: ScoredBlock | null = null

  for (const scored of tier3) {
    const block = scored.item as AtomicBlock
    const provides = block.provides
    if (!provides || provides.length === 0) continue

    const matches = provides.some(p => normalizeCapability(p) === wanted)
    if (!matches) continue

    if (!best) {
      best = scored
      continue
    }

    if (scored.score > best.score) {
      best = scored
      continue
    }

    if (scored.score === best.score) {
      const currentId = (block.id || '').toLowerCase()
      const bestBlock = best.item as AtomicBlock
      const bestId = (bestBlock.id || '').toLowerCase()
      if (currentId && bestId && currentId < bestId) {
        best = scored
      }
    }
  }

  return best
}

/**
 * Ensures that the selected blocks have the necessary capabilities to support the intent's features.
 * If any required capabilities are missing, attempts to fill gaps by adding relevant Tier-3 blocks.
 */
export function ensureCapabilities(
  blocks: AtomicBlock[],
  intent: NormalizedIntent,
  split: TierSplit
): { blocks: AtomicBlock[], gapsFilled: number } {
  const provided = new Set<string>()

  // Build a set of capabilities already present in the current selection.
  // If any selected block provides a feature, we treat it as satisfied.
  for (const block of blocks) {
    for (const cap of block.provides || []) {
      const normalized = normalizeCapability(cap)
      if (normalized) provided.add(normalized)
    }
  }

  let gapsFilled = 0
  const filledBlocks = [...blocks]
  
  // Check each feature in intent
  for (const feature of intent.features) {
    const wanted = normalizeCapability(feature)
    if (!wanted) continue

    // Feature already satisfied by currently selected blocks.
    if (provided.has(wanted)) continue

    // Gap fill:
    // - deterministically select the highest-scoring Tier-3 block that provides
    //   the missing feature (using precomputed scores)
    // - if no provider exists, do nothing (fail gracefully)
    const candidate = findBestProvider(wanted, split.tier3)
    if (!candidate) continue

    const block = candidate.item as AtomicBlock

    // Clone before adding to avoid mutating the registry instance downstream
    // (e.g., interpolation writes to `ui.props.stateKey`).
    filledBlocks.push(JSON.parse(JSON.stringify(block)))

    // Mark any capabilities this new block provides as satisfied.
    for (const cap of block.provides || []) {
      const normalized = normalizeCapability(cap)
      if (normalized) provided.add(normalized)
    }
    gapsFilled++
    console.log(`[Selector] Gap-fill: Added ${block.id} for feature "${feature}" (score=${candidate.score.toFixed(3)})`)
  }
  
  return { blocks: filledBlocks, gapsFilled }
}

// ============================================================================
// STAGE 6: FILTER & CLEANUP
// ============================================================================

export function filterBlocks(
  blocks: AtomicBlock[],
  constraints: string[]
): { blocks: AtomicBlock[], duplicatesRemoved: number } {
  // Rule 1: single_functionality constraint
  if (constraints.includes('single_functionality')) {
    return {
      blocks: blocks.length > 0 ? [blocks[0]] : [],
      duplicatesRemoved: Math.max(0, blocks.length - 1)
    }
  }
  
  // Rule 2: Keep only highest scoring block per group
  const groupMap = new Map<string, AtomicBlock>()
  
  for (const block of blocks) {
    const group = block.group || 'unknown'
    
    if (!groupMap.has(group)) {
      groupMap.set(group, block)
    }
    // If duplicate group, keep the first (already sorted by score via expansion order)
  }
  
  const uniqueBlocks = Array.from(groupMap.values())
  const duplicatesRemoved = blocks.length - uniqueBlocks.length
  
  return { blocks: uniqueBlocks, duplicatesRemoved }
}

// ============================================================================
// MAIN SELECTOR
// ============================================================================

export function selectMiniApp(
  scored: ScoredItem[],
  intent: NormalizedIntent,
  registry: BEAPRegistry
): SelectionResult {
  // Stage 1: Split by tier
  const split = splitByTier(scored)
  // Stage 2: Decide base tier using score gap logic
  const baseTier = decideBaseTier(split)
  // Stage 3: Select base blocks
  const selectedItems = selectBaseBlocks(baseTier, split)
  // Stage 4: Expand downward
  let resolvedBlocks = expandDownward(selectedItems, registry)
  // Stage 5: Ensure capabilities (gap fill)
  const gapResult = ensureCapabilities(resolvedBlocks, intent, split)
  resolvedBlocks = gapResult.blocks
  // Stage 6: Filter & cleanup
  const filterResult = filterBlocks(resolvedBlocks, intent.constraints)
  resolvedBlocks = filterResult.blocks
  
  // Final stats
  const stats = {
    tier1Count: split.tier1.length,
    tier2Count: split.tier2.length,
    tier3Count: split.tier3.length,
    gapsFilled: gapResult.gapsFilled,
    duplicatesRemoved: filterResult.duplicatesRemoved
  }
  
  return {
    baseTier,
    selectedItems,
    resolvedBlocks,
    stats
  }
}
