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
  const prompt = `Analyze this user request and return ONLY structured intent data as valid JSON.

User Input:
Title: ${title}
Description: ${description}

You must return STRICT JSON format:
{
  "intent": "one_word_intent",
  "features": ["feature1", "feature2"],
  "constraints": ["constraint1", "constraint2"]
}

Rules:
- intent: single word describing main purpose (e.g., "note_taking", "form_submission", "data_persistence", "text_input")
- features: array of specific capabilities needed (e.g., ["save_data", "text_area", "submit_action"])
- constraints: array of limitations or requirements (e.g., ["minimal_ui", "quick_access", "basic_functionality"])
- DO NOT generate code, UI, or components
- DO NOT include explanations outside the JSON
- Return ONLY the JSON object`

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
    
    return { intent, features, constraints }
  }
}

// STEP 4: Create vector ONLY from normalized intent and features (not raw input)
function createQueryVector(normalizedIntent: NormalizedIntent): tf.Tensor1D {
  const queryText = normalizedIntent.intent + ' ' + normalizedIntent.features.join(' ')
  return textToTensor(queryText.trim())
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
  
  // STEP 7: TensorFlow.js selects most relevant blocks (NO UI decisions)
  scored.sort((a, b) => b.score - a.score) // sort by relevance
  const selectedBlocks = scored.slice(0, topN).map(s => s.block) // select top N
  console.log("BEAP: TensorFlow.js selected blocks:", selectedBlocks.map(b => b.id))
  
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
