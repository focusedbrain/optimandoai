/**
 * Pair verification server — replaces SSH provide/probe/deploy steps (PR8).
 */

import { useCallback, useState, type CSSProperties } from 'react'

import {
  PAIR_INSTALL_CMD,
  PAIR_STEP_ADDRESS_HELP,
  PAIR_STEP_CODE_HELP,
  PAIR_STEP_CONFIRM_BODY,
  PAIR_STEP_INTRO,
  PAIR_STEP_LINK_HELP,
} from '../copy/pairVerificationServerCopy.js'
import type { WizardBridgeLike } from '../WizardShell.js'
import type { WizardPublicState } from '../types.js'
import { btnPrimary, btnSecondary, errorBox } from '../styles.js'

export interface StepPairVerificationServerProps {
  state: WizardPublicState
  wizard: WizardBridgeLike
  onState: (state: WizardPublicState) => void
}

const fieldStyle: CSSProperties = {
  width: '100%',
  marginTop: 4,
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid #475569',
  background: '#1e293b',
  color: '#f1f5f9',
  fontSize: 13,
}

const labelStyle: CSSProperties = {
  display: 'block',
  marginBottom: 10,
  fontSize: 13,
  color: '#cbd5e1',
}

export function StepPairVerificationServer({ state, wizard, onState }: StepPairVerificationServerProps) {
  const [address, setAddress] = useState(state.pairing?.address ?? '')
  const [pairingLink, setPairingLink] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const phase = state.pairing?.phase ?? 'enter'
  const fingerprint = state.pairing?.fingerprint
  const stepError =
    state.error?.step === 'pair_verification_server' ? state.error.message : localError

  const applyParsedLink = useCallback(async () => {
    if (!pairingLink.trim() || !wizard.parsePairingLink) return
    const parsed = await wizard.parsePairingLink(pairingLink.trim())
    if (parsed) {
      setAddress(parsed.address)
      setCode(parsed.code)
      setLocalError(null)
    } else if (pairingLink.trim()) {
      setLocalError('Could not parse that pairing link. Enter the address and code manually.')
    }
  }, [pairingLink, wizard])

  const onPair = useCallback(async () => {
    if (!wizard.pairInitiate) return
    setBusy(true)
    setLocalError(null)
    try {
      const res = await wizard.pairInitiate({ address: address.trim(), pairingCode: code.trim() })
      onState(res.state as WizardPublicState)
      if (!res.ok) setLocalError(res.error ?? 'Pairing failed')
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [address, code, onState, wizard])

  const onConfirmFingerprint = useCallback(async () => {
    if (!wizard.pairConfirm) return
    setBusy(true)
    setLocalError(null)
    try {
      const res = await wizard.pairConfirm()
      onState(res.state as WizardPublicState)
      if (!res.ok) setLocalError(res.error ?? 'Pairing confirm failed')
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [onState, wizard])

  const onCancelFingerprint = useCallback(async () => {
    if (!wizard.pairCancelFingerprint) return
    const res = await wizard.pairCancelFingerprint()
    onState(res.state as WizardPublicState)
  }, [onState, wizard])

  if (phase === 'confirm_fingerprint' && fingerprint) {
    return (
      <div data-testid="wizard-step-pair-confirm">
        <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Confirm fingerprint</h2>
        <p style={{ color: '#94a3b8', marginTop: 0 }}>{PAIR_STEP_CONFIRM_BODY}</p>
        <p
          style={{
            fontFamily: 'ui-monospace, monospace',
            fontSize: 18,
            letterSpacing: '0.05em',
            margin: '12px 0',
            color: '#e2e8f0',
          }}
        >
          {fingerprint}
        </p>
        {stepError ? <div style={errorBox}>{stepError}</div> : null}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button type="button" style={btnPrimary} disabled={busy} onClick={() => void onConfirmFingerprint()}>
            {busy ? 'Pairing…' : 'Confirm match'}
          </button>
          <button type="button" style={btnSecondary} disabled={busy} onClick={() => void onCancelFingerprint()}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div data-testid="wizard-step-pair">
      <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Pair verification server</h2>
      <p style={{ color: '#94a3b8', marginTop: 0 }}>{PAIR_STEP_INTRO}</p>
      <p style={{ margin: '0 0 12px', fontSize: 12, color: '#64748b' }}>
        Install: <code>{PAIR_INSTALL_CMD}</code>
      </p>

      <label style={labelStyle}>
        Verification server address
        <input
          style={fieldStyle}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="https://vps.example.com:8443"
          disabled={busy}
        />
      </label>
      <p style={{ margin: '0 0 12px', fontSize: 12, color: '#64748b' }}>{PAIR_STEP_ADDRESS_HELP}</p>

      <label style={labelStyle}>
        Pairing link (optional)
        <input
          style={fieldStyle}
          value={pairingLink}
          onChange={(e) => setPairingLink(e.target.value)}
          onBlur={() => void applyParsedLink()}
          placeholder="wrdesk-pair://… or paste from server"
          disabled={busy}
        />
      </label>
      <p style={{ margin: '0 0 12px', fontSize: 12, color: '#64748b' }}>{PAIR_STEP_LINK_HELP}</p>

      <label style={labelStyle}>
        Pairing code
        <input
          style={fieldStyle}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123456"
          inputMode="numeric"
          disabled={busy}
        />
      </label>
      <p style={{ margin: '0 0 12px', fontSize: 12, color: '#64748b' }}>{PAIR_STEP_CODE_HELP}</p>

      {stepError ? <div style={errorBox}>{stepError}</div> : null}

      <button
        type="button"
        style={btnPrimary}
        disabled={busy || !address.trim() || !code.trim()}
        onClick={() => void onPair()}
      >
        {busy ? 'Connecting…' : 'Pair'}
      </button>
    </div>
  )
}
