# Line-by-Line Explanation of Text Embedding & Similarity Code (TensorFlow.js)

This document explains **every line** of the code step by step in **very simple words**.
It is written for beginners with **no prior knowledge of TensorFlow or vectors**.

---

## Full Code (Reference)

```ts
import * as tf from '@tensorflow/tfjs' 
```

---

## 1. Importing TensorFlow.js

**What this line does:**
- Imports TensorFlow.js into the file
- Gives access to math functions like:
  - vectors (tensors)
  - normalization
  - dot product
  - cosine similarity
- TensorFlow is used **only for math**, not AI or ML here

---

## 2. Text Normalization Function

```ts
function normalizeText(s: string) {
  return s.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
```

### Line-by-line explanation:

- `s.toLowerCase()`  
  Converts all letters to lowercase  
  Example: `"Notes"` → `"notes"`

- `.replace(/[^a-z0-9\s]/g, ' ')`  
  Removes punctuation and special characters  
  Example: `"notes!!!"` → `"notes"`

- `.replace(/\s+/g, ' ')`  
  Converts multiple spaces into a single space

- `.trim()`  
  Removes spaces from start and end of text

**Why this is needed:**  
So that similar text looks the same before processing.

---

## 3. Hash Function (fnv1a)

```ts
function fnv1a(str: string) {
  let h = 2166136261 >>> 0
```

- `2166136261` is a fixed starting number (hash seed)
- `>>> 0` forces it to be an unsigned 32-bit integer

---

```ts
  for (let i = 0; i < str.length; i++) {
```

- Loops through each character in the string

---

```ts
    h ^= str.charCodeAt(i)
```

- Converts character to number (ASCII code)
- XORs it with the hash value
- Helps mix the bits

---

```ts
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)
```

- Shifts bits to spread values
- Ensures small text changes produce big hash changes

---

```ts
  }
  return h >>> 0
}
```

- Returns final hash as unsigned 32-bit number

**Purpose:**  
Convert text into a stable numeric value.

---

## 4. Converting Text to Tensor

```ts
export function textToTensor(text: string, dim = 256) {
```

- `text` = input sentence or paragraph
- `dim = 256` = vector size (256 numbers)

---

```ts
  const t = normalizeText(text)
```

- Cleans the input text

---

```ts
  const tokens = t.split(' ')
```

- Splits text into words

---

```ts
  const vec = new Float32Array(dim)
```

- Creates a vector of length 256
- All values start as 0

---

### Processing Each Word

```ts
  for (let i = 0; i < tokens.length; i++) {
```

- Loop through every word

---

```ts
    const tok = tokens[i]
```

- Current word

---

```ts
    const h1 = fnv1a('1:' + tok) % dim
```

- `'1:'` means single word
- Hash word into a number
- `% dim` keeps index between 0–255

---

```ts
    vec[h1] = vec[h1] + 1
```

- Increments count for that word
- Records word frequency

---

### Processing Word Pairs (Bigrams)

```ts
    if (i + 1 < tokens.length) {
```

- Ensures next word exists

---

```ts
      const big = tok + ' ' + tokens[i + 1]
```

- Creates a two-word phrase

---

```ts
      const h2 = fnv1a('2:' + big) % dim
```

- `'2:'` separates bigrams from single words

---

```ts
      vec[h2] = vec[h2] + 1
```

- Counts phrase frequency

---

## 5. Vector → Tensor

```ts
  const tns = tf.tensor1d(Array.from(vec))
```

- Converts JS array to TensorFlow tensor
- Tensor is optimized for math
- Shape = [256]

---

## 6. Vector Normalization

```ts
  const norm = tf.norm(tns)
```

- Calculates vector length (magnitude)

---

```ts
  return tf.tidy(() => {
    return tf.div(tns, tf.add(norm, tf.scalar(1e-8)))
  })
```

- Divides vector by its length
- Makes vector length = 1
- `1e-8` prevents divide-by-zero
- `tf.tidy()` cleans up temporary tensors

---

## 7. Cosine Similarity Function

```ts
export function cosineSimilarity(a: tf.Tensor1D, b: tf.Tensor1D) {
```

- Takes two normalized vectors

---

```ts
  return tf.tidy(() => {
```

- Automatically frees memory

---

```ts
    const num = tf.sum(tf.mul(a, b))
```

- Multiplies matching positions
- Adds them together
- This is the dot product

---

```ts
    const den = tf.mul(tf.norm(a), tf.norm(b))
```

- Multiplies vector lengths

---

```ts
    return num.div(tf.add(den, tf.scalar(1e-8))).arraySync() as number
```

- Divides dot product by lengths
- Converts tensor to JS number
- Returns similarity score (0–1)

---

## 8. Final Concept Summary

- Text → cleaned
- Words → hashed
- Hashes → fixed-size vector
- Vector → tensor
- Tensor → normalized
- Two tensors → cosine similarity

---

## 9. One-Line Explanation

This code converts text into a numeric vector using hashing, normalizes it, and compares two texts using cosine similarity without using any AI model.

---
