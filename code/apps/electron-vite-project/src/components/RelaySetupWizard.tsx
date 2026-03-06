/**
 * RelaySetupWizard — Step-by-step setup for BEAP Relay (High-Assurance mode).
 * Tier-gated: Pro, Publisher, Enterprise only.
 */

import { useState, useEffect, useCallback } from 'react'

const STEP_COUNT = 5
const TLS_STEP = 6

interface WizardState {
  step: number
  relay_auth_secret: string | null
  relay_url: string
  test_results: { name: string; ok: boolean; error?: string }[]
  secretVisible: boolean
}

const DOCKER_PULL = 'docker pull wrdesk/beap-relay:latest'
const DOCKER_RUN_START = `docker run -d \\
  --name beap-relay \\
  --restart unless-stopped \\
  -p 51249:51249 \\
  -v beap-relay-data:/data \\
  -e RELAY_AUTH_SECRET=`
const DOCKER_RUN_END = ` \\
  wrdesk/beap-relay:latest`
const HEALTH_URL = 'curl http://localhost:51249/health'
const FIREWALL_UBUNTU = 'sudo ufw allow 51249/tcp'
const FIREWALL_CENTOS = 'sudo firewall-cmd --add-port=51249/tcp --permanent'

function CodeBlock({ text, onCopy }: { text: string; onCopy: () => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '8px',
      background: 'rgba(0,0,0,0.4)', borderRadius: '8px',
      padding: '12px 14px', fontFamily: 'monospace', fontSize: '12px',
      color: 'var(--color-text, #e2e8f0)', overflow: 'auto',
      border: '1px solid var(--color-border, rgba(255,255,255,0.12))',
    }}>
      <code style={{ flex: 1, wordBreak: 'break-all' }}>{text}</code>
      <button
        type="button"
        onClick={onCopy}
        style={{
          padding: '4px 10px', fontSize: '11px', fontWeight: 600,
          background: 'var(--color-accent-bg, rgba(139,92,246,0.12))',
          border: '1px solid var(--color-accent-border, rgba(139,92,246,0.3))',
          borderRadius: '6px', color: 'var(--color-accent, #a78bfa)',
          cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        Copy
      </button>
    </div>
  )
}

interface RelaySetupWizardProps {
  onClose: () => void
  /** When 'tls', opens directly to the TLS setup step (for "Enable TLS" from Settings) */
  initialStep?: 'default' | 'tls'
}

