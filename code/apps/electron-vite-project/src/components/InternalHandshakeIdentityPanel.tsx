/**
 * Internal same-account handshake: Host / Sandbox roles, device ids, coordination completeness.
 * Only rendered when handshake_type === 'internal'.
 */

import type { InternalIdentitySource } from '@shared/handshake/internalIdentityUi'
import {
  isInternalHandshake,
  localCoordinationDeviceId,
  localOrchestratorKind,
  orchestratorUserLabel,
  peerCoordinationDeviceId,
  peerDeviceDisplayName,
  peerOrchestratorKind,
  peerStableIdentifier,
  shortDeviceIdForUi,
  internalIdentityNeedsAttention,
} from '@shared/handshake/internalIdentityUi'

function row(label: string, value: string) {
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
          color: 'var(--color-text, #e2e8f0)',
          textAlign: 'right',
          wordBreak: 'break-all',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      >
        {value}
      </span>
    </div>
  )
}

export function InternalHandshakeIdentityPanel({ record }: { record: InternalIdentitySource }) {
  if (!isInternalHandshake(record)) return null

  const localKind = localOrchestratorKind(record)
  const peerKind = peerOrchestratorKind(record)
  const localId = localCoordinationDeviceId(record)
  const peerSid = peerStableIdentifier(record)
  const peerIdDisplay = peerSid.text
  const peerIdShort = peerSid.kind === 'unknown' ? peerSid.text : shortDeviceIdForUi(peerSid.text)
  const peerName = peerDeviceDisplayName(record)
  const comp = record.internal_peer_computer_name?.trim()
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
      {row('This device', orchestratorUserLabel(localKind))}
      {row('This device ID', localId ? shortDeviceIdForUi(localId) : 'unknown / pending repair')}
      {row('Peer', orchestratorUserLabel(peerKind))}
      {peerName ? row('Peer name', peerName) : null}
      {comp ? row('Peer computer', comp) : null}
      {row('Peer device ID', peerIdDisplay)}
      {peerSid.kind !== 'unknown' && peerIdDisplay.length > 24 ? (
        <div style={{ fontSize: '10px', color: 'var(--color-text-muted, #94a3b8)', marginTop: '4px' }}>Short: {peerIdShort}</div>
      ) : null}
      {row('Coordination ID complete', complete ? 'Yes' : 'No')}
    </div>
  )
}
