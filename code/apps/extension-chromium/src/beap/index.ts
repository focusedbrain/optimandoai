import { loadTier3Blocks, loadTier2Components, loadTier1MiniApps, loadAllTiers } from './loader' // loader to obtain all tiers
import { textToTensor, cosineSimilarity } from './embedding' // embedding utilities
import { assembleMiniApp, resolveMiniApp, resolveComponent } from './runtime' // assemble selected blocks into MiniApp
import { renderMiniApp } from './renderer' // render a MiniApp to HTMLElement
import * as tf from '@tensorflow/tfjs' // tf types used in StoredBlock
import { AtomicBlock, BEAPRegistry, MiniApp as MiniAppType, Component } from './types' // type definitions

// Export all types and functions for external use
export { loadAllTiers, resolveMiniApp, resolveComponent, renderMiniApp }
export type { BEAPRegistry, MiniAppType, Component, AtomicBlock }

// Intent structure from LLM normalization
type NormalizedIntent = {
  intent: string
  features: string[]
  constraints: string[]
}

// StoredBlock pairs a block with its precomputed tensor for fast ranking
type StoredBlock = { block: AtomicBlock, tensor?: tf.Tensor1D }

// StoredItem pairs any tier item with its precomputed tensor for fast ranking
type StoredItem = { 
  item: AtomicBlock | Component | MiniAppType, 
  tier: 1 | 2 | 3,
  tensor?: tf.Tensor1D 
}

let cachedBlocks: StoredBlock[] | null = null // in-memory cache for loaded Tier3 blocks (backward compatibility)
let cachedRegistry: BEAPRegistry | null = null // in-memory cache for all tiers
let cachedItems: StoredItem[] | null = null // in-memory cache for all tier items with vectors

