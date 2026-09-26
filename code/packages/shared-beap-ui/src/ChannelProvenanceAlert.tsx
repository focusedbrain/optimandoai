import React from 'react'

/**
 * The §IX.3.1 rule-8 provenance alert. ONE component for every
 * channel-consequential surface — inbox message detail, the BEAP detail panel,
 * the external-link risk dialog, and (from Phase 5) the Connect offer and
 * consent preview.
 *
 * There is deliberately no dismiss, no acknowledge, and no null state once the
 * trigger holds. The art50 disclosure pattern is NOT reused here: that one
 * carries acknowledgement state, and an acknowledged warning is a warning the
 * operator can be trained to click away. Secure-Browse policy may ESCALATE
 * this (up to blocking external-link opening from unauthenticated channels),
 * never remove it.
 *
 * The component owns the trigger rule rather than accepting a boolean, so no
 * caller can render the alert under its own idea of when it applies — the
 * decision register requires identical verdict semantics on every surface, and
 * a per-caller predicate is exactly how that drifts.
 */

export type ChannelAlertVerdict = 'pass' | 'fail' | 'none' | 'unverifiable'

const CHANNEL_ALERT_VERDICTS: readonly ChannelAlertVerdict[] = [
  'pass',
  'fail',
  'none',
  'unverifiable',
]

/**
 * Structurally typed to the two fields the rule reads, so this package needs no
 * dependency on `@repo/ingestion-core` and stays consumable by both apps. The
 * rule is kept honest against the canonical `channelAlertRequired` by a
 * cross-check test over the full verdict cross-product.
 */
export interface ChannelProvenanceAlertRecord {
  dkim: { verdict: ChannelAlertVerdict }
  dmarc: { verdict: ChannelAlertVerdict }
}

function isChannelAlertVerdict(value: unknown): value is ChannelAlertVerdict {
  return (
    typeof value === 'string' &&
    (CHANNEL_ALERT_VERDICTS as readonly string[]).includes(value)
  )
}

/**
 * Fail-closed structural extract of the two fields the alert rule reads.
 * Accepts a full CPR, a `depackaged_metadata` blob (object or JSON string), or
 * an already-narrow alert record. Returns `null` when the two verdicts are not
 * present — callers then render nothing rather than inventing a trigger.
 */
export function channelProvenanceAlertRecordFromUnknown(
  raw: unknown,
): ChannelProvenanceAlertRecord | null {
  let value: unknown = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (typeof value !== 'object' || value === null) return null
  const obj = value as Record<string, unknown>
  const nested =
    obj.channel_provenance && typeof obj.channel_provenance === 'object'
      ? (obj.channel_provenance as Record<string, unknown>)
      : obj
  const dkim = nested.dkim
  const dmarc = nested.dmarc
  if (typeof dkim !== 'object' || dkim === null) return null
  if (typeof dmarc !== 'object' || dmarc === null) return null
  const dkimVerdict = (dkim as Record<string, unknown>).verdict
  const dmarcVerdict = (dmarc as Record<string, unknown>).verdict
  if (!isChannelAlertVerdict(dkimVerdict) || !isChannelAlertVerdict(dmarcVerdict)) {
    return null
  }
  return {
    dkim: { verdict: dkimVerdict },
    dmarc: { verdict: dmarcVerdict },
  }
}

/** §IX.3.1 rule 8: DKIM AND DMARC absent or unverifiable. */
export function channelAlertRequiredForDisplay(
  record: ChannelProvenanceAlertRecord | null | undefined,
): boolean {
  if (!record) return false
  const absent = (v: ChannelAlertVerdict): boolean => v === 'none' || v === 'unverifiable'
  return absent(record.dkim?.verdict) && absent(record.dmarc?.verdict)
}

export interface ChannelProvenanceAlertProps {
  /** The message's Channel Provenance Record. `null` renders nothing. */
  record: ChannelProvenanceAlertRecord | null | undefined
  /**
   * Surface identifier, for test and telemetry attribution only. It cannot
   * change copy, styling, or the trigger — per-surface divergence is the thing
   * this component exists to prevent.
   */
  surface: string
}

export function ChannelProvenanceAlert({ record, surface }: ChannelProvenanceAlertProps) {
  if (!channelAlertRequiredForDisplay(record)) return null

  return (
    <div className="beap-ui-provenance-alert" role="alert" data-surface={surface}>
      <span className="beap-ui-provenance-alert-icon" aria-hidden="true">
        ⚠
      </span>
      <div className="beap-ui-provenance-alert-copy">
        <strong className="beap-ui-provenance-alert-title">
          This sender could not be verified
        </strong>
        <p className="beap-ui-provenance-alert-text">
          The mail server could not confirm who sent this message. That does not
          mean it is malicious — it means its origin is unproven. Any links,
          codes, or attachments it carries therefore have no verified origin
          either, whatever the message says about itself.
        </p>
      </div>
    </div>
  )
}
