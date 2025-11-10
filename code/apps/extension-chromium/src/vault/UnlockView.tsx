/**
 * Unlock View - Master password entry screen
 */

import React, { useState } from 'react'
import { createVault, unlockVault, getVaultStatus } from './api'

interface UnlockViewProps {
  onUnlocked: () => void
}

export const UnlockView: React.FC<UnlockViewProps> = ({ onUnlocked }) => {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [vaultExists, setVaultExists] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  React.useEffect(() => {
    checkVaultStatus()
  }, [])

  const checkVaultStatus = async () => {
    try {
      const status = await getVaultStatus()
      setVaultExists(status.exists)
      setIsCreating(!status.exists)
    } catch (err: any) {
      setError('Failed to check vault status')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!password) {
      setError('Please enter a password')
      return
    }

    if (isCreating) {
      if (password.length < 8) {
        setError('Password must be at least 8 characters')
        return
      }

      if (password !== confirmPassword) {
        setError('Passwords do not match')
        return
      }
    }

    setLoading(true)

    try {
      if (isCreating) {
        await createVault(password)
        console.log('[VAULT UI] ✅ Vault created')
      } else {
        await unlockVault(password)
        console.log('[VAULT UI] ✅ Vault unlocked')
      }

      onUnlocked()
    } catch (err: any) {
      console.error('[VAULT UI] Error:', err)
      setError(err.message || 'Failed to unlock vault')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '400px',
      padding: '40px',
    }}>
      <div style={{
        background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
        borderRadius: '16px',
        padding: '40px',
        maxWidth: '400px',
        width: '100%',
        boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
        border: '1px solid rgba(139, 92, 246, 0.3)',
      }}>
        <div style={{
          textAlign: 'center',
          marginBottom: '32px',
        }}>
          <div style={{
            fontSize: '48px',
            marginBottom: '16px',
          }}>🔒</div>
          <h2 style={{
            margin: 0,
            fontSize: '24px',
            fontWeight: 700,
            color: '#fff',
            marginBottom: '8px',
          }}>
            {isCreating ? 'Create Vault' : 'Unlock Vault'}
          </h2>
          <p style={{
            margin: 0,
            fontSize: '14px',
            color: 'rgba(255,255,255,0.6)',
          }}>
            {isCreating ? 'Set your master password' : 'Enter your master password'}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'block',
              marginBottom: '8px',
              fontSize: '14px',
              fontWeight: 600,
              color: 'rgba(255,255,255,0.9)',
            }}>
              Master Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoFocus
              style={{
                width: '100%',
                padding: '12px 16px',
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'rgba(0,0,0,0.3)',
                color: '#fff',
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {isCreating && (
            <div style={{ marginBottom: '20px' }}>
              <label style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '14px',
                fontWeight: 600,
                color: 'rgba(255,255,255,0.9)',
              }}>
                Confirm Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password"
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'rgba(0,0,0,0.3)',
                  color: '#fff',
                  fontSize: '14px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )}

          {error && (
            <div style={{
              marginBottom: '20px',
              padding: '12px',
              borderRadius: '8px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#ef4444',
              fontSize: '14px',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '14px',
              borderRadius: '8px',
              border: 'none',
              background: loading ? 'rgba(139, 92, 246, 0.5)' : 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
              color: '#fff',
              fontSize: '16px',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {loading ? '...' : isCreating ? 'Create Vault' : 'Unlock'}
          </button>
        </form>

        {vaultExists && !isCreating && (
          <div style={{
            marginTop: '16px',
            textAlign: 'center',
          }}>
            <button
              onClick={() => setIsCreating(true)}
              style={{
                background: 'none',
                border: 'none',
                color: '#8b5cf6',
                fontSize: '14px',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Create new vault instead
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

