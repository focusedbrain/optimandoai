/**
 * BEAP Build Validation (Dev-Only)
 * 
 * Validates that built qBEAP packages are canon-aligned.
 * This file contains no UI dependencies.
 * 
 * Scope: Package CREATION only (sender side)
 * Excluded: PoAE, receiver decrypt, UI, forwarding, identity anchoring
 */

import type { BeapPackage } from '../services/BeapPackageBuilder'
import { computeMerkleRoot, getDebugAadStats, getDebugLastSigningData } from '../services/beapCrypto'

/**
 * Validate a built qBEAP package for canon compliance.
 * 
 * @param pkg - The built BeapPackage to validate
 * @returns Array of human-readable error strings (empty if valid)
 */
export async function validateBuiltQBeapPackage(pkg: BeapPackage): Promise<string[]> {
  const errors: string[] = []
  
  // ==========================================================================
  // 1) Header Crypto Checks
  // ==========================================================================
  
  // 1.1) senderX25519PublicKeyB64 (32 bytes)
  const senderX25519 = pkg.header.crypto?.senderX25519PublicKeyB64
  if (!senderX25519 || typeof senderX25519 !== 'string' || senderX25519.length === 0) {
    errors.push('header.crypto.senderX25519PublicKeyB64 is missing or empty')
  } else {
    try {
      const decoded = atob(senderX25519)
      if (decoded.length !== 32) {
        errors.push(`header.crypto.senderX25519PublicKeyB64 decodes to ${decoded.length} bytes, expected 32`)
      }
    } catch {
      errors.push('header.crypto.senderX25519PublicKeyB64 is not valid base64')
    }
  }
  
  // 1.2) PQ metadata with kemCiphertextB64
  const pq = pkg.header.crypto?.pq
  if (!pq || pq === false) {
    errors.push('header.crypto.pq is false or missing (PQ is required for qBEAP)')
  } else {
    if (!pq.kemCiphertextB64 || typeof pq.kemCiphertextB64 !== 'string' || pq.kemCiphertextB64.length === 0) {
      errors.push('header.crypto.pq.kemCiphertextB64 is missing or empty')
    } else {
      try {
        const decoded = atob(pq.kemCiphertextB64)
        if (decoded.length < 32) {
          errors.push(`header.crypto.pq.kemCiphertextB64 decodes to ${decoded.length} bytes, expected at least 32`)
        }
      } catch {
        errors.push('header.crypto.pq.kemCiphertextB64 is not valid base64')
      }
    }
  }
  
  // 1.3) Salt must be exactly 16 bytes when decoded
  const salt = pkg.header.crypto?.salt
  if (!salt || typeof salt !== 'string' || salt.length === 0) {
    errors.push('header.crypto.salt is missing or empty')
  } else {
    try {
      const decoded = atob(salt)
      if (decoded.length !== 16) {
        errors.push(`header.crypto.salt decodes to ${decoded.length} bytes, expected 16`)
      }
    } catch {
      errors.push('header.crypto.salt is not valid base64')
    }
  }
  
  // ==========================================================================
  // 2) Size Limits
  // ==========================================================================
  
  const sizeLimits = pkg.header.sizeLimits
  const payloadEnc = pkg.payloadEnc
  
  if (!sizeLimits) {
    errors.push('header.sizeLimits is missing')
  } else {
    // 2.1) Max values must be positive
    if (!sizeLimits.envelopeMaxBytes || sizeLimits.envelopeMaxBytes <= 0) {
      errors.push('header.sizeLimits.envelopeMaxBytes is missing or <= 0')
    }
    if (!sizeLimits.capsulePlaintextMaxBytes || sizeLimits.capsulePlaintextMaxBytes <= 0) {
      errors.push('header.sizeLimits.capsulePlaintextMaxBytes is missing or <= 0')
    }
    if (!sizeLimits.chunkMaxBytes || sizeLimits.chunkMaxBytes <= 0) {
      errors.push('header.sizeLimits.chunkMaxBytes is missing or <= 0')
    }
    if (!sizeLimits.packageMaxBytes || sizeLimits.packageMaxBytes <= 0) {
      errors.push('header.sizeLimits.packageMaxBytes is missing or <= 0')
    }
    
    // 2.2) Computed sizes within limits
    if (sizeLimits.capsulePlaintextBytes !== undefined && sizeLimits.capsulePlaintextMaxBytes) {
      if (sizeLimits.capsulePlaintextBytes > sizeLimits.capsulePlaintextMaxBytes) {
        errors.push(`capsulePlaintextBytes (${sizeLimits.capsulePlaintextBytes}) exceeds capsulePlaintextMaxBytes (${sizeLimits.capsulePlaintextMaxBytes})`)
      }
    }
    
    // 2.3) SizeLimits consistency with payloadEnc
    // capsulePlaintextBytes must match payloadEnc.bytesPlain
    if (payloadEnc && sizeLimits.capsulePlaintextBytes !== undefined) {
      if (sizeLimits.capsulePlaintextBytes !== payloadEnc.bytesPlain) {
        errors.push(`header.sizeLimits.capsulePlaintextBytes (${sizeLimits.capsulePlaintextBytes}) !== payloadEnc.bytesPlain (${payloadEnc.bytesPlain})`)
      }
    }
    
    // 2.4) If chunking is enabled, chunkMaxBytes must match chunking.maxChunkBytes
    if (payloadEnc?.chunking?.enabled && payloadEnc.chunking.maxChunkBytes !== undefined) {
      if (sizeLimits.chunkMaxBytes !== payloadEnc.chunking.maxChunkBytes) {
        errors.push(`header.sizeLimits.chunkMaxBytes (${sizeLimits.chunkMaxBytes}) !== payloadEnc.chunking.maxChunkBytes (${payloadEnc.chunking.maxChunkBytes})`)
      }
    }
  }
  
  // ==========================================================================
  // 3) PayloadEnc Chunking
  // ==========================================================================
  
  // payloadEnc already declared above in section 2
  if (!payloadEnc) {
    errors.push('payloadEnc is missing (qBEAP must have encrypted payload)')
  } else {
    // 3.1) Chunking enabled
    if (!payloadEnc.chunking?.enabled) {
      errors.push('payloadEnc.chunking.enabled is not true (capsule must be chunked per canon A.3.042)')
    }
    
    // 3.2) Chunk count matches
    if (payloadEnc.chunking && payloadEnc.chunks) {
      if (payloadEnc.chunking.count !== payloadEnc.chunks.length) {
        errors.push(`payloadEnc.chunking.count (${payloadEnc.chunking.count}) !== chunks.length (${payloadEnc.chunks.length})`)
      }
    }
    
    // 3.3) Merkle root present
    if (!payloadEnc.chunking?.merkleRoot || payloadEnc.chunking.merkleRoot.length === 0) {
      errors.push('payloadEnc.chunking.merkleRoot is missing or empty')
    }
    
    // 3.4) Validate chunks are contiguous and ordered
    if (payloadEnc.chunks && payloadEnc.chunks.length > 0) {
      // Check contiguity: indices must be 0, 1, 2, ..., n-1
      const sortedChunks = [...payloadEnc.chunks].sort((a, b) => a.index - b.index)
      for (let i = 0; i < sortedChunks.length; i++) {
        if (sortedChunks[i].index !== i) {
          errors.push(`Chunk indices are not contiguous: expected index ${i}, found ${sortedChunks[i].index}`)
          break
        }
      }
      
      // Check ordering: chunks array should already be in order
      for (let i = 0; i < payloadEnc.chunks.length; i++) {
        const chunk = payloadEnc.chunks[i]
        if (chunk.index !== i) {
          errors.push(`payloadEnc.chunks[${i}].index is ${chunk.index}, expected ${i} (chunks must be ordered)`)
        }
        if (!chunk.nonce || chunk.nonce.length === 0) {
          errors.push(`payloadEnc.chunks[${i}].nonce is missing or empty`)
        }
        if (!chunk.ciphertext || chunk.ciphertext.length === 0) {
          errors.push(`payloadEnc.chunks[${i}].ciphertext is missing or empty`)
        }
        if (!chunk.sha256Cipher || chunk.sha256Cipher.length === 0) {
          errors.push(`payloadEnc.chunks[${i}].sha256Cipher is missing or empty`)
        }
        if (!chunk.bytesPlain || chunk.bytesPlain <= 0) {
          errors.push(`payloadEnc.chunks[${i}].bytesPlain is missing or <= 0`)
        }
      }
    } else if (payloadEnc.chunking?.enabled) {
      errors.push('payloadEnc.chunks is empty but chunking.enabled is true')
    }
  }
  
  // ==========================================================================
  // 4) Merkle Root Sanity Check (sort by index before recomputing)
  // ==========================================================================
  
  if (payloadEnc?.chunks && payloadEnc.chunks.length > 0 && payloadEnc.chunking?.merkleRoot) {
    // Sort chunks by index to ensure deterministic merkle root computation
    const sortedChunks = [...payloadEnc.chunks].sort((a, b) => a.index - b.index)
    const chunkHashes = sortedChunks.map(c => c.sha256Cipher)
    const recomputedMerkleRoot = await computeMerkleRoot(chunkHashes)
    if (recomputedMerkleRoot !== payloadEnc.chunking.merkleRoot) {
      errors.push(`Merkle root mismatch: computed=${recomputedMerkleRoot.substring(0, 16)}..., stored=${payloadEnc.chunking.merkleRoot.substring(0, 16)}...`)
    }
  }
  
  // ==========================================================================
  // 5) AAD Usage Verification (Dev-Only Instrumentation)
  // ==========================================================================
  
  const aadStats = getDebugAadStats()
  if (aadStats.usedCount < 1) {
    errors.push(`AAD was not used for any encryption (usedCount=${aadStats.usedCount}); expected >= 1 for capsule`)
  }
  
  if (pkg.artefactsEnc && pkg.artefactsEnc.length > 0) {
    const minExpected = 2
    if (aadStats.usedCount < minExpected) {
      errors.push(`AAD was used ${aadStats.usedCount} times but artefacts exist; expected >= ${minExpected}`)
    }
  }
  
  if (aadStats.lastLen <= 0) {
    errors.push(`AAD lastLen is ${aadStats.lastLen}; expected > 0`)
  }
  
  // ==========================================================================
  // 6) Signing Data Binds Payload Merkle Root
  // ==========================================================================
  
  const signingData = getDebugLastSigningData()
  if (!signingData) {
    errors.push('Debug signing data not captured (setDebugAadTrackingEnabled may not be enabled)')
  } else if (typeof signingData === 'object' && signingData !== null) {
    const signingObj = signingData as Record<string, unknown>
    const payload = signingObj.payload
    
    if (!payload) {
      errors.push('Signing data does not contain payload field')
    } else if (typeof payload === 'object' && payload !== null) {
      const payloadObj = payload as Record<string, unknown>
      
      // For new packages, payload should be structured with merkleRoot
      if (payloadObj.isChunked === true) {
        if (!payloadObj.merkleRoot) {
          errors.push('Signing data payload is chunked but merkleRoot is missing')
        } else if (payloadEnc?.chunking?.merkleRoot) {
          if (payloadObj.merkleRoot !== payloadEnc.chunking.merkleRoot) {
            errors.push(`Signing data merkleRoot (${String(payloadObj.merkleRoot).substring(0, 16)}...) !== payloadEnc.chunking.merkleRoot (${payloadEnc.chunking.merkleRoot.substring(0, 16)}...)`)
          }
        }
        
        // Verify sha256Plain and bytesPlain are bound
        if (!payloadObj.sha256Plain) {
          errors.push('Signing data payload.sha256Plain is missing')
        } else if (payloadEnc?.sha256Plain && payloadObj.sha256Plain !== payloadEnc.sha256Plain) {
          errors.push(`Signing data sha256Plain mismatch`)
        }
        
        if (typeof payloadObj.bytesPlain !== 'number') {
          errors.push('Signing data payload.bytesPlain is missing or not a number')
        } else if (payloadEnc?.bytesPlain && payloadObj.bytesPlain !== payloadEnc.bytesPlain) {
          errors.push(`Signing data bytesPlain mismatch: ${payloadObj.bytesPlain} !== ${payloadEnc.bytesPlain}`)
        }
      } else if (typeof payload === 'string') {
        // Legacy string mode (backward compatible but not preferred for new packages)
        // This is acceptable for old packages
      }
    }
  }
  
  return errors
}

/**
 * Run validation and log results.
 * 
 * @param pkg - The built BeapPackage to validate
 * @returns true if valid, false otherwise
 */
export async function runBuildValidation(pkg: BeapPackage): Promise<boolean> {
  const errors = await validateBuiltQBeapPackage(pkg)
  
  if (errors.length === 0) {
    console.log('[BEAP VALIDATION] PASS')
    return true
  } else {
    console.error('[BEAP VALIDATION] FAILED with', errors.length, 'error(s):')
    for (const err of errors) {
      console.error('  -', err)
    }
    return false
  }
}
