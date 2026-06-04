/**
 * Depackage parity — InProcessExecutor.run({kind:'depackage'}) must be
 * semantically equal to the existing pure worker `depackage()` over a corpus of
 * inputs. "Semantically equal" = same subject + body_text + attachment count +
 * the SAME set of recovered (decrypted) artifact plaintexts. jobIds, signatures,
 * and the worker's random blob_ids legitimately differ.
 *
 * Build B's email-path cutover regression reuses DEPACKAGE_PARITY_CORPUS.
 */

import { describe, test, expect } from 'vitest'
import { x25519 } from '@noble/curves/ed25519'
import { depackage, type BlobArtifact } from '../../depackaging-microvm/depackagingWorker'
import { decryptQuarantineBlob } from '../../quarantine-encrypt/index'
import type { QuarantineBlobFile } from '../../quarantine-blob-storage/index'
import { InProcessExecutor } from '../executors/inProcessExecutor'
import type { CourierArtifactRecord } from '../../depackaging-microvm/blindCourier'
import { DEPACKAGE_PARITY_CORPUS } from './depackageParityCorpus'

function keys() {
  const priv = x25519.utils.randomPrivateKey()
  return {
    privB64: Buffer.from(priv).toString('base64'),
    pubB64: Buffer.from(x25519.getPublicKey(priv)).toString('base64'),
  }
}

function recoveredSet(
  blobs: ReadonlyArray<{ content_type: string; blob: QuarantineBlobFile }>,
  privB64: string,
): string[] {
  return blobs
    .map(({ content_type, blob }) => {
      const r = decryptQuarantineBlob(blob, privB64)
      return r.ok ? `${content_type}::${r.plaintext.toString('utf8')}` : `FAIL::${content_type}`
    })
    .sort()
}

describe('InProcessExecutor depackage parity with the pure worker', () => {
  const exec = new InProcessExecutor('sandbox')

  for (const c of DEPACKAGE_PARITY_CORPUS) {
    test(`parity: ${c.name}`, async () => {
      const k = keys()
      const direct = depackage(c.bytes, k.pubB64)
      const res = await exec.run({
        jobId: `parity-${c.name}`,
        kind: 'depackage',
        input: { inputBytes: c.bytes },
        custodyPubKeyB64: k.pubB64,
        limits: { maxWallClockMs: 5000 },
        flush: 'per-action',
      })

      expect(res.ok).toBe(true)
      const out = res.output!

      // Same constructed safe-text (modulo random blob_ids in attachment_refs).
      expect(out.safeText.subject).toBe(direct.safeText.subject)
      expect(out.safeText.body_text).toBe(direct.safeText.body_text)
      expect(out.safeText.attachment_refs.length).toBe(direct.safeText.attachment_refs.length)

      if (c.expectBodyIncludes) {
        expect(out.safeText.body_text).toContain(c.expectBodyIncludes)
      }
      const safeTextBlob = JSON.stringify(out.safeText)
      for (const forbidden of c.forbidInSafeText) {
        expect(safeTextBlob).not.toContain(forbidden)
      }

      // Same recovered artifact plaintexts (executor uses `.ciphertext`, the pure
      // worker uses `.blob`; both are the same QuarantineBlobFile shape).
      const execSet = recoveredSet(
        (out.artifacts as readonly CourierArtifactRecord[]).map((a) => ({
          content_type: a.content_type,
          blob: a.ciphertext,
        })),
        k.privB64,
      )
      const directSet = recoveredSet(
        (direct.artifacts as readonly BlobArtifact[]).map((a) => ({
          content_type: a.content_type,
          blob: a.blob,
        })),
        k.privB64,
      )
      expect(execSet).toEqual(directSet)

      for (const marker of c.expectArtifactPlaintexts) {
        expect(execSet.some((s) => s.includes(marker))).toBe(true)
      }
    })
  }
})
