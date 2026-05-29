/**
 * Surfaces unclaimed legacy vaults so the user can claim + unlock the VMK that sealed inbox rows.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import '../components/handshakeViewTypes'

type LegacyVaultRow = { id: string; name: string; created?: number }

type VaultAccountStatus = {
  availableVaults?: LegacyVaultRow[]
  legacyUnclaimedVaults?: LegacyVaultRow[]
  isUnlocked?: boolean
  error?: string
}

export default function LegacyVaultClaimBanner() {
  const [legacyVaults, setLegacyVaults] = useState<LegacyVaultRow[]>([])
  const [visibleCount, setVisibleCount] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [status, setStatus] = useState<'idle' | 'claiming' | 'error' | 'done'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const st = (await window.handshakeView?.getVaultStatus?.()) as VaultAccountStatus | undefined
      const legacy = st?.legacyUnclaimedVaults ?? []
      const visible = st?.availableVaults ?? []
      setLegacyVaults(legacy)
      setVisibleCount(visible.length)
      if (legacy.length === 1 && !selectedId) {
        setSelectedId(legacy[0]!.id)
      }
      if (st?.error) {
        setErrorMsg(st.error)
        setStatus('error')
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }, [selectedId])

  useEffect(() => {
    void refresh()
    const onChange = () => void refresh()
    window.addEventListener('vault-status-changed', onChange)
    return () => window.removeEventListener('vault-status-changed', onChange)
  }, [refresh])

  if (legacyVaults.length === 0) return null

  const autoOffer =
    legacyVaults.length === 1 && visibleCount === 0

  const handleClaim = async (e: FormEvent) => {
    e.preventDefault()
    const vaultId = selectedId ?? legacyVaults[0]?.id
    if (!vaultId || !passphrase.trim()) {
      setErrorMsg('Select a vault and enter its passphrase.')
      setErrorCode(null)
      setStatus('error')
      return
    }
    setStatus('claiming')
    setErrorMsg(null)
    setErrorCode(null)
    try {
      const claimFn = (window.handshakeView as { claimLegacyVault?: (id: string, pwd: string) => Promise<{ success?: boolean; error?: string; code?: string; vaultId?: string }> })?.claimLegacyVault
      if (!claimFn) {
        setErrorMsg('Claim API unavailable (update the app).')
        setStatus('error')
        return
      }
      const res = await claimFn(vaultId, passphrase)
      if (!res?.success) {
        setErrorMsg(res?.error ?? `Claim failed for vault ${vaultId}`)
        setErrorCode(res?.code ?? null)
        setStatus('error')
        return
      }
      setStatus('done')
      setPassphrase('')
      await refresh()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  return (
    <div
      style={{
        margin: '0 0 12px',
        padding: '12px 14px',
        borderRadius: 8,
        border: '1px solid rgba(245,158,11,0.45)',
        background: 'rgba(245,158,11,0.08)',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: '#fbbf24', marginBottom: 6 }}>
        {autoOffer
          ? 'Unclaimed vault on this device — claim to read sealed inbox messages'
          : 'Unclaimed legacy vault(s) on this device'}
      </div>
      <p style={{ fontSize: 11, color: 'var(--color-text-muted, #94a3b8)', margin: '0 0 10px', lineHeight: 1.45 }}>
        Older inbox rows may be sealed with a vault that has no account owner on file. Claim the vault that
        holds your inbox data (check logs for <code style={{ fontSize: 10 }}>legacyUnclaimedVaultIds</code>),
        then unlock it with the same passphrase. Visible vaults: {visibleCount}.
      </p>
      <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 11, color: '#e2e8f0' }}>
        {legacyVaults.map((v) => (
          <li key={v.id}>
            <strong>{v.name || v.id}</strong>
            <span style={{ color: '#94a3b8' }}> — id: {v.id}</span>
          </li>
        ))}
      </ul>
      <form onSubmit={(ev) => void handleClaim(ev)} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {legacyVaults.length > 1 ? (
          <label style={{ fontSize: 11, color: '#94a3b8' }}>
            Vault to claim
            <select
              value={selectedId ?? ''}
              onChange={(e) => setSelectedId(e.target.value)}
              style={{ display: 'block', marginTop: 4, width: '100%', maxWidth: 420 }}
            >
              <option value="">Select…</option>
              {legacyVaults.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.id})
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label style={{ fontSize: 11, color: '#94a3b8' }}>
          Vault passphrase (verified before ownership is written)
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoComplete="current-password"
            style={{ display: 'block', marginTop: 4, width: '100%', maxWidth: 320 }}
          />
        </label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="submit" disabled={status === 'claiming'}>
            {status === 'claiming' ? 'Claiming…' : 'Claim vault for this account'}
          </button>
          {status === 'done' ? (
            <span style={{ fontSize: 11, color: '#22c55e' }}>Claimed — unlock this vault to bind the inner seal key.</span>
          ) : null}
        </div>
        {status === 'error' && errorMsg ? (
          <div style={{ fontSize: 11, color: '#f87171' }}>
            {errorMsg}
            {errorCode ? ` (${errorCode})` : ''}
          </div>
        ) : null}
      </form>
    </div>
  )
}