// STEP 2: LLM intent normalization - converts user input to structured intent
// LLM must NOT generate code, UI, or components - ONLY normalize intent
async function normalizeUserIntent(title: string, description: string): Promise<NormalizedIntent> {
  const prompt = `Analyze the following user request and extract structured intent data.

User Input:
Title: ${title}
Description: ${description}

Return ONLY valid JSON in the exact format below:

{
  "intent": "",
  "features": [],
  "constraints": []
}

IMPORTANT RULES:

1. intent:
   - Use a short, normalized intent phrase (snake_case).
   - Normalize synonyms (e.g. "sign in", "log in" → "login").
   - Examples: "note_taking", "form_creation", "data_entry".

2. features:
   - List ALL concrete UI elements and actions mentioned by the user.
   - Be specific about WHAT the user wants.
   - Examples: "textarea", "button", "save_action", "text_label", "input_field".
   - If user says "textarea", include "textarea" not just "text_input".
   - If user says "button to save", include both "button" and "save_action".

3. constraints:
   - Constraints MUST be chosen ONLY from the allowed list below.
   - ONLY add "single_functionality" if user explicitly says "only one thing", "just a button", "single element".
   - DO NOT add "single_functionality" if user mentions multiple elements (textarea AND button, input AND save, etc).
   - If user says "no [something]", map to the appropriate constraint.

ALLOWED CONSTRAINT VALUES:
- "single_functionality"      → user explicitly wants ONLY one element (rare!)
- "read_only"                 → no state-changing actions
- "no_backend"                → no API or DB access
- "no_input"                  → no input elements allowed
- "no_action"                 → no buttons or triggers allowed

CRITICAL RULES:
- If user mentions multiple elements (e.g., textarea + button), constraints array MUST be empty [].
- If user says "no title input", "no header", etc., just don't include those in features - don't add a constraint.
- Return empty constraints array [] unless user explicitly restricts functionality.
- DO NOT include explanations.
- DO NOT generate code or UI.
- Return ONLY the JSON object.`

  try {
    // Call Ollama API
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'phi3:mini', // or whatever model you have installed
        prompt: prompt,
        stream: false,
        format: 'json'
      })
    })

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`)
    }

    const result = await response.json()
    const intentData = JSON.parse(result.response)
    
    // Validate the response structure
    if (!intentData.intent || !Array.isArray(intentData.features) || !Array.isArray(intentData.constraints)) {
      throw new Error('Invalid LLM response structure')
    }

    console.log("BEAP: LLM normalized intent:", intentData) // todo: Remove this line for production
    return intentData

  } catch (error) {
    console.warn("BEAP: LLM normalization failed, falling back to deterministic analysis:", error) // Remove this line for production
    
    // Fallback to deterministic analysis if LLM fails
    const fullText = (title + ' ' + description).toLowerCase()
    
    let intent = 'general'
    let features: string[] = []
    let constraints: string[] = []
    
    // Detect specific UI elements mentioned
    if (/textarea|text\s*area|multiline/.test(fullText)) {
      features.push('textarea')
    }
    if (/button|click/.test(fullText)) {
      features.push('button')
    }
    if (/input|field|text\s*box/.test(fullText)) {
      features.push('input_field')
    }
    if (/label|heading|title/.test(fullText)) {
      features.push('label')
    }
    
    // Detect actions
    if (/save|store|persist/.test(fullText)) {
      features.push('save_action')
      intent = 'data_persistence'
    }
    if (/note|notes|memo/.test(fullText)) {
      intent = 'note_taking'
      if (!features.includes('textarea')) features.push('textarea')
    }
    if (/form|submit/.test(fullText)) {
      intent = 'form_creation'
      features.push('submit_action')
    }
    
    // Only add single_functionality if explicitly stated with words like "only", "just", "single"
    // AND they're asking for truly one thing
    if (/\b(only|just|single)\b/.test(fullText) && features.length <= 1) {
      constraints.push('single_functionality')
    }
    
    return { intent, features, constraints }
  }
}

// STEP 4: Create vector ONLY from normalized intent and features (not raw input)
function createQueryVector(normalizedIntent: NormalizedIntent): tf.Tensor1D {
  const queryText = normalizedIntent.intent + ' ' + normalizedIntent.features.join(' ')
  return textToTensor(queryText.trim())
}

// STEP 7.5: Deterministic post-similarity selection layer
// Takes ranked blocks and applies constraint-based rules to select final set
function applySelectionRules(
  rankedBlocks: Array<{ block: AtomicBlock; score: number }>,
  constraints: string[]
): AtomicBlock[] {
  // Rule 1: If "single_functionality" constraint exists, select ONLY the top 1 block
  if (constraints.includes('single_functionality')) {
    return rankedBlocks.length > 0 ? [rankedBlocks[0].block] : []
  }

  // Rule 2: Apply group-based selection for normal cases
  // Group blocks by their group field
  const groupedBlocks = new Map<string, Array<{ block: AtomicBlock; score: number }>>()
  
  for (const item of rankedBlocks) {
    const group = item.block.group || 'unknown'
    if (!groupedBlocks.has(group)) {
      groupedBlocks.set(group, [])
    }
    groupedBlocks.get(group)!.push(item)
  }

  // Apply group-specific limits (blocks within each group are already sorted by score)
  const selectedBlocks: AtomicBlock[] = []

  // ui.action: max 1 primary action (highest scoring)
  const actionGroup = groupedBlocks.get('ui.action') || groupedBlocks.get('ui.button') || []
  if (actionGroup.length > 0) {
    selectedBlocks.push(actionGroup[0].block)
  }

  // ui.input: allow multiple inputs (all that were ranked high enough)
  const inputGroup = groupedBlocks.get('ui.input') || []
  for (const item of inputGroup) {
    selectedBlocks.push(item.block)
  }

  // ui.display: optional display elements (take top 1 if present)
  const displayGroup = groupedBlocks.get('ui.display') || groupedBlocks.get('ui.text') || []
  if (displayGroup.length > 0) {
    selectedBlocks.push(displayGroup[0].block)
  }

  // logic.*: allow all logic blocks that ranked high
  for (const [group, items] of groupedBlocks.entries()) {
    if (group.startsWith('logic.')) {
      for (const item of items) {
        selectedBlocks.push(item.block)
      }
    }
  }

  return selectedBlocks
}

// STEP 6: Load and vectorize Tier-3 blocks using name + description + intent_tags (backward compatibility)
async function ensureBlocks() {
  if (cachedBlocks) return cachedBlocks // return cache if available
  const blocks = await loadTier3Blocks() // load blocks using loader strategies
  console.log("BEAP: Loading Tier-3 blocks", blocks.length) // todo: Added for testing. Will Remove later.
  const stored: StoredBlock[] = [] // collect blocks with tensors
  for (const b of blocks) {
    // STEP 6: Vectorize using id + description + intent_tags (not user input)
    const blockText = [
      b.id || '', // use id as name if name field doesn't exist
      b.description || '',
      (b.intent_tags || []).join(' ')
    ].filter(t => t.length > 0).join(' ').trim()
    
    const tensor = textToTensor(blockText) // compute deterministic tensor
    stored.push({ block: b, tensor }) // store pair
  }
  cachedBlocks = stored // assign cache
  console.log("BEAP: Cached blocks with vectors", stored.length) // todo: Added for testing. Remove later.
  return stored // return computed list
}

// STEP 6 (Enhanced): Load and vectorize ALL tiers using name + description + intent_tags
async function ensureAllTiers(): Promise<{ registry: BEAPRegistry, items: StoredItem[] }> {
  if (cachedRegistry && cachedItems) {
    return { registry: cachedRegistry, items: cachedItems } // return cache if available
  }
  
  const registry = await loadAllTiers() // load all three tiers
  
  // Ensure all tier maps exist
  if (!registry || !registry.tier3 || !registry.tier2 || !registry.tier1) {
    console.error("BEAP: Registry is incomplete:", registry)
    throw new Error("Failed to load registry: one or more tier maps are undefined")
  }
  
  console.log("BEAP: Loaded all tiers:", {
    tier3: registry.tier3.size,
    tier2: registry.tier2.size,
    tier1: registry.tier1.size
  })
  
  const items: StoredItem[] = []
  
  // Vectorize Tier 3 blocks
  if (registry.tier3 && registry.tier3.size > 0) {
    for (const [id, block] of registry.tier3.entries()) {
      const blockText = [
        block.id || '',
        block.description || '',
        (block.intent_tags || []).join(' ')
      ].filter(t => t.length > 0).join(' ').trim()
      
      const tensor = textToTensor(blockText)
      items.push({ item: block, tier: 3, tensor })
    }
  }
  
  // Vectorize Tier 2 components
  if (registry.tier2 && registry.tier2.size > 0) {
    for (const [id, component] of registry.tier2.entries()) {
      const componentText = [
        component.id || '',
        component.name || '',
        component.description || '',
        (component.intent_tags || []).join(' ')
      ].filter(t => t.length > 0).join(' ').trim()
      
      const tensor = textToTensor(componentText)
      items.push({ item: component, tier: 2, tensor })
    }
  }
  
  // Vectorize Tier 1 mini-apps
  if (registry.tier1 && registry.tier1.size > 0) {
    for (const [id, miniApp] of registry.tier1.entries()) {
      const miniAppText = [
        miniApp.id || '',
        miniApp.name || '',
        miniApp.description || '',
        (miniApp.intent_tags || []).join(' ')
      ].filter(t => t.length > 0).join(' ').trim()
      
      const tensor = textToTensor(miniAppText)
      items.push({ item: miniApp, tier: 1, tensor })
    }
  }
  
  cachedRegistry = registry
  cachedItems = items
  
  console.log("BEAP: Cached all tier items with vectors:", items.length)
  return { registry, items }
}

// BEAP MAIN WORKFLOW: Follows strict architecture with separated concerns
// Enhanced to search across all tiers (Tier1, Tier2, Tier3) instead of just Tier3
export async function createMiniAppFromQuery(title: string, description: string, topN = 4) {
  try {
    console.log("BEAP: Starting workflow for:", { title, description })
    
    // STEP 2-3: LLM normalizes user intent (NO code/UI generation)
    const normalizedIntent = await normalizeUserIntent(title, description)
    console.log("BEAP: Normalized intent:", normalizedIntent) // Remove this line for production
    
    // STEP 4-5: TensorFlow.js creates vector from normalized intent/features ONLY
    const queryVector = createQueryVector(normalizedIntent)
    console.log("BEAP: Created query vector from normalized intent")
    
    // STEP 6-7: TensorFlow.js ranks ALL tier items using cosine similarity
    const { registry, items } = await ensureAllTiers() // load all tiers with vectors
    console.log("Ensure all tiers", await ensureAllTiers()) // todo: Remove this line for production
    // Check if we have any items to score
    if (!items || items.length === 0) {
      console.error("BEAP: No items loaded from any tier")
      throw new Error("No mini-app components available. Please ensure tiers are properly loaded.")
    }
    
    const scored = items.map(si => ({
      item: si.item,
      tier: si.tier,
      score: cosineSimilarity(queryVector, si.tensor!)
    }))
    
    // STEP 7: TensorFlow.js sorts by relevance (NO UI decisions)
    scored.sort((a, b) => b.score - a.score) // sort by relevance
    console.log("BEAP: Scored items across all tiers:", scored.slice(0, 5).map(s => ({ 
      id: s.item.id, 
      tier: s.tier,
      score: s.score.toFixed(4) 
    })))
    
    // Check if we have any scored items
    if (scored.length === 0) {
      throw new Error("No matching components found for the query")
    }
    
    // STEP 7.5: Tier-aware selection with multi-component support for Tier-2
    // RULE: Prefer higher tiers (T1 > T2 > T3) when scores are competitive
    // For Tier-2: Select ALL components scoring >= 85% of top Tier-2 score (enables multi-component assembly)
    // For Tier-1: Single best mini-app (already complete)
    // For Tier-3: Apply selection rules to individual blocks
    
    let selectedTier = scored[0].tier // detect tier of highest-scoring item
    let bestMatch = scored[0]
    
    // Tier preference: if Tier-1 or Tier-2 scores within 10% of best, prefer it
    for (const item of scored.slice(0, 3)) {
      if (item.tier < bestMatch.tier && item.score >= bestMatch.score * 0.9) {
        bestMatch = item
        selectedTier = item.tier
        break
      }
    }
    
    console.log("BEAP: Best match tier:", selectedTier, "| Top item:", { 
      id: bestMatch.item.id, 
      tier: bestMatch.tier,
      score: bestMatch.score.toFixed(4)
    })
    
    // STEP 8: Resolve to atomic blocks based on tier
    let resolvedBlocks: AtomicBlock[] = []
    let layoutInfo: { type: string, spacing?: string } | undefined
    
    if (selectedTier === 1) {
      // Tier1 MiniApp: resolve through Tier2 components to Tier3 blocks
      const miniApp = bestMatch.item as MiniAppType
      resolvedBlocks = resolveMiniApp(miniApp, registry)
      layoutInfo = miniApp.layout // preserve layout information
      console.log("BEAP: Resolved Tier1 mini-app to", resolvedBlocks.length, "atomic blocks")
    } else if (selectedTier === 2) {
      // Tier2 Multi-Component Assembly:
      // Select ALL Tier-2 components scoring >= 85% of the top Tier-2 score
      const tier2Items = scored.filter(s => s.tier === 2)
      
      if (tier2Items.length === 0) {
        throw new Error("No Tier-2 components found (required for Tier-2 selection)")
      }
      
      const topTier2Score = tier2Items[0].score
      const scoreThreshold = topTier2Score * 0.85 // 85% threshold for multi-component inclusion
      const selectedComponents = tier2Items.filter(s => s.score >= scoreThreshold)
      
      console.log("BEAP: Tier-2 multi-component selection:", {
        topScore: topTier2Score.toFixed(4),
        threshold: scoreThreshold.toFixed(4),
        selectedCount: selectedComponents.length,
        selectedIds: selectedComponents.map(s => `${s.item.id} (${s.score.toFixed(4)})`)
      })
      
      // Resolve each selected component to Tier-3 blocks
      for (const selectedItem of selectedComponents) {
        const component = selectedItem.item as Component
        const componentBlocks = resolveComponent(component, registry)
        resolvedBlocks.push(...componentBlocks)
      }
      
      console.log("BEAP: Resolved", selectedComponents.length, "Tier2 components to", resolvedBlocks.length, "atomic blocks")
    } else {
      // Tier3 Block: use directly but still apply selection rules for multi-block scenarios
      const block = bestMatch.item as AtomicBlock
      
      // Get other high-scoring Tier3 blocks for selection rules
      const tier3Scored = scored
        .filter(s => s.tier === 3)
        .map(s => ({ block: s.item as AtomicBlock, score: s.score }))
      
      resolvedBlocks = applySelectionRules(tier3Scored.slice(0, topN * 2), normalizedIntent.constraints)
      console.log("BEAP: Applied selection rules to Tier3 blocks, selected:", resolvedBlocks.length)
    }
    
    // Check if we have resolved blocks
    if (!resolvedBlocks || resolvedBlocks.length === 0) {
      throw new Error("Failed to resolve components to atomic blocks")
    }
    
    // STEP 9: Deterministic assembly (NO LLM involvement after this point)
    const assembledApp = assembleMiniApp(resolvedBlocks) // deterministic grouping
    // Attach layout information if available from Tier-1
    if (layoutInfo) {
      (assembledApp as any).layout = layoutInfo
    }
    console.log("BEAP: Assembled mini-app:", assembledApp.blocks.length, "blocks")
    
    // STEP 10: Pre-written renderer converts JSON to UI
    const renderedElement = renderMiniApp(assembledApp) // deterministic rendering
    console.log("BEAP: Rendered to DOM element")
    
    // Return complete result with workflow artifacts
    return { 
      app: assembledApp, 
      rendered: renderedElement, 
      normalizedIntent: normalizedIntent,
      bestMatch: {
        id: bestMatch.item.id,
        tier: bestMatch.tier,
        score: bestMatch.score
      },
      resolvedBlocks: resolvedBlocks,
      allScores: scored.slice(0, topN * 2).map(s => ({
        id: s.item.id,
        tier: s.tier,
        score: s.score
      }))
    }
  } catch (error) {
    console.error("BEAP: Error in createMiniAppFromQuery:", error)
    throw error
  }
}
