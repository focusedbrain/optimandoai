/**
 * Internal same-account handshake: Host / Sandbox roles, human-facing ids, debug UUIDs.
 * Only rendered when handshake_type === 'internal'.
 */

import { useState } from 'react'
import type { InternalIdentitySource } from '@shared/handshake/internalIdentityUi'
import {
  isInternalHandshake,
  localCoordinationDeviceId,
  localOrchestratorKind,
  orchestratorUserLabel,
  formatInternalPairingIdLine,
  formatInternalPrimaryLine,
  peerStableIdentifier,
  shortDeviceIdForUi,
  internalIdentityNeedsAttention,
} from '@shared/handshake/internalIdentityUi'

function row(label: string, value: string, options?: { mono?: boolean; muted?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: '12px',
        padding: '5px 0',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <span
        style={{
          fontSize: '10px',
          fontWeight: 600,
          color: 'var(--color-text-muted, #94a3b8)',
          textTransform: 'uppercase',
          letterSpacing: '0.4px',
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: '12px',
          color: options?.muted ? 'var(--color-text-muted, #94a3b8)' : 'var(--color-text, #e2e8f0)',
          textAlign: 'right',
          wordBreak: 'break-word',
          fontFamily: options?.mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'inherit',
        }}
      >
        {value}
      </span>
    </div>
  )
}

export function InternalHandshakeIdentityPanel({ record }: { record: InternalIdentitySource }) {
  const [showTechnical, setShowTechnical] = useState(false)
  if (!isInternalHandshake(record)) return null

  const localKind = localOrchestratorKind(record)
  const primary = formatInternalPrimaryLine(record)
  const pairingLine = formatInternalPairingIdLine(record)
  const localId = localCoordinationDeviceId(record)
  const peerSid = peerStableIdentifier(record)
  const peerIdFull = peerSid.text
  const needsAttention = internalIdentityNeedsAttention(record)
  const complete = record.internal_coordination_identity_complete === true

  return (
    <div
      style={{
        marginBottom: '14px',
        padding: '12px 14px',
        borderRadius: '8px',
        border: needsAttention ? '1px solid rgba(245,158,11,0.45)' : '1px solid rgba(83,74,183,0.35)',
        background: needsAttention ? 'rgba(245,158,11,0.08)' : 'rgba(83,74,183,0.08)',
      }}
    >
      <div
        style={{
          fontSize: '11px',
          fontWeight: 700,
          color: '#534AB7',
          marginBottom: '8px',
          letterSpacing: '0.02em',
        }}
      >
        Internal orchestrators (this account)
      </div>
      {needsAttention && (
        <div
          style={{
            fontSize: '11px',
            color: '#f59e0b',
            marginBottom: '10px',
            lineHeight: 1.45,
          }}
        >
          {record.internal_coordination_repair_needed
            ? 'Coordination identity needs repair — finish pairing or re-establish this handshake before relying on relay delivery.'
            : 'Internal coordination identity is incomplete — confirm both devices are paired and registered.'}
        </div>
      )}

      <div
        style={{
          fontSize: '12px',
          fontWeight: 600,
          color: 'var(--color-text, #e2e8f0)',
          lineHeight: 1.45,
          marginBottom: pairingLine ? '4px' : '10px',
        }}
      >
        {primary}
      </div>
      {pairingLine && (
        <div
          style={{
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--color-text-muted, #a5b4ca)',
            marginBottom: '10px',
          }}
        >
          {pairingLine}
        </div>
      )}

      {row('This device', orchestratorUserLabel(localKind))}
      {row('Coordination ID complete', complete ? 'Yes' : 'No')}

      <button
        type="button"
        onClick={() => setShowTechnical((v) => !v)}
        style={{
          marginTop: '8px',
          marginBottom: showTechnical ? '6px' : 0,
          padding: '4px 0',
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          color: 'var(--color-text-muted, #94a3b8)',
          fontSize: '10px',
          fontWeight: 600,
          textAlign: 'left',
        }}
      >
        {showTechnical ? '▾' : '▸'} Technical / debug (device UUIDs)
      </button>
      {showTechnical && (
        <div
          style={{
            padding: '8px 10px',
            borderRadius: '6px',
            background: 'rgba(0,0,0,0.2)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          {row('Device UUID (this device)', localId && localId.length > 0 ? localId : '—', { mono: true, muted: true })}
          {row(
            'Device UUID (peer)',
            peerSid.kind === 'unknown' ? peerIdFull : peerIdFull,
            { mono: true, muted: true },
          )}
          {peerSid.kind !== 'unknown' && peerIdFull.length > 24 ? (
            <div style={{ fontSize: '10px', color: 'var(--color-text-muted, #94a3b8)', marginTop: '4px' }}>
              Short: {shortDeviceIdForUi(peerIdFull)}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
