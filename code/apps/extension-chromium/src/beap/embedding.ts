import * as tf from '@tensorflow/tfjs' // import TensorFlow.js for tensor operations

// normalizeText: lowercase, remove non-alphanumerics, collapse whitespace
function normalizeText(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim() // normalize and trim input
}

// fnv1a: deterministic 32-bit hash (FNV-1a variant) for token hashing
function fnv1a(str: string) {
  let h = 2166136261 >>> 0 // FNV offset basis (unsigned)
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i) // xor with byte
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24) // mix bits
  }
  return h >>> 0 // return unsigned 32-bit integer
}

// textToTensor: converts text into a deterministic dense vector (tf.Tensor1D)
export function textToTensor(text: string, dim = 256) {
  const t = normalizeText(text) // normalized text
  const tokens = t.split(' ') // split into whitespace tokens
  const vec = new Float32Array(dim) // zero-initialized float vector
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i] // current token
    // unigrams: hash token with a prefix to avoid collisions across n-grams
    const h1 = fnv1a('1:' + tok) % dim
    vec[h1] = vec[h1] + 1 // increment unigram bucket
    // bigrams: if next token exists, hash the pair
    if (i + 1 < tokens.length) {
      const big = tok + ' ' + tokens[i + 1]
      const h2 = fnv1a('2:' + big) % dim
      vec[h2] = vec[h2] + 1 // increment bigram bucket
    }
  }
  // convert to tensor and normalize to unit length
  const tns = tf.tensor1d(Array.from(vec)) // create 1D tensor from Float32Array

  console.log('Vec:', vec); // todo: Added for testing. Remove later.
  console.log('Tensor:', tns); // todo: Added for testing. Remove later.

  const norm = tf.norm(tns) // compute L2 norm
  return tf.tidy(() => {
    return tf.div(tns, tf.add(norm, tf.scalar(1e-8))) as tf.Tensor1D // divide by norm (with epsilon)
  })
}

const EMBEDDING_API_URL = 'http://127.0.0.1:51248/api/llm/embeddings'
const semanticEmbeddingCache = new Map<string, tf.Tensor1D>()

function normalizeVector(values: number[]): tf.Tensor1D {
  const tns = tf.tensor1d(values)
  const norm = tf.norm(tns)
  return tf.tidy(() => tf.div(tns, tf.add(norm, tf.scalar(1e-8))) as tf.Tensor1D)
}

async function fetchSemanticEmbedding(text: string): Promise<tf.Tensor1D | null> {
  try {
    const response = await fetch(EMBEDDING_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: text })
    })
    if (!response.ok) return null
    const body = await response.json()
    const vector = Array.isArray(body?.embedding)
      ? body.embedding
      : Array.isArray(body?.data?.[0]?.embedding)
        ? body.data[0].embedding
        : null
    if (!vector || !vector.every((v: unknown) => typeof v === 'number')) return null
    return normalizeVector(vector as number[])
  } catch {
    return null
  }
}

// textToTensorWithFallback: semantic embedding first, deterministic fallback for offline safety.
export async function textToTensorWithFallback(text: string, dim = 256): Promise<tf.Tensor1D> {
  const cacheKey = normalizeText(text)
  const cached = semanticEmbeddingCache.get(cacheKey)
  if (cached) return cached

  const semanticTensor = await fetchSemanticEmbedding(text)
  if (semanticTensor) {
    semanticEmbeddingCache.set(cacheKey, semanticTensor)
    return semanticTensor
  }

  const fallback = textToTensor(text, dim)
  semanticEmbeddingCache.set(cacheKey, fallback)
  return fallback
}

// cosineSimilarity: returns scalar cosine similarity between two unit tensors
export function cosineSimilarity(a: tf.Tensor1D, b: tf.Tensor1D) {
  return tf.tidy(() => {
    const num = tf.sum(tf.mul(a, b)) // dot product numerator
    const den = tf.mul(tf.norm(a), tf.norm(b)) // product of norms
    return num.div(tf.add(den, tf.scalar(1e-8))).arraySync() as number // safe divide and return number
  })
}
