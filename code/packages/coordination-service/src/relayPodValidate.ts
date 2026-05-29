/**
 * Relay capsule structural validation via BEAP ingestor container (fail closed).
 */

import type { RawInput } from '@repo/ingestion-core'
import type { PipelineResult } from '@repo/ingestion-core'

export type RelayPodValidateTransport = {
  source_ip?: string
}

export async function validateRelayCapsuleViaIngestor(
  ingestorBaseUrl: string,
  rawInput: RawInput,
  transportMeta?: RelayPodValidateTransport,
  timeoutMs = 15_000,
): Promise<PipelineResult> {
  const base = ingestorBaseUrl.replace(/\/$/, '')
  const url = `${base}/relay-validate`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: rawInput.body,
        mime_type: rawInput.mime_type,
        headers: rawInput.headers,
        source_type: 'coordination_service',
        transport_meta: transportMeta ?? {},
      }),
      signal: controller.signal,
    })

    const text = await res.text()
    let json: Record<string, unknown> = {}
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {}
    } catch {
      return {
        success: false,
        reason: 'Invalid ingestor relay-validate response',
      }
    }

    if (res.status === 503 || res.status === 502) {
      return {
        success: false,
        reason:
          typeof json.error === 'string'
            ? json.error
            : 'BEAP ingestor isolation unavailable',
        validation_reason_code: 'POD_REQUIRED',
      }
    }

    if (!res.ok) {
      return {
        success: false,
        reason: typeof json.reason === 'string' ? json.reason : `relay-validate HTTP ${res.status}`,
        validation_reason_code:
          typeof json.validation_reason_code === 'string'
            ? (json.validation_reason_code as PipelineResult['validation_reason_code'])
            : undefined,
      }
    }

    if (json.success === true) {
      return { success: true }
    }

    return {
      success: false,
      reason: typeof json.reason === 'string' ? json.reason : 'Relay validation failed',
      validation_reason_code:
        typeof json.validation_reason_code === 'string'
          ? (json.validation_reason_code as PipelineResult['validation_reason_code'])
          : undefined,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      reason: `BEAP ingestor unreachable: ${msg}`,
      validation_reason_code: 'POD_REQUIRED',
    }
  } finally {
    clearTimeout(timer)
  }
}
