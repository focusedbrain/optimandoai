import { loadTier3Blocks } from './loader'
import { textToTensor, cosineSimilarity } from './embedding'
import { assembleMiniApp } from './runtime'
import { renderMiniApp } from './renderer'
import * as tf from '@tensorflow/tfjs'
import { AtomicBlock } from './types'

type StoredBlock = { block: AtomicBlock, tensor?: tf.Tensor1D }

let cachedBlocks: StoredBlock[] | null = null

async function ensureBlocks() {
  if (cachedBlocks) return cachedBlocks
  const blocks = await loadTier3Blocks()
  const stored: StoredBlock[] = []
  for (const b of blocks) {
    const text = ((b.intent_tags || []).join(' ') + ' ' + (b.description || '')).trim()
    const tensor = textToTensor(text)
    stored.push({ block: b, tensor })
  }
  cachedBlocks = stored
  return stored
}

export async function createMiniAppFromQuery(title: string, description: string, topN = 4) {
  const query = (title + ' ' + description).trim()
  const qv = textToTensor(query)
  const blocks = await ensureBlocks()
  const scored = blocks.map(sb => ({ block: sb.block, score: cosineSimilarity(qv, sb.tensor!) }))
  scored.sort((a,b) => b.score - a.score)
  const selected = scored.slice(0, topN).map(s => s.block)
  const app = assembleMiniApp(selected)
  return { app, rendered: renderMiniApp(app), scores: scored.slice(0, topN) }
}
