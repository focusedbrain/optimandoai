import React from 'react'
import type { OutboundRequestDebugSnapshot } from '../handshake/handshakeRpc'

export function P2pOutboundDebugModal(props: {
  debug: OutboundRequestDebugSnapshot | null
  onClose: () => void
}): React.ReactElement | null {
  const { debug, onClose } = props
  if (!debug) return null

  const lines = [
    `url: ${debug.url}`,
    `method: ${debug.method}`,
    `content_type: ${debug.content_type}`,
    `content_length_bytes: ${debug.content_length_bytes}`,
    `body_type: ${debug.body_type}`,
    `top_level_keys: ${JSON.stringify(debug.top_level_keys)}`,
    `body_looks_double_encoded: ${debug.body_looks_double_encoded}`,
    `route: ${debug.route}`,
    `http_status: ${debug.http_status}`,
    ...(debug.response_body_snippet != null && debug.response_body_snippet.length > 0
      ? [`response_body_snippet: ${debug.response_body_snippet}`]
      : []),
    ...(debug.transport_error ? [`transport_error: ${debug.transport_error}`] : []),
    ...(debug.coordination_single_post_json != null
      ? [`coordination_single_post_json: ${debug.coordination_single_post_json}`]
      : []),
    ...(debug.expected_coordination_routing_keys != null
      ? [`expected_coordination_routing_keys: ${JSON.stringify(debug.expected_coordination_routing_keys)}`]
      : []),
    ...(debug.missing_coordination_top_level_fields != null && debug.missing_coordination_top_level_fields.length > 0
      ? [`missing_coordination_top_level_fields: ${JSON.stringify(debug.missing_coordination_top_level_fields)}`]
      : []),
    ...(debug.coordination_source_format != null
      ? [`coordination_source_format: ${debug.coordination_source_format}`]
      : []),
    ...(debug.coordination_normalized_shape != null
      ? [`coordination_normalized_shape: ${debug.coordination_normalized_shape}`]
      : []),
    ...(debug.derived_relay_capsule_type !== undefined
      ? [
          `derived_relay_capsule_type: ${
            debug.derived_relay_capsule_type === null ? 'null' : debug.derived_relay_capsule_type
          }`,
        ]
      : []),
    ...(debug.relay_envelope_matches_expectations != null
      ? [`relay_envelope_matches_expectations: ${debug.relay_envelope_matches_expectations}`]
      : []),
    ...(debug.relay_allowed_types_from_response != null && debug.relay_allowed_types_from_response.length > 0
      ? [`relay_allowed_types_from_response: ${debug.relay_allowed_types_from_response}`]
      : []),
    ...(debug.canon_chunking_summary
      ? [
          '',
          'canon_chunking_summary:',
          JSON.stringify(debug.canon_chunking_summary, null, 2),
        ]
      : []),
    '',
    'request_shape:',
    JSON.stringify(debug.request_shape, null, 2),
  ]

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 20000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1e1e1e',
          color: '#e0e0e0',
          borderRadius: 8,
          maxWidth: 520,
          width: '100%',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
      >
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.12)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 14 }}>P2P outbound — DEBUG</span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              color: '#fff',
              borderRadius: 4,
              padding: '4px 10px',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Close
          </button>
        </div>
        <pre
          style={{
            margin: 0,
            padding: 12,
            fontSize: 11,
            lineHeight: 1.45,
            overflow: 'auto',
            flex: 1,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {lines.join('\n')}
        </pre>
      </div>
    </div>
  )
}
