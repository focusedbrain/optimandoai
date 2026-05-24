/**
 * BEAP 6-gate depackaging pipeline — pod depackager role.
 *
 * Ported from (do NOT import these directly in the pod):
 *   apps/electron-vite-project/electron/main/beap/decryptQBeapPackage.ts
 *   apps/electron-vite-project/electron/main/beap/beapEnvelopeAad.ts
 *   apps/extension-chromium/src/beap-messages/services/depackagingPipeline.ts
 *
 * Deviations from source:
 *   – No Electron DB / getHandshakeRecord; keys supplied by caller (config/env).
 *   – No extension beapCrypto.ts imports; uses webcrypto + @noble libs directly.
 *   – pBEAP: Buffer.from(b64,'base64') instead of atob().
 *   – Gate 5 signature verification deferred (P1.11); skipped by default.
 *   – Gate 1 sender-set matching: structural-only (no knownSenders in P1.5).
 */

import { webcrypto } from 'node:crypto';
import { x25519 } from '@noble/curves/ed25519.js';
import { ml_kem768 } from '@noble/post-quantum/ml-kem';

const wc = webcrypto as Crypto;

// ── Size limits (Canon §10 — strictly bounded inputs) ─────────────────────────
// Source: apps/extension-chromium/.../depackagingPipeline.ts

const MAX_CAPSULE_BYTES = 4 * 1024 * 1024;
const MAX_ARTEFACT_COUNT = 64;
const MAX_CHUNK_COUNT = 256;
const MAX_FINGERPRINT_LENGTH = 512;

const ACCEPTED_VERSIONS: ReadonlySet<string> = new Set(['1.0', '2.0']);
const ACCEPTED_ENCODINGS: ReadonlySet<string> = new Set(['qBEAP', 'pBEAP']);

// HKDF labels — must match extension / sender exactly.
// Source: apps/electron-vite-project/.../decryptQBeapPackage.ts
const HKDF_CAPSULE = 'BEAP v1 capsule';
const HKDF_ARTEFACT = 'BEAP v1 artefact';
// (inner-envelope key derived but not used in P1.5)

// ── Local wire-format types ────────────────────────────────────────────────────
// Not imported from extension. Matches the serialised qBEAP / pBEAP wire shape.

interface BeapPackageCrypto {
  senderX25519PublicKeyB64?: string;
  salt?: string;
  suiteId?: string;
  handshake_id?: string;
  pq?: { kemCiphertextB64?: string; required?: boolean; kem?: string };
}

interface ChunkEntry {
  index?: number;
  nonce: string;
  ciphertext: string;
  sha256?: string;
  tag?: string;
  authTag?: string;
  gcmTag?: string;
}

interface PayloadEnc {
  nonce?: string;
  ciphertext?: string;
  sha256Plain?: string;
  tag?: string;
  authTag?: string;
  chunking?: { enabled?: boolean; chunks?: ChunkEntry[]; merkleRoot?: string };
  chunks?: ChunkEntry[];
}

interface ArtefactEnc {
  nonce?: string;
  ciphertext?: string;
  attachmentId?: string;
  id?: string;
  filename?: string;
  mime?: string;
  sha256Plain?: string;
  tag?: string;
  authTag?: string;
  gcmTag?: string;
  chunking?: { enabled?: boolean; chunks?: ChunkEntry[] };
  chunks?: ChunkEntry[];
  artefactRef?: string;
  bytesPlain?: number;
}

