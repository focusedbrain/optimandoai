import { loadTier3Blocks } from './loader' // loader to obtain Tier-3 atomic blocks
import { textToTensor, cosineSimilarity } from './embedding' // embedding utilities
import { assembleMiniApp } from './runtime' // assemble selected blocks into MiniApp
import { renderMiniApp } from './renderer' // render a MiniApp to HTMLElement
import * as tf from '@tensorflow/tfjs' // tf types used in StoredBlock
import { AtomicBlock } from './types' // block type definitions

// StoredBlock pairs a block with its precomputed tensor for fast ranking
type StoredBlock = { block: AtomicBlock, tensor?: tf.Tensor1D }

let cachedBlocks: StoredBlock[] | null = null // in-memory cache for loaded blocks

// ensureBlocks: load and precompute tensors for all Tier-3 blocks once
async function ensureBlocks() {
  if (cachedBlocks) return cachedBlocks // return cache if available
  const blocks = await loadTier3Blocks() // load blocks using loader strategies
  const stored: StoredBlock[] = [] // collect blocks with tensors
  for (const b of blocks) {
    const text = ((b.intent_tags || []).join(' ') + ' ' + (b.description || '')).trim() // build text for embedding
    const tensor = textToTensor(text) // compute deterministic tensor
    stored.push({ block: b, tensor }) // store pair
  }
  cachedBlocks = stored // assign cache
  return stored // return computed list
}

// createMiniAppFromQuery: high-level API to build & render a MiniApp from title+description
export async function createMiniAppFromQuery(title: string, description: string, topN = 4) {
  const query = (title + ' ' + description).trim() // combine inputs
  const qv = textToTensor(query) // compute query vector
  const blocks = await ensureBlocks() // ensure blocks/tensors present
  const scored = blocks.map(sb => ({ block: sb.block, score: cosineSimilarity(qv, sb.tensor!) })) // score each block
  scored.sort((a,b) => b.score - a.score) // sort descending by score
  const selected = scored.slice(0, topN).map(s => s.block) // pick topN blocks
  const app = assembleMiniApp(selected) // assemble mini-app with selected blocks
  return { app, rendered: renderMiniApp(app), scores: scored.slice(0, topN) } // return assembled app, rendered element, and scores
}