export default function RelaySetupWizard({ onClose, initialStep = 'default' }: RelaySetupWizardProps) {
  const [state, setState] = useState<WizardState>({
    step: 0,
    relay_auth_secret: null,
    relay_url: '',
    test_results: [],
    secretVisible: false,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connectionTestOk, setConnectionTestOk] = useState<boolean | null>(null)
  const [verifyResults, setVerifyResults] = useState<{ name: string; ok: boolean; error?: string }[] | null>(null)
  const [activateSuccess, setActivateSuccess] = useState(false)
  const [tlsStepActive, setTlsStepActive] = useState(false)
  const [tlsTestOk, setTlsTestOk] = useState<boolean | null>(null)
  const [tlsCertFingerprint, setTlsCertFingerprint] = useState<string | null>(null)

  const relay = (window as any).relay
  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => {})
  }, [])

  // Resume from persisted state
  useEffect(() => {
    if (!relay?.getSetupStatus) return
    relay.getSetupStatus().then((s: any) => {
      if (s.relay_url) setState((prev) => ({ ...prev, relay_url: s.relay_url || '' }))
      if (s.relay_auth_secret === '***') {
        relay.getSecret?.().then((r: any) => {
          if (r.success && r.secret) setState((prev) => ({ ...prev, relay_auth_secret: r.secret }))
        })
      }
    }).catch(() => {})
  }, [relay])

  // When opening directly to TLS step, we need activateSuccess so the TLS UI shows
  const effectiveActivateSuccess = activateSuccess || (initialStep === 'tls' && tlsStepActive)

  const handleGenerateSecret = async () => {
    if (!relay?.generateSecret) return
    setLoading(true)
    setError(null)
    try {
      const r = await relay.generateSecret()
      if (r.success && r.secret) {
        setState((prev) => ({ ...prev, relay_auth_secret: r.secret }))
      } else {
        setError(r.error || 'Failed to generate secret')
      }
    } catch (e: any) {
      setError(e?.message || 'Failed')
    } finally {
      setLoading(false)
    }
  }

  const handleTestConnection = async () => {
    const url = state.relay_url.trim()
    if (!url || !relay?.testConnection) return
    setLoading(true)
    setError(null)
    setConnectionTestOk(null)
    try {
      const r = await relay.testConnection(url)
      setConnectionTestOk(r.success)
      if (!r.success) setError(r.error || 'Connection failed')
    } catch (e: any) {
      setConnectionTestOk(false)
      setError(e?.message || 'Test failed')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyEndToEnd = async () => {
    const url = state.relay_url.trim()
    const secret = state.relay_auth_secret
    if (!url || !secret || !relay?.verifyEndToEnd) return
    setLoading(true)
    setError(null)
    setVerifyResults(null)
    try {
      const r = await relay.verifyEndToEnd(url, secret)
      setVerifyResults(r.results || [])
      if (!r.success) setError(r.error || 'Verification failed')
    } catch (e: any) {
      setVerifyResults([])
      setError(e?.message || 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  const handleActivate = async () => {
    const url = state.relay_url.trim()
    if (!url || !relay?.activate) return
    setLoading(true)
    setError(null)
    try {
      const r = await relay.activate({ relay_url: url })
      if (r.success) setActivateSuccess(true)
      else setError(r.error || 'Activation failed')
    } catch (e: any) {
      setError(e?.message || 'Activation failed')
    } finally {
      setLoading(false)
    }
  }

  const handleTlsTest = async () => {
    const url = state.relay_url.trim()
    if (!url || !relay?.testTlsConnection) return
    const httpsUrl = url.replace(/^http:\/\//i, 'https://')
    setLoading(true)
    setError(null)
    setTlsTestOk(null)
    setTlsCertFingerprint(null)
    try {
      const r = await relay.testTlsConnection(httpsUrl)
      setTlsTestOk(r.success)
      if (r.certFingerprint) setTlsCertFingerprint(r.certFingerprint)
      if (!r.success) setError(r.error || 'TLS connection failed')
    } catch (e: any) {
      setTlsTestOk(false)
      setError(e?.message || 'TLS test failed')
    } finally {
      setLoading(false)
    }
  }

  const handleAcceptCertAndUpdate = async () => {
    const url = state.relay_url.trim()
    const httpsUrl = url.replace(/^http:\/\//i, 'https://')
    const fp = tlsCertFingerprint
    if (!httpsUrl || !fp || !relay?.acceptCertFingerprint || !relay?.activate) return
    setLoading(true)
    setError(null)
    try {
      const ar = await relay.acceptCertFingerprint(fp)
      if (!ar.success) { setError(ar.error || 'Failed'); setLoading(false); return }
      const ar2 = await relay.activate({ relay_url: httpsUrl })
      if (ar2.success) {
        setState((p) => ({ ...p, relay_url: httpsUrl }))
        setTlsTestOk(true)
        setTlsCertFingerprint(null)
      } else setError(ar2.error || 'Failed to update URL')
    } catch (e: any) {
      setError(e?.message || 'Failed')
    } finally {
      setLoading(false)
    }
  }

  const handleTlsSuccessUpdate = async () => {
    const url = state.relay_url.trim()
    const httpsUrl = url.replace(/^http:\/\//i, 'https://')
    if (!httpsUrl || !relay?.activate) return
    setLoading(true)
    setError(null)
    try {
      const r = await relay.activate({ relay_url: httpsUrl })
      if (r.success) setState((p) => ({ ...p, relay_url: httpsUrl }))
      else setError(r.error || 'Failed to update URL')
    } catch (e: any) {
      setError(e?.message || 'Failed')
    } finally {
      setLoading(false)
    }
  }

  const nextStep = () => setState((prev) => ({ ...prev, step: Math.min(prev.step + 1, STEP_COUNT) }))
  const prevStep = () => setState((prev) => ({ ...prev, step: Math.max(prev.step - 1, 0) }))

  const step = state.step
  const stepLabel = step === 0 ? 'Introduction' : `Step ${step} of ${STEP_COUNT}`

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: '20px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: '520px', maxHeight: 'calc(100vh - 80px)',
          background: 'var(--color-bg, #0f172a)',
          borderRadius: '12px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          border: '1px solid var(--color-border, rgba(255,255,255,0.12))',
        }}
      >
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--color-text)' }}>
            BEAP Relay Setup
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: 'var(--color-text-muted)',
              fontSize: '16px', cursor: 'pointer', padding: '4px',
            }}
          >
            ×
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          {step === 0 && (
            <>
              <p style={{ margin: '0 0 12px', fontSize: '13px', lineHeight: 1.6, color: 'var(--color-text)' }}>
                Welcome to the BEAP Relay Setup
              </p>
              <p style={{ margin: '0 0 12px', fontSize: '13px', lineHeight: 1.6, color: 'var(--color-text-muted)' }}>
                The relay is your personal BEAP mailbox. It runs on a server you control and does two things:
              </p>
              <ol style={{ margin: '0 0 16px', paddingLeft: '20px', fontSize: '13px', lineHeight: 1.8, color: 'var(--color-text-muted)' }}>
                <li>Receives BEAP Capsules on your behalf — so your computer doesn't need to be directly reachable from the internet.</li>
                <li>Validates every incoming Capsule — so nothing untrusted ever reaches your local machine.</li>
              </ol>
              <p style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 600, color: 'var(--color-text)' }}>
                What you'll need:
              </p>
              <ul style={{ margin: '0 0 16px', paddingLeft: '20px', fontSize: '13px', lineHeight: 1.8, color: 'var(--color-text-muted)' }}>
                <li>A server or VPS with Docker installed (any Linux server works)</li>
                <li>SSH access to that server</li>
                <li>About 10 minutes</li>
              </ul>
            </>
          )}

          {step === 1 && (
            <>
              <p style={{ margin: '0 0 12px', fontSize: '13px', lineHeight: 1.6, color: 'var(--color-text)' }}>
                Step 1 of 5 — Generate Credentials
              </p>
              <p style={{ margin: '0 0 16px', fontSize: '13px', lineHeight: 1.6, color: 'var(--color-text-muted)' }}>
                We'll generate a secure shared secret between your app and your relay. This secret ensures only YOUR app can pull Capsules from your relay.
              </p>
              {!state.relay_auth_secret ? (
                <button
                  type="button"
                  onClick={handleGenerateSecret}
                  disabled={loading}
                  style={{
                    padding: '10px 16px', fontSize: '13px', fontWeight: 600,
                    background: 'var(--color-accent-bg)', border: '1px solid var(--color-accent-border)',
                    borderRadius: '8px', color: 'var(--color-accent)', cursor: loading ? 'not-allowed' : 'pointer',
                  }}
                >
                  {loading ? 'Generating…' : 'Generate Secret'}
                </button>
              ) : (
                <>
                  <p style={{ margin: '0 0 8px', fontSize: '13px', color: 'var(--success-dark, #10b981)' }}>✓ Secret generated</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>Relay Secret:</span>
                    <code style={{
                      flex: 1, overflow: 'hidden', textOverflow: 'ellipsis',
                      background: 'rgba(0,0,0,0.3)', padding: '6px 10px', borderRadius: '6px',
                      fontSize: '12px',
                    }}>
                      {state.secretVisible ? state.relay_auth_secret : '●●●●●●●●●●●●●●●●'}
                    </code>
                    <button
                      type="button"
                      onClick={() => setState((p) => ({ ...p, secretVisible: !p.secretVisible }))}
                      style={{ padding: '4px 8px', fontSize: '11px', background: 'var(--color-accent-bg)', border: '1px solid var(--color-accent-border)', borderRadius: '6px', color: 'var(--color-accent)', cursor: 'pointer' }}
                    >
                      {state.secretVisible ? 'Hide' : 'Show'}
                    </button>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(state.relay_auth_secret!)}
                      style={{ padding: '4px 8px', fontSize: '11px', background: 'var(--color-accent-bg)', border: '1px solid var(--color-accent-border)', borderRadius: '6px', color: 'var(--color-accent)', cursor: 'pointer' }}
                    >
                      Copy
                    </button>
                  </div>
                  <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                    You'll need this in the next step. Keep it safe — it authenticates your app to your relay.
                  </p>
                </>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <p style={{ margin: '0 0 12px', fontSize: '13px', lineHeight: 1.6, color: 'var(--color-text)' }}>
                Step 2 of 5 — Deploy the Relay
              </p>
              <p style={{ margin: '0 0 12px', fontSize: '13px', lineHeight: 1.6, color: 'var(--color-text-muted)' }}>
                Connect to your server via SSH and run these commands:
              </p>
              <p style={{ margin: '0 0 6px', fontSize: '12px', color: 'var(--color-text-muted)' }}>1. Pull the BEAP Relay container:</p>
              <CodeBlock text={DOCKER_PULL} onCopy={() => copyToClipboard(DOCKER_PULL)} />
              <p style={{ margin: '16px 0 6px', fontSize: '12px', color: 'var(--color-text-muted)' }}>2. Start the relay:</p>
              <CodeBlock
                text={state.relay_auth_secret ? DOCKER_RUN_START + state.relay_auth_secret + DOCKER_RUN_END : DOCKER_RUN_START + '<your-secret>' + DOCKER_RUN_END}
                onCopy={() => copyToClipboard(state.relay_auth_secret ? DOCKER_RUN_START + state.relay_auth_secret + DOCKER_RUN_END : DOCKER_RUN_START + '<your-secret>' + DOCKER_RUN_END)}
              />
              <p style={{ margin: '8px 0 8px', fontSize: '11px', color: 'var(--color-text-muted)' }}>(The Copy button inserts your actual secret automatically)</p>
              <p style={{ margin: '16px 0 6px', fontSize: '12px', color: 'var(--color-text-muted)' }}>3. Verify it's running:</p>
              <CodeBlock text={HEALTH_URL} onCopy={() => copyToClipboard(HEALTH_URL)} />
              <p style={{ margin: '8px 0 16px', fontSize: '12px', color: 'var(--color-text-muted)' }}>You should see: {`{"status":"ok", ...}`}</p>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                Tip: If you're using a firewall on your server, allow incoming connections on port 51249:
              </p>
              <ul style={{ margin: '8px 0 0', paddingLeft: '20px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                <li>Ubuntu/Debian: {FIREWALL_UBUNTU}</li>
                <li>CentOS/RHEL: {FIREWALL_CENTOS}</li>
                <li>Cloud provider: Add port 51249 to your security group / firewall rules</li>
              </ul>
            </>
          )}

          {step === 3 && (
            <>
              <p style={{ margin: '0 0 12px', fontSize: '13px', lineHeight: 1.6, color: 'var(--color-text)' }}>
                Step 3 of 5 — Connect Your App to the Relay
              </p>
              <p style={{ margin: '0 0 12px', fontSize: '13px', lineHeight: 1.6, color: 'var(--color-text-muted)' }}>
                Enter your relay server's public address:
              </p>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', color: 'var(--color-text-muted)' }}>Relay URL:</label>
                <input
                  type="text"
                  value={state.relay_url}
                  onChange={(e) => setState((p) => ({ ...p, relay_url: e.target.value }))}
                  placeholder="https://relay.yourdomain.com:51249/beap/ingest"
                  style={{
                    width: '100%', padding: '10px 12px', fontSize: '13px',
                    background: 'var(--color-input-bg, rgba(255,255,255,0.08))',
                    border: '1px solid var(--color-border)', borderRadius: '8px',
                    color: 'var(--color-text)',
                  }}
                />
              </div>
              <p style={{ margin: '0 0 12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>Examples:</p>
              <ul style={{ margin: '0 0 16px', paddingLeft: '20px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                <li>https://relay.yourdomain.com:51249/beap/ingest (if you have a domain)</li>
                <li>https://203.0.113.50:51249/beap/ingest (if using IP address)</li>
                <li>http://203.0.113.50:51249/beap/ingest (without TLS — not recommended)</li>
              </ul>
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={loading || !state.relay_url.trim()}
                style={{
                  padding: '10px 16px', fontSize: '13px', fontWeight: 600,
                  background: 'var(--color-accent-bg)', border: '1px solid var(--color-accent-border)',
                  borderRadius: '8px', color: 'var(--color-accent)', cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'Testing…' : 'Test Connection'}
              </button>
              {connectionTestOk === true && <p style={{ margin: '12px 0 0', color: 'var(--success-dark)', fontSize: '13px' }}>✓ Relay is reachable</p>}
              {connectionTestOk === false && error && <p style={{ margin: '12px 0 0', color: 'var(--danger-dark)', fontSize: '13px' }}>{error}</p>}
            </>
          )}

          {step === 4 && (
            <>
              <p style={{ margin: '0 0 12px', fontSize: '13px', lineHeight: 1.6, color: 'var(--color-text)' }}>
                Step 4 of 5 — Verify Connection
              </p>
              <p style={{ margin: '0 0 16px', fontSize: '13px', lineHeight: 1.6, color: 'var(--color-text-muted)' }}>
                Testing the full connection between your app and your relay...
              </p>
              <button
                type="button"
                onClick={handleVerifyEndToEnd}
                disabled={loading || !state.relay_url.trim() || !state.relay_auth_secret}
                style={{
                  padding: '10px 16px', fontSize: '13px', fontWeight: 600,
                  background: 'var(--color-accent-bg)', border: '1px solid var(--color-accent-border)',
                  borderRadius: '8px', color: 'var(--color-accent)', cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'Running…' : 'Run Verification'}
              </button>
              {verifyResults && verifyResults.length > 0 && (
                <div style={{ marginTop: '16px' }}>
                  {verifyResults.map((r, i) => (
                    <p key={i} style={{ margin: '4px 0', fontSize: '13px', color: r.ok ? 'var(--success-dark)' : 'var(--danger-dark)' }}>
                      {r.ok ? '✓' : '✗'} {r.name === 'health' ? 'Relay is online' : r.name === 'auth' ? 'Authentication works' : 'Pull connection works'}
                      {r.error && !r.ok && ` — ${r.error}`}
                    </p>
                  ))}
                  {verifyResults.every((r) => r.ok) && (
                    <p style={{ margin: '12px 0 0', fontSize: '13px', color: 'var(--success-dark)' }}>
                      All checks passed! Your relay is ready.
                    </p>
                  )}
                  {!verifyResults.every((r) => r.ok) && error && (
                    <div style={{ marginTop: '12px', padding: '12px', background: 'rgba(239,68,68,0.1)', borderRadius: '8px' }}>
                      <p style={{ margin: '0 0 8px', fontSize: '13px', color: 'var(--danger-dark)' }}>
                        Authentication failed — The relay rejected your credentials.
                      </p>
                      <p style={{ margin: '0 0 8px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                        Make sure the RELAY_AUTH_SECRET in your Docker container matches the secret generated in Step 1.
                      </p>
                      <p style={{ margin: '0 0 6px', fontSize: '12px', color: 'var(--color-text-muted)' }}>To update the secret on your server:</p>
                      <CodeBlock
                        text={`docker stop beap-relay\ndocker rm beap-relay\ndocker run -d ${DOCKER_RUN_START}${state.relay_auth_secret ? state.relay_auth_secret : '<secret>'}${DOCKER_RUN_END}`}
                        onCopy={() => copyToClipboard(`docker stop beap-relay\ndocker rm beap-relay\ndocker run -d ${DOCKER_RUN_START}${state.relay_auth_secret || '<secret>'}${DOCKER_RUN_END}`)}
                      />
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {step === 5 && (
            <>
              {!effectiveActivateSuccess ? (
                <>
                  <p style={{ margin: '0 0 12px', fontSize: '13px', lineHeight: 1.6, color: 'var(--color-text)' }}>
                    Step 5 of 5 — Activate High-Assurance Mode
                  </p>
                  <p style={{ margin: '0 0 16px', fontSize: '13px', lineHeight: 1.6, color: 'var(--color-text-muted)' }}>
                    Everything is set up. Here's a summary:
                  </p>
                  <div style={{ marginBottom: '16px', fontSize: '13px', color: 'var(--color-text-muted)' }}>
                    <p style={{ margin: '4px 0' }}>Relay URL: {state.relay_url || '—'}</p>
                    <p style={{ margin: '4px 0' }}>Relay Mode: Remote (High-Assurance)</p>
                    <p style={{ margin: '4px 0' }}>Auth: ✓ Configured</p>
                    <p style={{ margin: '4px 0' }}>Status: ✓ Online</p>
                  </div>
                  <p style={{ margin: '0 0 12px', fontSize: '13px', lineHeight: 1.6, color: 'var(--color-text-muted)' }}>
                    What happens now:
                  </p>
                  <ul style={{ margin: '0 0 16px', paddingLeft: '20px', fontSize: '12px', lineHeight: 1.6, color: 'var(--color-text-muted)' }}>
                    <li>All new handshakes will include your relay address</li>
                    <li>Incoming Capsules are validated on your relay BEFORE reaching your computer</li>
                    <li>Your app automatically pulls validated Capsules every 10 seconds</li>
                    <li>Existing handshakes will continue to work (they use the old endpoint)</li>
                  </ul>
                  <button
                    type="button"
                    onClick={handleActivate}
                    disabled={loading || !state.relay_url.trim()}
                    style={{
                      padding: '10px 16px', fontSize: '13px', fontWeight: 600,
                      background: 'var(--color-accent-bg)', border: '1px solid var(--color-accent-border)',
                      borderRadius: '8px', color: 'var(--color-accent)', cursor: loading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {loading ? 'Activating…' : 'Activate High-Assurance Mode'}
                  </button>
                  {error && <p style={{ margin: '12px 0 0', color: 'var(--danger-dark)', fontSize: '13px' }}>{error}</p>}
                </>
              ) : !tlsStepActive && initialStep !== 'tls' ? (
                <>
                  <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--success-dark)' }}>✓ High-Assurance Mode is now active!</p>
                  <p style={{ margin: '0 0 16px', fontSize: '13px', lineHeight: 1.6, color: 'var(--color-text-muted)' }}>
                    Your P2P status badge will show "Relay active" when connected.
                  </p>
                  <p style={{ margin: '0 0 12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                    Optional: Enable TLS (HTTPS) for encrypted communication with your relay.
                  </p>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => setTlsStepActive(true)}
                      style={{
                        padding: '10px 16px', fontSize: '13px', fontWeight: 600,
                        background: 'var(--color-accent-bg)', border: '1px solid var(--color-accent-border)',
                        borderRadius: '8px', color: 'var(--color-accent)', cursor: 'pointer',
                      }}
                    >
                      Enable TLS
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      style={{
                        padding: '10px 16px', fontSize: '13px', fontWeight: 600,
                        background: 'transparent', border: '1px solid var(--color-border)',
                        borderRadius: '8px', color: 'var(--color-text-muted)', cursor: 'pointer',
                      }}
                    >
                      Done
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: 600, color: 'var(--color-text)' }}>
                    Enable TLS (Optional)
                  </p>
                  <p style={{ margin: '0 0 12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                    Encrypt communication between your app and the relay. Choose one option:
                  </p>

                  <details style={{ marginBottom: '12px', fontSize: '12px' }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '8px' }}>
                      Option A: Let's Encrypt (recommended for servers with a domain)
                    </summary>
                    <p style={{ margin: '0 0 8px', color: 'var(--color-text-muted)' }}>
                      If your relay server has a domain name (e.g., relay.yourdomain.com), you can get a free TLS certificate automatically.
                    </p>
                    <p style={{ margin: '0 0 6px', fontSize: '11px', color: 'var(--color-text-muted)' }}>On your server, run:</p>
                    <CodeBlock
                      text={`# Install certbot (if not already installed)
sudo apt install certbot

# Get certificate
sudo certbot certonly --standalone -d relay.yourdomain.com

# Copy certs to relay data directory
sudo cp /etc/letsencrypt/live/relay.yourdomain.com/fullchain.pem /var/lib/docker/volumes/beap-relay-data/_data/certs/cert.pem
sudo cp /etc/letsencrypt/live/relay.yourdomain.com/privkey.pem /var/lib/docker/volumes/beap-relay-data/_data/certs/key.pem

# Restart relay with TLS enabled
docker stop beap-relay && docker rm beap-relay
docker run -d \\
  --name beap-relay \\
  --restart unless-stopped \\
  -p 51249:51249 \\
  -v beap-relay-data:/data \\
  -e RELAY_AUTH_SECRET=${state.relay_auth_secret || '<your-secret>'} \\
  -e RELAY_TLS_ENABLED=true \\
  wrdesk/beap-relay:latest`}
                      onCopy={() => copyToClipboard(`# Install certbot (if not already installed)
sudo apt install certbot

# Get certificate
sudo certbot certonly --standalone -d relay.yourdomain.com

# Copy certs to relay data directory
sudo cp /etc/letsencrypt/live/relay.yourdomain.com/fullchain.pem /var/lib/docker/volumes/beap-relay-data/_data/certs/cert.pem
sudo cp /etc/letsencrypt/live/relay.yourdomain.com/privkey.pem /var/lib/docker/volumes/beap-relay-data/_data/certs/key.pem

# Restart relay with TLS enabled
docker stop beap-relay && docker rm beap-relay
docker run -d \\
  --name beap-relay \\
  --restart unless-stopped \\
  -p 51249:51249 \\
  -v beap-relay-data:/data \\
  -e RELAY_AUTH_SECRET=${state.relay_auth_secret || '<your-secret>'} \\
  -e RELAY_TLS_ENABLED=true \\
  wrdesk/beap-relay:latest`)}
                    />
                    <p style={{ margin: '8px 0 0', fontSize: '11px', color: 'var(--color-text-muted)' }}>
                      After restarting, update your relay URL in the app to use https://.
                    </p>
                  </details>

                  <details style={{ marginBottom: '16px', fontSize: '12px' }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '8px' }}>
                      Option B: Self-signed certificate (for IP-only or internal servers)
                    </summary>
                    <p style={{ margin: '0 0 8px', color: 'var(--color-text-muted)' }}>
                      If your relay doesn't have a domain name, you can create a self-signed certificate. This encrypts the connection but your app will need to trust the certificate.
                    </p>
                    <p style={{ margin: '0 0 6px', fontSize: '11px', color: 'var(--color-text-muted)' }}>On your server, run:</p>
                    <CodeBlock
                      text={`# Generate self-signed certificate (valid for 365 days)
openssl req -x509 -newkey rsa:4096 -keyout key.pem \\
  -out cert.pem -days 365 -nodes \\
  -subj "/CN=beap-relay"

# Copy to relay data directory
cp cert.pem key.pem /var/lib/docker/volumes/beap-relay-data/_data/certs/

# Restart relay with TLS
docker stop beap-relay && docker rm beap-relay
docker run -d \\
  --name beap-relay \\
  --restart unless-stopped \\
  -p 51249:51249 \\
  -v beap-relay-data:/data \\
  -e RELAY_AUTH_SECRET=${state.relay_auth_secret || '<your-secret>'} \\
  -e RELAY_TLS_ENABLED=true \\
  wrdesk/beap-relay:latest`}
                      onCopy={() => copyToClipboard(`# Generate self-signed certificate (valid for 365 days)
openssl req -x509 -newkey rsa:4096 -keyout key.pem \\
  -out cert.pem -days 365 -nodes \\
  -subj "/CN=beap-relay"

# Copy to relay data directory
cp cert.pem key.pem /var/lib/docker/volumes/beap-relay-data/_data/certs/

# Restart relay with TLS
docker stop beap-relay && docker rm beap-relay
docker run -d \\
  --name beap-relay \\
  --restart unless-stopped \\
  -p 51249:51249 \\
  -v beap-relay-data:/data \\
  -e RELAY_AUTH_SECRET=${state.relay_auth_secret || '<your-secret>'} \\
  -e RELAY_TLS_ENABLED=true \\
  wrdesk/beap-relay:latest`)}
                    />
                    <p style={{ margin: '8px 0 0', fontSize: '11px', color: 'var(--color-text-muted)' }}>
                      Then download cert.pem to your computer and import it into your system trust store. The app will trust this certificate for relay connections.
                    </p>
                  </details>

                  <button
                    type="button"
                    onClick={handleTlsTest}
                    disabled={loading || !state.relay_url.trim()}
                    style={{
                      padding: '10px 16px', fontSize: '13px', fontWeight: 600,
                      background: 'var(--color-accent-bg)', border: '1px solid var(--color-accent-border)',
                      borderRadius: '8px', color: 'var(--color-accent)', cursor: loading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {loading ? 'Testing…' : 'I\'ve enabled TLS → Test Connection'}
                  </button>
                  {tlsTestOk === true && (
                    <div style={{ marginTop: '12px' }}>
                      <p style={{ margin: '0 0 8px', color: 'var(--success-dark)', fontSize: '13px' }}>✓ Relay is reachable over HTTPS</p>
                      <button
                        type="button"
                        onClick={handleTlsSuccessUpdate}
                        disabled={loading}
                        style={{
                          padding: '8px 14px', fontSize: '12px', fontWeight: 600,
                          background: 'var(--color-accent-bg)', border: '1px solid var(--color-accent-border)',
                          borderRadius: '8px', color: 'var(--color-accent)', cursor: loading ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {loading ? 'Updating…' : 'Update relay URL to HTTPS'}
                      </button>
                      <p style={{ margin: '8px 0 0', fontSize: '11px', color: 'var(--color-text-muted)' }}>
                        Or click Done to keep your current URL.
                      </p>
                    </div>
                  )}
                  {tlsTestOk === false && tlsCertFingerprint && (
                    <div style={{ marginTop: '12px', padding: '12px', background: 'rgba(245,158,11,0.1)', borderRadius: '8px' }}>
                      <p style={{ margin: '0 0 8px', fontSize: '13px', color: 'var(--warning-dark, #f59e0b)' }}>
                        Self-signed certificate detected. Fingerprint: {tlsCertFingerprint}
                      </p>
                      <p style={{ margin: '0 0 8px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                        Import the certificate on your system, or accept this fingerprint for future pinning. After importing, you can retry the test.
                      </p>
                      <button
                        type="button"
                        onClick={handleAcceptCertAndUpdate}
                        disabled={loading}
                        style={{
                          padding: '8px 14px', fontSize: '12px', fontWeight: 600,
                          background: 'var(--color-accent-bg)', border: '1px solid var(--color-accent-border)',
                          borderRadius: '8px', color: 'var(--color-accent)', cursor: loading ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {loading ? 'Updating…' : 'Accept and store fingerprint'}
                      </button>
                    </div>
                  )}
                  {tlsTestOk === false && !tlsCertFingerprint && error && (
                    <p style={{ margin: '12px 0 0', color: 'var(--danger-dark)', fontSize: '13px' }}>{error}</p>
                  )}
                  <div style={{ marginTop: '16px' }}>
                    <button
                      type="button"
                      onClick={() => { setTlsStepActive(false); setTlsTestOk(null); setTlsCertFingerprint(null); setError(null) }}
                      style={{
                        padding: '8px 14px', fontSize: '12px', fontWeight: 600,
                        background: 'transparent', border: '1px solid var(--color-border)',
                        borderRadius: '8px', color: 'var(--color-text-muted)', cursor: 'pointer',
                      }}
                    >
                      Skip TLS
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      style={{
                        marginLeft: '8px', padding: '8px 14px', fontSize: '12px', fontWeight: 600,
                        background: 'var(--color-accent-bg)', border: '1px solid var(--color-accent-border)',
                        borderRadius: '8px', color: 'var(--color-accent)', cursor: 'pointer',
                      }}
                    >
                      Done
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div style={{
          padding: '16px 20px', borderTop: '1px solid var(--color-border)',
          display: 'flex', justifyContent: 'space-between', gap: '12px',
        }}>
          {step > 0 && step < 5 && !activateSuccess && (
            <button
              type="button"
              onClick={prevStep}
              style={{
                padding: '8px 14px', fontSize: '13px', fontWeight: 600,
                background: 'transparent', border: '1px solid var(--color-border)',
                borderRadius: '8px', color: 'var(--color-text-muted)', cursor: 'pointer',
              }}
            >
              Back
            </button>
          )}
          <div style={{ flex: 1 }} />
          {step < 5 && !activateSuccess && (
            <button
              type="button"
              onClick={nextStep}
              disabled={
                (step === 1 && !state.relay_auth_secret) ||
                (step === 3 && connectionTestOk !== true) ||
                (step === 4 && (!verifyResults || !verifyResults.every((r) => r.ok)))
              }
              style={{
                padding: '8px 14px', fontSize: '13px', fontWeight: 600,
                background: 'var(--color-accent-bg)', border: '1px solid var(--color-accent-border)',
                borderRadius: '8px', color: 'var(--color-accent)', cursor: 'pointer',
              }}
            >
              Continue →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