export interface LocalBeapHeader {
  version: string;
  encoding: string;
  encryption_mode?: string;
  timestamp?: number;
  sender_fingerprint?: string;
  template_hash?: string;
  policy_hash?: string;
  content_hash?: string;
  receiver_fingerprint?: string;
  receiver_binding?: { handshake_id?: string };
  signing?: { publicKey?: string; algorithm?: string; keyId?: string };
  crypto?: BeapPackageCrypto;
  sizeLimits?: Record<string, unknown>;
  processingEvents?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface LocalBeapPackage {
  header: LocalBeapHeader;
  metadata?: Record<string, unknown>;
  payload?: string;             // pBEAP: base64 plaintext
  payloadEnc?: PayloadEnc;      // qBEAP: encrypted payload
  artefactsEnc?: ArtefactEnc[]; // qBEAP: encrypted artefacts
  artefacts?: Array<{ artefactRef?: string; sha256?: string }>;
  innerEnvelopeCiphertext?: string;
  signature?: { signature?: string; sig?: string; value?: string; algorithm?: string; keyId?: string };
  // Validator adds these extra fields — ignored by the pipeline
  capsule_type?: string;
  content_type?: string;
  schema_version?: number;
  handshake_id?: string;
  [key: string]: unknown;
}

// ── Pipeline result ────────────────────────────────────────────────────────────

export interface DepackageSuccess {
  success: true;
  capsulePlaintext: string;
  encoding: 'qBEAP' | 'pBEAP';
  handshakeId: string | undefined;
  capsuleKey: Uint8Array;
  artefactKey: Uint8Array;
  artefactCount: number;
}

export interface DepackageFailure {
  success: false;
  failedGate: 1 | 2 | 3 | 4 | 5 | 6;
  internalError: string;
  nonDisclosingError: 'Package verification failed' | 'Package decryption failed' | 'Not for this recipient';
}

export type DepackagePipelineResult = DepackageSuccess | DepackageFailure;

// ── Crypto helpers ─────────────────────────────────────────────────────────────
// Ported from apps/electron-vite-project/electron/main/beap/decryptQBeapPackage.ts

export function fromBase64(s: string): Uint8Array {
  return Buffer.from(s.trim(), 'base64');
}

export function toBase64(u: Uint8Array): string {
  return Buffer.from(u).toString('base64');
}

/** HKDF-SHA256. Source: decryptQBeapPackage.ts::hkdfDerive */
export async function hkdfDerive(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: string,
  length: number,
): Promise<Uint8Array> {
  // Buffer.from() ensures the underlying .buffer is ArrayBuffer, satisfying WebCrypto types.
  const keyMaterial = await wc.subtle.importKey('raw', Buffer.from(ikm), 'HKDF', false, ['deriveBits']);
  const bits = await wc.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: Buffer.from(salt), info: new TextEncoder().encode(info) },
    keyMaterial,
    length * 8,
  );
  return new Uint8Array(bits);
}

/** AES-256-GCM decrypt. Appends separate tag if provided. */
export async function aesGcmDecrypt(
  keyBytes: Uint8Array,
  nonceB64: string,
  ciphertextB64: string,
  aad?: Uint8Array,
  tagB64?: string,
): Promise<Uint8Array> {
  const key = await wc.subtle.importKey('raw', Buffer.from(keyBytes), { name: 'AES-GCM' }, false, ['decrypt']);
  const iv = fromBase64(nonceB64);
  let data = Buffer.from(fromBase64(ciphertextB64));
  if (tagB64 && tagB64.trim()) {
    data = Buffer.concat([data, Buffer.from(fromBase64(tagB64.trim()))]);
  }
  const algo = aad && aad.length > 0
    ? { name: 'AES-GCM' as const, iv, additionalData: Buffer.from(aad) }
    : { name: 'AES-GCM' as const, iv };
  const decrypted = await wc.subtle.decrypt(algo, key, data);
  return new Uint8Array(decrypted);
}

async function sha256Bytes(u: Uint8Array): Promise<Uint8Array> {
  const hash = await wc.subtle.digest('SHA-256', Buffer.from(u));
  return new Uint8Array(hash);
}

// ── Envelope AAD helpers ───────────────────────────────────────────────────────
// Ported from apps/electron-vite-project/electron/main/beap/beapEnvelopeAad.ts

function stableCanonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value.map((v) => stableCanonicalize(v)).filter((v) => v !== undefined);
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const cv = stableCanonicalize(obj[key]);
      if (cv !== undefined) result[key] = cv;
    }
    return result;
  }
  return value;
}

export function computeEnvelopeAadBytes(header: LocalBeapHeader): Uint8Array {
  const aadFields: Record<string, unknown> = {
    version: header.version,
    encoding: header.encoding,
    encryption_mode: header.encryption_mode,
    timestamp: header.timestamp,
    sender_fingerprint: header.sender_fingerprint,
    template_hash: header.template_hash,
    policy_hash: header.policy_hash,
    content_hash: header.content_hash,
  };
  if (header.receiver_fingerprint !== undefined) {
    aadFields['receiver_fingerprint'] = header.receiver_fingerprint;
  }
  if (header.crypto) {
    const c: Record<string, unknown> = {
      suiteId: header.crypto.suiteId,
      salt: header.crypto.salt,
      handshake_id: header.crypto.handshake_id,
      senderX25519PublicKeyB64: header.crypto.senderX25519PublicKeyB64,
    };
    if (header.crypto.pq) {
      c['pq'] = { required: header.crypto.pq.required, kem: header.crypto.pq.kem, kemCiphertextB64: header.crypto.pq.kemCiphertextB64 };
    }
    aadFields['crypto'] = c;
  }
  if (header.sizeLimits !== undefined) aadFields['sizeLimits'] = header.sizeLimits;
  if (header.processingEvents !== undefined) aadFields['processingEvents'] = header.processingEvents;

  const canonical = stableCanonicalize(aadFields);
  return new TextEncoder().encode(JSON.stringify(canonical));
}

