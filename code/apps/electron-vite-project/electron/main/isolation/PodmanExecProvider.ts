/**
 * PodmanExecProvider — the working isolation backend for build001.
 *
 * Transport: podman exec -i <container> (Podman runtime socket — NOT TCP).
 * This bypasses the dead host→pod TCP path (wslrelay empty-reply on Windows;
 * rootlessport+pasta ECONNRESET on Linux) by going through the container
 * runtime API directly, immune to both failures.
 *
 * callPipeline routes:
 *   ('ingestor', 'extract-pdf', jsonBuffer) →
 *     podman exec -i beap-pod-ingestor node -e <in-pod-script>
 *     in-pod script: fetch http://127.0.0.1:18100/extract-pdf (pod-internal loopback)
 *     ↳ ingestor → depackager → pdf-parser
 *     returns: JSON { extracted_text_v1: { text, structural_hash, extractor_version } }
 *
 *   ('ingestor', 'p2p-ingest', jsonBuffer) →
 *     podman exec -i beap-pod-ingestor node -e <in-pod-script>
 *     in-pod script: POST stdin envelope to http://127.0.0.1:18100/ingest
 *     ↳ ingestor → validator → depackager → sealer (pod-internal)
 *     returns: JSON ingest response (depackaged field on qBEAP success)
 *
 * Future ops extend the route table without touching the interface.
 */

import type { CapabilityResult, IsolationProvider } from './IsolationProvider.js'
import { IsolationChannelError, IsolationNotImplementedError } from './IsolationProvider.js'
import { resolvePodmanCli } from '../local-pod/podExec.js'
import { getPodSessionAuthSecret } from '../local-pod/podSessionAuth.js'
import { getLocalPodUnavailableMessage } from '../local-pod/podStatus.js'
import {
  runPdfExtractViaPodmanExec,
  type PdfPodExecDeps,
} from '../email/pdfPodExecTransport.js'
import {
  runQbeapIngestViaPodmanExec,
  type QbeapIngestExecEnvelope,
  type QbeapPodExecDeps,
} from '../email/qbeapPodExecTransport.js'

/** Dependency injection surface for unit tests (mirrors pdfPodExecDeps). */
export type PodmanExecProviderDeps = {
  execDeps?: PdfPodExecDeps
  qbeapExecDeps?: QbeapPodExecDeps
}

export class PodmanExecProvider implements IsolationProvider {
  private readonly _deps: PodmanExecProviderDeps

  constructor(deps: PodmanExecProviderDeps = {}) {
    this._deps = deps
  }

  async detectCapability(): Promise<CapabilityResult> {
    try {
      const bin = await resolvePodmanCli()
      if (!bin) {
        return { available: false, implemented: true, tier: 'podman', details: 'podman binary not found' }
      }
      // Light check: if the pod session secret exists, pod has been initialised this session.
      const hasSession = getPodSessionAuthSecret() != null
      if (!hasSession) {
        return {
          available: false,
          implemented: true,
          tier: 'podman',
          details: 'podman found but pod not yet initialised (no session secret)',
        }
      }
      return { available: true, implemented: true, tier: 'podman', details: `podman at ${bin}` }
    } catch (e) {
      return {
        available: false,
        implemented: true,
        tier: 'podman',
        details: e instanceof Error ? e.message : String(e),
      }
    }
  }

  async ensurePipelineReady(): Promise<void> {
    // The local pod lifecycle is managed by the existing setup orchestrator
    // (local-pod/index.ts). This provider does not start/stop the pod itself
    // in Phase 1 — it assumes the pod is already running. ensurePipelineReady
    // verifies the channel is usable.
    const cap = await this.detectCapability()
    if (!cap.available) {
      throw new IsolationChannelError('podman_not_ready', cap.details)
    }
  }

  async callPipeline(role: string, op: string, payloadBytes: Buffer): Promise<Buffer> {
    // Pre-flight: confirm pod session is active.
    const secret = getPodSessionAuthSecret()
    if (!secret) {
      throw new IsolationChannelError(
        'podman_session_missing',
        getLocalPodUnavailableMessage(),
      )
    }

    if (role === 'ingestor' && op === 'extract-pdf') {
      return this._execExtractPdf(payloadBytes)
    }

    if (role === 'ingestor' && op === 'p2p-ingest') {
      return this._execP2pIngest(payloadBytes)
    }

    // Outbound roles are not yet wired into this provider.
    // See docs/outbound-pipeline-gap.md for the tracked gap.
    throw new IsolationNotImplementedError('podman', `role=${role} op=${op}`)
  }

  private async _execExtractPdf(payloadBytes: Buffer): Promise<Buffer> {
    let parsed: { message_id: string; attachment_id: string; pdf_bytes_b64: string }
    try {
      parsed = JSON.parse(payloadBytes.toString('utf8')) as typeof parsed
    } catch {
      throw new IsolationChannelError('extract_pdf_bad_payload', 'invalid JSON payload for extract-pdf')
    }
    if (!parsed.message_id || !parsed.attachment_id || !parsed.pdf_bytes_b64) {
      throw new IsolationChannelError('extract_pdf_bad_payload', 'missing required fields in extract-pdf payload')
    }

    const outcome = await runPdfExtractViaPodmanExec(parsed, this._deps.execDeps)
    if (!outcome.ok) {
      const code =
        outcome.reason === 'podman_cli_unavailable' ? 'podman_unavailable'
        : outcome.reason === 'podman_exec_failed'  ? 'exec_failed'
        : 'extract_pdf_failed'
      throw new IsolationChannelError(
        code,
        outcome.stderr.trim() || outcome.reason,
      )
    }

    return Buffer.from(outcome.stdout, 'utf8')
  }

  private async _execP2pIngest(payloadBytes: Buffer): Promise<Buffer> {
    let envelope: QbeapIngestExecEnvelope
    try {
      envelope = JSON.parse(payloadBytes.toString('utf8')) as QbeapIngestExecEnvelope
    } catch {
      throw new IsolationChannelError('p2p_ingest_bad_payload', 'invalid JSON payload for p2p-ingest')
    }
    if (
      typeof envelope.body !== 'string' ||
      envelope.source_type !== 'p2p' ||
      !envelope.depackage_keys?.x25519_priv_b64?.trim()
    ) {
      throw new IsolationChannelError(
        'p2p_ingest_bad_payload',
        'missing required fields in p2p-ingest payload',
      )
    }

    const outcome = await runQbeapIngestViaPodmanExec(envelope, this._deps.qbeapExecDeps)
    if (!outcome.ok) {
      const code =
        outcome.reason === 'podman_cli_unavailable' ? 'podman_unavailable'
        : outcome.reason === 'podman_exec_failed' ? 'exec_failed'
        : 'p2p_ingest_failed'
      throw new IsolationChannelError(
        code,
        outcome.stderr.trim() || outcome.reason,
      )
    }

    return Buffer.from(outcome.stdout, 'utf8')
  }

  async teardown(): Promise<void> {
    // Podman pod lifecycle is managed externally; nothing to do here.
  }
}
