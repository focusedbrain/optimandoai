import { loadTier3Blocks } from './loader' // loader to obtain Tier-3 atomic blocks
import { textToTensor, cosineSimilarity } from './embedding' // embedding utilities
import { assembleMiniApp } from './runtime' // assemble selected blocks into MiniApp
import { renderMiniApp } from './renderer' // render a MiniApp to HTMLElement
import * as tf from '@tensorflow/tfjs' // tf types used in StoredBlock
import { AtomicBlock } from './types' // block type definitions

// Intent structure from LLM normalization
type NormalizedIntent = {
  intent: string
  features: string[]
  constraints: string[]
}

// StoredBlock pairs a block with its precomputed tensor for fast ranking
type StoredBlock = { block: AtomicBlock, tensor?: tf.Tensor1D }

let cachedBlocks: StoredBlock[] | null = null // in-memory cache for loaded blocks

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
   - Examples: "button_creation", "note_taking", "form_creation".

2. features:
   - List concrete, technical capabilities required.
   - Use short noun phrases.
   - Examples: "clickable_element", "text_input", "submit_action".

3. constraints:
   - Constraints MUST be chosen ONLY from the allowed list below.
   - DO NOT invent new constraint names.
   - Map user words like "only", "single", "just one" to the correct constraint.

ALLOWED CONSTRAINT VALUES:
- "single_functionality"      → exactly one functional UI block
- "read_only"                 → no state-changing actions
- "no_backend"                → no API or DB access
- "no_input"                  → no input elements allowed
- "no_action"                 → no buttons or triggers allowed

STRICT RULES:
- If no constraint applies, return an empty array.
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
    
    if (/save|store|persist|remember/.test(fullText)) {
      intent = 'data_persistence'
      features.push('save_data', 'storage')
    }
    if (/write|enter|input|type|text/.test(fullText)) {
      intent = 'text_input'
      features.push('text_entry', 'input_field')
    }
    if (/form|submit|send/.test(fullText)) {
      intent = 'form_submission'
      features.push('form_fields', 'submit_action')
    }
    if (/note|notes|memo/.test(fullText)) {
      intent = 'note_taking'
      features.push('text_area', 'note_storage')
    }
    if (/simple|basic|minimal/.test(fullText)) {
      constraints.push('minimal_ui', 'basic_functionality')
    }
    if (/quick|fast|simple/.test(fullText)) {
      constraints.push('quick_access', 'streamlined')
    }
    if (/single|one\s+thing|focused/.test(fullText)) {
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

// STEP 6: Load and vectorize Tier-3 blocks using name + description + intent_tags
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

// BEAP MAIN WORKFLOW: Follows strict architecture with separated concerns
export async function createMiniAppFromQuery(title: string, description: string, topN = 4) {
  console.log("BEAP: Starting workflow for:", { title, description })
  
  // STEP 2-3: LLM normalizes user intent (NO code/UI generation)
  const normalizedIntent = await normalizeUserIntent(title, description)
  console.log("BEAP: Normalized intent:", normalizedIntent) // Remove this line for production
  
  // STEP 4-5: TensorFlow.js creates vector from normalized intent/features ONLY
  const queryVector = createQueryVector(normalizedIntent)
  console.log("BEAP: Created query vector from normalized intent")
  
  // STEP 6-7: TensorFlow.js ranks Tier-3 blocks using cosine similarity
  const blocks = await ensureBlocks() // load cached Tier-3 blocks with vectors
  const scored = blocks.map(sb => ({
    block: sb.block, 
    score: cosineSimilarity(queryVector, sb.tensor!)
  }))
  
  // STEP 7: TensorFlow.js sorts by relevance (NO UI decisions)
  scored.sort((a, b) => b.score - a.score) // sort by relevance
  console.log("BEAP: Scored blocks:", scored.map(s => ({ id: s.block.id, score: s.score.toFixed(4) }))) // Remove this line for production
  
  // STEP 7.5: Deterministic post-similarity selection layer
  // Apply constraint-based rules to select final blocks (NOT simple topN)
  const selectedBlocks = applySelectionRules(scored.slice(0, topN * 2), normalizedIntent.constraints)
  console.log("BEAP: Applied selection rules, selected blocks:", selectedBlocks.map(b => b.id))
  
  // STEP 8: Deterministic assembly (NO LLM involvement after this point)
  const assembledApp = assembleMiniApp(selectedBlocks) // deterministic grouping
  console.log("BEAP: Assembled mini-app:", assembledApp.blocks.length, "blocks")
  
  // STEP 8: Pre-written renderer converts JSON to UI
  const renderedElement = renderMiniApp(assembledApp) // deterministic rendering
  console.log("BEAP: Rendered to DOM element")
  
  // Return complete result with workflow artifacts
  return { 
    app: assembledApp, 
    rendered: renderedElement, 
    normalizedIntent: normalizedIntent,
    selectedBlocks: selectedBlocks,
    scores: scored.slice(0, topN) 
  }
}
