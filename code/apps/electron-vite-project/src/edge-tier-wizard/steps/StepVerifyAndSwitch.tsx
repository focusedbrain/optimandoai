/**
 * Step 6 — Verify synthetic round-trip and enable edge tier.
 */

import type { CSSProperties } from 'react'
import { btnPrimary } from '../styles.js'
import { StepErrorActions, StepLoading } from './StepCommon.js'
import {
  NATIVE_BEAP_ROUTING_COPY,
  type NativeBeapRoutingOption,
} from '../copy/nativeBeapRoutingCopy.js'

export interface StepVerifyAndSwitchProps {
  loading: boolean
  error: string | null
  verified: boolean | null
  reason?: string
  confirmed: boolean
  nativeBeapRouting: NativeBeapRoutingOption
  onNativeBeapRoutingChange: (routing: NativeBeapRoutingOption) => void
  onConfirmUnderstand: () => void
  onVerify: () => void
  onCancelWizard: () => void
}

export function StepVerifyAndSwitch({
  loading,
  error,
  verified,
  reason,
  confirmed,
  nativeBeapRouting,
  onNativeBeapRoutingChange,
  onConfirmUnderstand,
  onVerify,
  onCancelWizard,
}: StepVerifyAndSwitchProps) {
  return (
    <div data-testid="wizard-step-verify">
      <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Verify &amp; enable Edge Ingestor</h2>
      <p style={{ color: '#94a3b8', marginTop: 0 }}>
        We send a synthetic BEAP message through your Edge Ingestor and verify the certificate
        locally. If verification succeeds, high-assurance routing is enabled.
      </p>

      <div style={{ marginBottom: 16 }} data-testid="wizard-native-beap-routing">
        <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Native BEAP routing</h3>
        <p style={{ margin: '0 0 10px', fontSize: 12, color: '#94a3b8' }}>
          Choose whether P2P native BEAP capsules must go through the Edge Ingestor or may be
          received directly on this computer.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(['direct', 'require_edge'] as const).map((value) => (
            <label
              key={value}
              data-testid={`wizard-native-beap-routing-${value}`}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                padding: 10,
                borderRadius: 6,
                border: `1px solid ${nativeBeapRouting === value ? '#6366f1' : '#334155'}`,
                background: nativeBeapRouting === value ? 'rgba(99,102,241,0.12)' : 'transparent',
                cursor: verified === true || loading ? 'not-allowed' : 'pointer',
                opacity: verified === true || loading ? 0.6 : 1,
              }}
            >
              <input
                type="radio"
                name="wizard-native-beap-routing"
                value={value}
                checked={nativeBeapRouting === value}
                disabled={verified === true || loading}
                onChange={() => onNativeBeapRoutingChange(value)}
                style={{ marginTop: 3 }}
              />
              <span>
                <strong style={{ display: 'block', fontSize: 13, color: '#e2e8f0' }}>
                  {NATIVE_BEAP_ROUTING_COPY[value].label}
                </strong>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>
                  {NATIVE_BEAP_ROUTING_COPY[value].description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <StepErrorActions error={error} onRetry={onVerify} onCancelWizard={onCancelWizard} />
      {verified === true && (
        <div
          data-testid="wizard-verify-success"
          style={{
            padding: 10,
            borderRadius: 6,
            background: 'rgba(34,197,94,0.12)',
            border: '1px solid rgba(34,197,94,0.35)',
            color: '#bbf7d0',
            marginBottom: 12,
          }}
        >
          Verification succeeded. Edge Ingestor routing is now enabled.
        </div>
      )}
      {verified === false && (
        <div style={{ ...errorBoxStyle, marginBottom: 12 }} data-testid="wizard-verify-failed">
          Verification failed{reason ? `: ${reason}` : '.'}
        </div>
      )}
      {!confirmed && verified !== true && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 12 }}>
          <input
            type="checkbox"
            data-testid="wizard-verify-confirm-checkbox"
            checked={confirmed}
            onChange={() => onConfirmUnderstand()}
          />
          <span style={{ fontSize: 12, color: '#cbd5e1' }}>
            I understand this will route BEAP validation through my Edge Ingestor when verification
            succeeds.
          </span>
        </label>
      )}
      {loading && <StepLoading message="Running verification…" />}
      {verified !== true && !loading && (
        <button
          type="button"
          style={btnPrimary}
          disabled={!confirmed}
          data-testid="wizard-verify-run"
          onClick={onVerify}
        >
          Verify and enable Edge Ingestor
        </button>
      )}
    </div>
  )
}

const errorBoxStyle: CSSProperties = {
  padding: 10,
  borderRadius: 6,
  background: 'rgba(239,68,68,0.12)',
  border: '1px solid rgba(239,68,68,0.35)',
  color: '#fecaca',
}
