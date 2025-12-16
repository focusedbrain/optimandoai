import * as tf from '@tensorflow/tfjs'

// Simple deterministic n-gram hashing embedding
function normalizeText(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function fnv1a(str: string) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)
  }
  return h >>> 0
}

export function textToTensor(text: string, dim = 256) {
  const t = normalizeText(text)
  const tokens = t.split(' ')
  const vec = new Float32Array(dim)
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    // unigrams
    const h1 = fnv1a('1:' + tok) % dim
    vec[h1] = vec[h1] + 1
    // bigrams
    if (i + 1 < tokens.length) {
      const big = tok + ' ' + tokens[i + 1]
      const h2 = fnv1a('2:' + big) % dim
      vec[h2] = vec[h2] + 1
    }
  }
  // return normalized tensor
  const tns = tf.tensor1d(Array.from(vec))
  const norm = tf.norm(tns)
  return tf.tidy(() => {
    return tf.div(tns, tf.add(norm, tf.scalar(1e-8))) as tf.Tensor1D
  })
}

export function cosineSimilarity(a: tf.Tensor1D, b: tf.Tensor1D) {
  return tf.tidy(() => {
    const num = tf.sum(tf.mul(a, b))
    const den = tf.mul(tf.norm(a), tf.norm(b))
    return num.div(tf.add(den, tf.scalar(1e-8))).arraySync() as number
  })
}