// ── Chunk helpers ──────────────────────────────────────────────────────────────
// Source: decryptQBeapPackage.ts::getPayloadChunks / getArtefactChunks

function resolveChunks(enc: Record<string, unknown>): ChunkEntry[] | null {
  const ch = enc['chunking'] as Record<string, unknown> | undefined;
  if (ch?.['enabled'] === true && Array.isArray(ch['chunks'])) return ch['chunks'] as ChunkEntry[];
  if (ch?.['enabled'] === true && Array.isArray(enc['chunks'])) return enc['chunks'] as ChunkEntry[];
  if (Array.isArray(enc['chunks'])) return enc['chunks'] as ChunkEntry[];
  return null;
}

async function decryptChunkSequence(
  key: Uint8Array,
  chunks: ChunkEntry[],
  aad?: Uint8Array,
): Promise<Uint8Array> {
  const sorted = [...chunks].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const parts: Uint8Array[] = [];
  for (const chunk of sorted) {
    const tag = chunk.tag ?? chunk.authTag ?? chunk.gcmTag;
    parts.push(await aesGcmDecrypt(key, chunk.nonce, chunk.ciphertext, aad, tag));
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ── Non-disclosing error helper ────────────────────────────────────────────────
// Source: depackagingPipeline.ts::nonDisclosingError

function nonDisclosingError(gate: 1 | 2 | 3 | 4 | 5 | 6): DepackageFailure['nonDisclosingError'] {
  if (gate <= 2) return 'Not for this recipient';
  if (gate === 4) return 'Package decryption failed';
  return 'Package verification failed';
}

function fail(gate: 1 | 2 | 3 | 4 | 5 | 6, msg: string): DepackageFailure {
  return { success: false, failedGate: gate, internalError: msg, nonDisclosingError: nonDisclosingError(gate) };
}

// ── 6-Gate Pipeline ────────────────────────────────────────────────────────────
// Structure ported from depackagingPipeline.ts; key derivation from decryptQBeapPackage.ts.

export interface PipelineConfig {
  localX25519PrivB64: string;
  localMlkemSecretB64?: string;
  skipSignatureVerification?: boolean;
}

/** Run the canonical 6-gate depackaging pipeline. */
export async function runDepackagePipeline(
  pkg: LocalBeapPackage,
  config: PipelineConfig,
): Promise<DepackagePipelineResult> {

  // ── Gate 1: Sender Identity (structural checks only — no knownSenders in P1.5) ─
  if (!pkg.header || typeof pkg.header !== 'object') return fail(1, 'GATE1: Missing or non-object header');
  if (!ACCEPTED_VERSIONS.has(String(pkg.header.version ?? ''))) return fail(1, `GATE1: Unsupported version '${pkg.header.version}'`);
  if (!ACCEPTED_ENCODINGS.has(String(pkg.header.encoding ?? ''))) return fail(1, `GATE1: Invalid encoding '${pkg.header.encoding}'`);
  const sender_fp = pkg.header.sender_fingerprint;
  if (!sender_fp) return fail(1, 'GATE1: Missing sender_fingerprint');
  if (String(sender_fp).length > MAX_FINGERPRINT_LENGTH) return fail(1, 'GATE1: sender_fingerprint too long');
  if (!pkg.header.template_hash || !pkg.header.policy_hash || !pkg.header.content_hash) return fail(1, 'GATE1: Missing commitment hash(es)');
  const sigField = pkg.signature;
  if (!sigField?.signature && !sigField?.sig && !sigField?.value) return fail(1, 'GATE1: Missing signature field');

  const encoding = pkg.header.encoding as 'qBEAP' | 'pBEAP';
  const handshakeId = pkg.header.receiver_binding?.handshake_id ?? pkg.handshake_id as string | undefined;

  // ── Gate 2: Receiver Identity ──────────────────────────────────────────────
  if (encoding === 'qBEAP') {
    const hasBinding = Boolean(pkg.header.receiver_binding?.handshake_id);
    const hasFp = typeof pkg.header.receiver_fingerprint === 'string' && pkg.header.receiver_fingerprint.length > 0;
    if (!hasBinding && !hasFp) return fail(2, 'GATE2: qBEAP missing receiver_binding and receiver_fingerprint');
  }

  // ── Gate 3: Ciphertext Integrity ───────────────────────────────────────────
  if (encoding === 'qBEAP') {
    const pEnc = pkg.payloadEnc;
    if (!pEnc) return fail(3, 'GATE3: qBEAP missing payloadEnc');
    const isChunked = pEnc.chunking?.enabled === true && Array.isArray(pEnc.chunking.chunks);
    if (isChunked) {
      const chunks = pEnc.chunking!.chunks!;
      if (chunks.length === 0) return fail(3, 'GATE3: Chunked payload has zero chunks');
      if (chunks.length > MAX_CHUNK_COUNT) return fail(3, `GATE3: Chunk count ${chunks.length} > max ${MAX_CHUNK_COUNT}`);
      if (!pEnc.chunking!.merkleRoot) return fail(3, 'GATE3: Chunked payload missing merkleRoot');
      for (let i = 0; i < chunks.length; i++) {
        if (!chunks[i]!.nonce || !chunks[i]!.ciphertext) return fail(3, `GATE3: Chunk ${i} missing nonce or ciphertext`);
        if (chunks[i]!.sha256 && chunks[i]!.sha256!.length !== 64) return fail(3, `GATE3: Chunk ${i} malformed sha256`);
      }
    } else {
      if (!pEnc.nonce || !pEnc.ciphertext) return fail(3, 'GATE3: Legacy qBEAP missing nonce or ciphertext');
      const ctLen = fromBase64(pEnc.ciphertext).length;
      if (ctLen > MAX_CAPSULE_BYTES + 28) return fail(3, 'GATE3: Ciphertext exceeds max capsule size');
    }
    const artCount = pkg.artefactsEnc?.length ?? 0;
    if (artCount > MAX_ARTEFACT_COUNT) return fail(3, `GATE3: Artefact count ${artCount} > max ${MAX_ARTEFACT_COUNT}`);
  } else {
    // pBEAP
    if (!pkg.payload) return fail(3, 'GATE3: pBEAP missing payload');
    const b64Limit = Math.ceil(MAX_CAPSULE_BYTES * 4 / 3) + 4;
    if (pkg.payload.length > b64Limit) return fail(3, 'GATE3: pBEAP payload base64 exceeds max capsule size');
  }

  // ── Gate 4: PQ Key Derivation + Decryption ─────────────────────────────────
  let capsulePlaintext: string;
  let capsuleKey: Uint8Array;
  let artefactKey: Uint8Array;

  if (encoding === 'qBEAP') {
    const cryptoHdr = pkg.header.crypto;
    const senderKeyB64 = cryptoHdr?.senderX25519PublicKeyB64?.trim() ?? '';
    if (!senderKeyB64) return fail(4, 'GATE4: Missing senderX25519PublicKeyB64');
    const saltB64 = cryptoHdr?.salt?.trim() ?? '';
    if (!saltB64) return fail(4, 'GATE4: Missing salt');

    const localPrivB64 = config.localX25519PrivB64.trim();
    if (!localPrivB64) return fail(4, 'GATE4: localX25519PrivB64 not configured');

    let sharedSecret: Uint8Array;
    try {
      const localPriv = fromBase64(localPrivB64);
      const peerPub = fromBase64(senderKeyB64);
      if (localPriv.length !== 32 || peerPub.length !== 32) return fail(4, 'GATE4: Invalid X25519 key length');
      // Source: decryptQBeapPackage.ts — receiver priv × sender pub
      const x25519Secret = x25519.getSharedSecret(localPriv, peerPub);

      const pq = cryptoHdr?.pq;
      const kemCiphertextB64 = pq?.kemCiphertextB64?.trim() ?? '';
      if (kemCiphertextB64) {
        const mlkemSecB64 = config.localMlkemSecretB64?.trim() ?? '';
        if (!mlkemSecB64) return fail(4, 'GATE4: Hybrid package requires localMlkemSecretB64');
        const ct = fromBase64(kemCiphertextB64);
        const sk = fromBase64(mlkemSecB64);
        // Source: decryptQBeapPackage.ts — hybrid order: ML-KEM first, then X25519 (64 bytes)
        const mlkemSecret = ml_kem768.decapsulate(ct, sk);
        const hybrid = new Uint8Array(mlkemSecret.length + x25519Secret.length);
        hybrid.set(mlkemSecret, 0);
        hybrid.set(x25519Secret, mlkemSecret.length);
        sharedSecret = hybrid;
      } else {
        sharedSecret = x25519Secret;
      }
    } catch (e) {
      return fail(4, `GATE4: Key material error: ${e instanceof Error ? e.message : String(e)}`);
    }

    try {
      const saltBytes = fromBase64(saltB64);
      capsuleKey = await hkdfDerive(sharedSecret, saltBytes, HKDF_CAPSULE, 32);
      artefactKey = await hkdfDerive(sharedSecret, saltBytes, HKDF_ARTEFACT, 32);
    } catch (e) {
      return fail(4, `GATE4: HKDF failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Compute AAD — source: beapEnvelopeAad.ts::computeEnvelopeAadBytes
    let aadBytes: Uint8Array | undefined;
    const aadRaw = computeEnvelopeAadBytes(pkg.header);
    if (aadRaw.length > 0) aadBytes = aadRaw;

    try {
      const pEnc = pkg.payloadEnc!;
      const isChunked = pEnc.chunking?.enabled === true && Array.isArray(pEnc.chunking.chunks);
      if (isChunked) {
        const plainParts = await decryptChunkSequence(capsuleKey, pEnc.chunking!.chunks!, aadBytes);
        if (plainParts.length > MAX_CAPSULE_BYTES) return fail(4, 'GATE4: Decrypted payload exceeds max capsule size');
        capsulePlaintext = new TextDecoder().decode(plainParts);
      } else {
        const chunks = resolveChunks(pEnc as unknown as Record<string, unknown>);
        if (chunks && chunks.length > 0) {
          const plain = await decryptChunkSequence(capsuleKey, chunks, aadBytes);
          if (plain.length > MAX_CAPSULE_BYTES) return fail(4, 'GATE4: Decrypted payload exceeds max capsule size');
          capsulePlaintext = new TextDecoder().decode(plain);
        } else {
          const tag = pEnc.tag ?? pEnc.authTag;
          const plain = await aesGcmDecrypt(capsuleKey, pEnc.nonce!, pEnc.ciphertext!, aadBytes, tag);
          if (plain.length > MAX_CAPSULE_BYTES) return fail(4, 'GATE4: Decrypted payload exceeds max capsule size');
          capsulePlaintext = new TextDecoder().decode(plain);
        }
      }

      // Verify sha256Plain if present
      if (pEnc.sha256Plain?.trim()) {
        const actualHash = Buffer.from(await sha256Bytes(new TextEncoder().encode(capsulePlaintext))).toString('hex');
        if (actualHash.toLowerCase() !== pEnc.sha256Plain.trim().toLowerCase()) {
          return fail(4, 'GATE4: sha256Plain mismatch after decryption');
        }
      }
    } catch (e) {
      return fail(4, `GATE4: Decryption failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    // pBEAP: payload is base64 plaintext
    try {
      capsulePlaintext = Buffer.from(pkg.payload!, 'base64').toString('utf8');
    } catch {
      return fail(4, 'GATE4: pBEAP payload base64 decode failed');
    }
    if (capsulePlaintext.length > MAX_CAPSULE_BYTES) return fail(4, 'GATE4: pBEAP decoded payload exceeds max capsule size');
    capsuleKey = new Uint8Array(32);
    artefactKey = new Uint8Array(32);
  }

  // ── Gate 5: Capsule Signature Verification ─────────────────────────────────
  // P1.5 default: skipSignatureVerification = true (sender pub key not yet injected).
  // Full Ed25519 verification wired in P1.11.
  const skip = config.skipSignatureVerification !== false; // default true
  if (!skip) {
    // Signature fields already confirmed present at Gate 1.
    // TODO P1.11: verify Ed25519 over (canonicalHeader + payloadCommitment + artefactsManifest)
    return fail(5, 'GATE5: Ed25519 verification not yet implemented (P1.11)');
  }

  // ── Gate 6: Template Hash Structural Validity ──────────────────────────────
  const { template_hash, content_hash } = pkg.header;
  if (!template_hash || typeof template_hash !== 'string') return fail(6, 'GATE6: Missing template_hash');
  if (template_hash.length !== 64 || !/^[0-9a-f]+$/i.test(template_hash)) return fail(6, 'GATE6: template_hash not valid SHA-256 hex');
  if (!content_hash || typeof content_hash !== 'string') return fail(6, 'GATE6: Missing content_hash');
  if (content_hash.length !== 64 || !/^[0-9a-f]+$/i.test(content_hash)) return fail(6, 'GATE6: content_hash not valid SHA-256 hex');

  return {
    success: true,
    capsulePlaintext,
    encoding,
    handshakeId,
    capsuleKey,
    artefactKey,
    artefactCount: pkg.artefactsEnc?.length ?? pkg.artefacts?.length ?? 0,
  };
}
