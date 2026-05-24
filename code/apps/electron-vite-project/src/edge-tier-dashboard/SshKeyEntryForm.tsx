import type { CSSProperties } from 'react'

export interface SshKeyEntryFormValues {
  sshUser: string
  sshPort: string
  sshKey: string
  passphrase: string
}

export interface SshKeyEntryFormProps {
  host: string
  values: SshKeyEntryFormValues
  onChange: (values: SshKeyEntryFormValues) => void
  disabled?: boolean
}

export function SshKeyEntryForm({ host, values, onChange, disabled }: SshKeyEntryFormProps) {
  const handleFile = async (file: File | null) => {
    if (!file) return
    const text = await file.text()
    onChange({ ...values, sshKey: text })
  }

  return (
    <div data-testid="replica-action-ssh-form">
      <label style={labelStyle}>
        Host
        <input data-testid="replica-action-host" style={inputStyle} value={host} readOnly disabled />
      </label>
      <label style={labelStyle}>
        SSH port
        <input
          data-testid="replica-action-ssh-port"
          style={inputStyle}
          value={values.sshPort}
          disabled={disabled}
          onChange={(e) => onChange({ ...values, sshPort: e.target.value })}
          type="number"
          min={1}
          max={65535}
        />
      </label>
      <label style={labelStyle}>
        SSH username
        <input
          data-testid="replica-action-ssh-user"
          style={inputStyle}
          value={values.sshUser}
          disabled={disabled}
          onChange={(e) => onChange({ ...values, sshUser: e.target.value })}
          placeholder="root"
        />
      </label>
      <label style={labelStyle}>
        SSH private key file
        <input
          data-testid="replica-action-ssh-key-file"
          type="file"
          accept=".pem,.key,text/plain"
          disabled={disabled}
          onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
        />
      </label>
      {values.sshKey ? (
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>Key file loaded</div>
      ) : null}
      <label style={labelStyle}>
        Key passphrase (optional)
        <input
          data-testid="replica-action-ssh-passphrase"
          style={inputStyle}
          type="password"
          value={values.passphrase}
          disabled={disabled}
          onChange={(e) => onChange({ ...values, passphrase: e.target.value })}
          autoComplete="off"
        />
      </label>
    </div>
  )
}

const labelStyle: CSSProperties = {
  display: 'block',
  marginBottom: 10,
  fontSize: 12,
}

const inputStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 4,
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  boxSizing: 'border-box',
}
