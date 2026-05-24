/**
 * Step 2 — Provide VM credentials (provider-agnostic).
 *
 * P4.5.11: the renderer holds only the key file path; PEM bytes are read in main.
 */

import { useState } from 'react'
import type { CSSProperties } from 'react'
import { STEP2_VM_HELP } from '../copy.js'
import { btnPrimary, helpBox } from '../styles.js'
import { StepErrorActions } from './StepCommon.js'

export interface StepProvideVmFormValues {
  host: string
  port: string
  username: string
  keyFilePath: string
  passphrase: string
}

export interface StepProvideVmProps {
  replicaIndex: number
  totalReplicas: number
  error: string | null
  loading: boolean
  initial?: Partial<StepProvideVmFormValues>
  onPickKeyFile: () => Promise<{ canceled: boolean; filePath?: string }>
  onSubmit: (values: StepProvideVmFormValues) => Promise<void>
  onCancelWizard: () => void
}

export function StepProvideVm({
  replicaIndex,
  totalReplicas,
  error,
  loading,
  initial,
  onPickKeyFile,
  onSubmit,
  onCancelWizard,
}: StepProvideVmProps) {
  const [host, setHost] = useState(initial?.host ?? '')
  const [port, setPort] = useState(initial?.port ?? '22')
  const [username, setUsername] = useState(initial?.username ?? 'root')
  const [keyFilePath, setKeyFilePath] = useState(initial?.keyFilePath ?? '')
  const [passphrase, setPassphrase] = useState(initial?.passphrase ?? '')
  const [pickingKey, setPickingKey] = useState(false)

  const formValues = (): StepProvideVmFormValues => ({
    host,
    port,
    username,
    keyFilePath,
    passphrase,
  })

  const handlePickKeyFile = async () => {
    setPickingKey(true)
    try {
      const result = await onPickKeyFile()
      if (!result.canceled && result.filePath) {
        setKeyFilePath(result.filePath)
      }
    } finally {
      setPickingKey(false)
    }
  }

  const handleContinue = async () => {
    try {
      await onSubmit(formValues())
      // Residual exposure: passphrase transits renderer→main via IPC until cleared here.
      setPassphrase('')
    } catch {
      // Parent surfaces error via `error` prop.
    }
  }

  const keyLabel = keyFilePath
    ? keyFilePath.replace(/^.*[/\\]/, '') || keyFilePath
    : null

  return (
    <div data-testid="wizard-step-provide-vm">
      <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>
        Provide your Linux VM
        {totalReplicas > 1 && (
          <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 14 }}>
            {' '}
            — Replica {replicaIndex + 1} of {totalReplicas}
          </span>
        )}
      </h2>
      <p style={helpBox} data-testid="wizard-step2-help">
        {STEP2_VM_HELP}
      </p>
      <StepErrorActions
        error={error}
        onRetry={() => void handleContinue()}
        onCancelWizard={onCancelWizard}
      />
      <label style={labelStyle}>
        Host
        <input
          data-testid="wizard-vm-host"
          style={inputStyle}
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="203.0.113.10"
        />
      </label>
      <label style={labelStyle}>
        SSH port
        <input
          data-testid="wizard-vm-port"
          style={inputStyle}
          value={port}
          onChange={(e) => setPort(e.target.value)}
          type="number"
          min={1}
          max={65535}
        />
      </label>
      <label style={labelStyle}>
        SSH username
        <input
          data-testid="wizard-vm-user"
          style={inputStyle}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="root"
        />
      </label>
      <div style={labelStyle}>
        SSH private key file
        <button
          type="button"
          style={{ ...inputStyle, cursor: 'pointer', textAlign: 'left' }}
          data-testid="wizard-vm-key-pick"
          disabled={loading || pickingKey}
          onClick={() => void handlePickKeyFile()}
        >
          {pickingKey ? 'Opening file picker…' : keyLabel ? `Selected: ${keyLabel}` : 'Choose key file…'}
        </button>
      </div>
      <label style={labelStyle}>
        Key passphrase (optional)
        <input
          data-testid="wizard-vm-passphrase"
          style={inputStyle}
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          autoComplete="off"
        />
      </label>
      <button
        type="button"
        style={btnPrimary}
        disabled={loading || !host || !username || !keyFilePath}
        data-testid="wizard-vm-continue"
        onClick={() => void handleContinue()}
      >
        {loading ? 'Saving…' : 'Continue to probe'}
      </button>
    </div>
  )
}

const labelStyle: CSSProperties = {
  display: 'block',
  marginBottom: 10,
  color: '#cbd5e1',
  fontSize: 12,
}

const inputStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 4,
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid #475569',
  background: '#1e293b',
  color: '#f1f5f9',
  boxSizing: 'border-box',
}
