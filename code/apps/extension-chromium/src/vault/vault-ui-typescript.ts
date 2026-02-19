/**
 * Pure TypeScript Vault UI - No React dependencies
 * Professional black design for WRVault password manager
 */

import * as vaultAPI from './api'
import type { VaultItem, VaultStatus, Container, CategoryNode, StandardFieldDef, VaultTier, HandshakeBindingPolicy, HandshakeTarget, AttachEvalResult } from './types'
import {
  IDENTITY_STANDARD_FIELDS, COMPANY_STANDARD_FIELDS,
  PASSWORD_STANDARD_FIELDS, AUTOMATION_SECRET_STANDARD_FIELDS, HANDSHAKE_CONTEXT_STANDARD_FIELDS,
  PAYMENT_FIELDS,
  CATEGORY_UI_MAP, RECORD_TYPE_DISPLAY, RECORD_TYPE_MIN_TIER,
  DEFAULT_BINDING_POLICY,
  canAccessCategory, getCategoryOptionsForTier, ALL_ITEM_CATEGORIES,
  canAttachContext,
} from './types'

// ---------------------------------------------------------------------------
// Module-level tier state — set once during vault init, used everywhere.
// Defaults to 'free' (fail-closed).
// ---------------------------------------------------------------------------
let currentVaultTier: VaultTier = 'free'

// =============================================================================
// Theme-aware vault styling
// Reads the orchestrator theme (Standard / Pro / Dark) and injects CSS custom
// properties on the vault overlay.  All structural elements reference these vars
// so that switching themes automatically re-colours the vault UI.
// =============================================================================

type VaultThemeName = 'standard' | 'pro' | 'dark'

function detectVaultTheme(): VaultThemeName {
  try {
    const stored = localStorage.getItem('optimando-ui-theme')
    if (stored === 'standard' || stored === 'professional') return 'standard'
    if (stored === 'dark') return 'dark'
    if (stored === 'pro' || stored === 'default') return 'pro'
  } catch { /* noop */ }
  return 'pro'
}

const VAULT_THEMES: Record<VaultThemeName, Record<string, string>> = {
  // ── Pro: vivid purple chrome — matches orchestrator Pro gradient ──
  pro: {
    '--wrv-overlay':        'rgba(30,10,60,0.92)',
    '--wrv-bg':             'linear-gradient(135deg, #1e1040 0%, #2d1b69 50%, #1a0e3a 100%)',
    '--wrv-bg-content':     '#160d30',
    '--wrv-bg-sidebar':     'rgba(168,85,247,0.08)',
    '--wrv-bg-card':        'rgba(168,85,247,0.06)',
    '--wrv-bg-input':       'rgba(0,0,0,0.3)',
    '--wrv-border':         'rgba(168,85,247,0.18)',
    '--wrv-border-accent':  'rgba(168,85,247,0.30)',
    '--wrv-text':           '#f3f0ff',
    '--wrv-text-2':         '#c4b5fd',
    '--wrv-text-3':         '#8b7ab8',
    '--wrv-accent':         '#a855f7',
    '--wrv-accent-rgb':     '168,85,247',
    '--wrv-shadow':         '0 20px 60px rgba(30,10,60,0.6)',
    '--wrv-header-bg':      'rgba(168,85,247,0.12)',
    '--wrv-header-border':  'rgba(168,85,247,0.22)',
    '--wrv-header-sub':     '#c084fc',
    '--wrv-btn-primary':    'linear-gradient(135deg, #a855f7 0%, #9333ea 100%)',
    '--wrv-danger':         '#ff3b30',
    '--wrv-danger-bg':      'rgba(255,59,48,0.15)',
    '--wrv-danger-border':  'rgba(255,59,48,0.3)',
  },
  // ── Dark: deep slate — matches orchestrator Dark (#0f172a → #1e293b) ──
  dark: {
    '--wrv-overlay':        'rgba(0,0,0,0.90)',
    '--wrv-bg':             'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
    '--wrv-bg-content':     '#111827',
    '--wrv-bg-sidebar':     'rgba(15,23,42,0.6)',
    '--wrv-bg-card':        'rgba(30,41,59,0.5)',
    '--wrv-bg-input':       'rgba(15,23,42,0.8)',
    '--wrv-border':         'rgba(148,163,184,0.15)',
    '--wrv-border-accent':  'rgba(148,163,184,0.22)',
    '--wrv-text':           '#e7e9ea',
    '--wrv-text-2':         '#94a3b8',
    '--wrv-text-3':         '#64748b',
    '--wrv-accent':         '#818cf8',
    '--wrv-accent-rgb':     '129,140,248',
    '--wrv-shadow':         '0 20px 60px rgba(0,0,0,0.7)',
    '--wrv-header-bg':      'rgba(30,41,59,0.8)',
    '--wrv-header-border':  'rgba(148,163,184,0.15)',
    '--wrv-header-sub':     '#94a3b8',
    '--wrv-btn-primary':    'linear-gradient(135deg, #818cf8 0%, #6366f1 100%)',
    '--wrv-danger':         '#ef4444',
    '--wrv-danger-bg':      'rgba(239,68,68,0.15)',
    '--wrv-danger-border':  'rgba(239,68,68,0.3)',
  },
  // ── Standard: LIGHT theme — matches orchestrator #f8f9fb / dark text ──
  standard: {
    '--wrv-overlay':        'rgba(15,20,25,0.60)',
    '--wrv-bg':             '#f8f9fb',
    '--wrv-bg-content':     '#ffffff',
    '--wrv-bg-sidebar':     '#f1f3f5',
    '--wrv-bg-card':        '#ffffff',
    '--wrv-bg-input':       '#f1f3f5',
    '--wrv-border':         '#e1e8ed',
    '--wrv-border-accent':  '#d1d9e0',
    '--wrv-text':           '#0f1419',
    '--wrv-text-2':         '#536471',
    '--wrv-text-3':         '#8899a6',
    '--wrv-accent':         '#6366f1',
    '--wrv-accent-rgb':     '99,102,241',
    '--wrv-shadow':         '0 20px 60px rgba(15,23,42,0.12)',
    '--wrv-header-bg':      '#ffffff',
    '--wrv-header-border':  '#e1e8ed',
    '--wrv-header-sub':     '#536471',
    '--wrv-btn-primary':    'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
    '--wrv-danger':         '#dc2626',
    '--wrv-danger-bg':      'rgba(220,38,38,0.08)',
    '--wrv-danger-border':  'rgba(220,38,38,0.2)',
  },
}

// Module-level theme state — set once during vault init.
let currentVaultTheme: VaultThemeName = 'pro'

/** Inject CSS custom properties on the vault root element. */
function applyVaultTheme(root: HTMLElement): VaultThemeName {
  const theme = detectVaultTheme()
  currentVaultTheme = theme
  const vars = VAULT_THEMES[theme]
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value)
  }

  // Inject scoped style overrides for the standard (light) theme so that
  // host-page CSS cannot force white text on light-background inputs.
  if (theme === 'standard') {
    const styleId = 'wrv-theme-overrides'
    if (!root.querySelector(`#${styleId}`)) {
      const style = document.createElement('style')
      style.id = styleId
      style.textContent = `
        #wrvault-overlay input,
        #wrvault-overlay select,
        #wrvault-overlay textarea {
          color: #0f1419 !important;
          -webkit-text-fill-color: #0f1419 !important;
        }
        #wrvault-overlay input::placeholder,
        #wrvault-overlay textarea::placeholder {
          color: #8899a6 !important;
          -webkit-text-fill-color: #8899a6 !important;
        }
        #wrvault-overlay option {
          color: #0f1419 !important;
          background: #ffffff !important;
        }
        #wrvault-overlay button {
          color: var(--wrv-text) !important;
        }
        #wrvault-overlay #vault-unlock-btn,
        #wrvault-overlay #vault-create-btn,
        #wrvault-overlay .wrv-add-data-btn {
          color: #ffffff !important;
        }
      `
      root.appendChild(style)
    }
  }

  return theme
}

// Connect to vault on module load
let connectionPromise: Promise<void> | null = null

function ensureConnected(): Promise<void> {
  if (!connectionPromise) {
    connectionPromise = vaultAPI.connectVault()
  }
  return connectionPromise
}

/**
 * After closing a dialog that replaced #vault-main-content,
 * re-render the full dashboard and reload items.
 */
function restoreDashboardAfterDialogClose(container: HTMLElement) {
  renderVaultDashboard(container)
  setTimeout(() => {
    loadContainersIntoTree(container)
    addAddButtonsToTree(container)
    loadVaultItems(container, 'all')
  }, 100)
}

export function openVaultLightbox() {
  const overlay = document.createElement('div')
  overlay.id = 'wrvault-overlay'
  overlay.setAttribute('data-wrv-no-autofill', '')
  overlay.style.cssText = `position:fixed;inset:0;background:var(--wrv-overlay);z-index:2147483649;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px)`

  // Inject theme-aware CSS custom properties
  applyVaultTheme(overlay)

  const container = document.createElement('div')
  container.id = 'wrvault-container'
  container.style.cssText = `
    background: var(--wrv-bg);
    border-radius: 12px;
    width: 96vw;
    max-width: 1600px;
    height: 92vh;
    color: var(--wrv-text);
    overflow: hidden;
    box-shadow: var(--wrv-shadow);
    display: flex;
    flex-direction: column;
    border: 1px solid var(--wrv-border-accent);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  `

  // Header
  const header = document.createElement('div')
  header.style.cssText = `
    padding: 10px 24px;
    background: var(--wrv-header-bg);
    border-bottom: 1px solid var(--wrv-header-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  `
  header.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;">
      <div style="font-size:20px;">🔒</div>
      <div>
        <div style="font-size:15px;font-weight:700;letter-spacing:-0.2px;">WRVault</div>
        <div style="font-size:10px;color:var(--wrv-header-sub);font-weight:500;letter-spacing:0.3px;">Secure Data Manager</div>
      </div>
      <div id="wrv-tier-badge" style="margin-left:8px;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;background:rgba(var(--wrv-accent-rgb),0.12);color:var(--wrv-accent);border:1px solid rgba(var(--wrv-accent-rgb),0.20);">free</div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;">
      <div id="wrv-mode-toggle" style="
        display:none;
        border-radius:6px;
        overflow:hidden;
        border:1px solid rgba(var(--wrv-accent-rgb),0.25);
        font-size:11px;
        font-weight:600;
        cursor:pointer;
        user-select:none;
      ">
        <button id="wrv-mode-auto" type="button" style="
          padding:4px 10px;
          border:none;
          cursor:pointer;
          font-size:11px;
          font-weight:600;
          transition:all 0.15s;
        ">Auto</button>
        <button id="wrv-mode-manual" type="button" style="
          padding:4px 10px;
          border:none;
          cursor:pointer;
          font-size:11px;
          font-weight:600;
          transition:all 0.15s;
        ">Manual</button>
      </div>
      <button id="wrv-close" style="
        background: rgba(var(--wrv-accent-rgb),0.10);
        border: 1px solid rgba(var(--wrv-accent-rgb),0.20);
        color: var(--wrv-accent);
        width: 30px;
        height: 30px;
        border-radius: 50%;
        cursor: pointer;
        font-size: 16px;
        font-weight: 600;
        transition: all 0.15s;
        display:flex;align-items:center;justify-content:center;
      ">×</button>
    </div>
  `

  // Main content area
  const mainContent = document.createElement('div')
  mainContent.id = 'vault-main-content'
  mainContent.style.cssText = `
    flex: 1;
    overflow-y: auto;
    padding: 24px;
    background: var(--wrv-bg-content);
  `

  container.appendChild(header)
  container.appendChild(mainContent)
  overlay.appendChild(container)

  // Close button handler
  const closeBtn = header.querySelector('#wrv-close') as HTMLElement
  closeBtn?.addEventListener('mouseenter', () => {
    closeBtn.style.background = 'rgba(var(--wrv-accent-rgb),0.20)'
    closeBtn.style.transform = 'scale(1.1)'
  })
  closeBtn?.addEventListener('mouseleave', () => {
    closeBtn.style.background = 'rgba(var(--wrv-accent-rgb),0.10)'
    closeBtn.style.transform = 'scale(1)'
  })
  closeBtn?.addEventListener('click', () => {
    overlay.remove()
  })

  // ── Auto/Manual mode toggle ──
  const autoBtn = header.querySelector('#wrv-mode-auto') as HTMLButtonElement
  const manualBtn = header.querySelector('#wrv-mode-manual') as HTMLButtonElement

  function applyModeStyles(isAuto: boolean) {
    if (isAuto) {
      autoBtn.style.background = 'var(--wrv-accent)'
      autoBtn.style.color = '#fff'
      manualBtn.style.background = 'transparent'
      manualBtn.style.color = 'var(--wrv-header-text, #cbd5e1)'
    } else {
      manualBtn.style.background = 'var(--wrv-accent)'
      manualBtn.style.color = '#fff'
      autoBtn.style.background = 'transparent'
      autoBtn.style.color = 'var(--wrv-header-text, #cbd5e1)'
    }
  }

  // Load initial state
  loadAutoConsentForVault().then(isAuto => applyModeStyles(isAuto))

  autoBtn?.addEventListener('click', async () => {
    const alreadyConsented = await loadAutoConsentForVault()
    if (!alreadyConsented) {
      const accepted = await showVaultAutoConsentDialog()
      if (!accepted) return
    }
    // Always persist — ensures the setting sticks even after manual toggle
    await saveAutoConsent(true)
    applyModeStyles(true)
  })

  manualBtn?.addEventListener('click', async () => {
    await saveAutoConsent(false)
    applyModeStyles(false)
  })

  // Close on Escape key
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      overlay.remove()
      document.removeEventListener('keydown', escHandler)
    }
  }
  document.addEventListener('keydown', escHandler)

  // Close on backdrop click (outside the container)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove()
  })

  document.body.appendChild(overlay)

  // Initialize vault UI
  initVaultUI(mainContent)

  console.log('[VAULT] ✅ WRVault lightbox opened with TypeScript UI')
}

// Initialize Vault UI - Pure TypeScript implementation
async function initVaultUI(container: HTMLElement) {
  try {
    // Ensure connected and check vault status
    console.log('[VAULT UI] Attempting to connect to Electron...')
    await ensureConnected()
    console.log('[VAULT UI] Connected! Getting vault status...')
    const status = await vaultAPI.getVaultStatus()
    console.log('[VAULT UI] Status received:', status)
    console.log('[VAULT UI] Available vaults:', status.availableVaults)

    // Capture tier from backend (fail-closed to 'free')
    if (status.tier) {
      currentVaultTier = status.tier as VaultTier
      console.log('[VAULT UI] Tier set from backend:', currentVaultTier)
    } else {
      console.warn('[VAULT UI] No tier in status response — defaulting to free. Status payload:', JSON.stringify(status))
    }

    // Update tier badge in header (if visible)
    const tierBadge = document.getElementById('wrv-tier-badge')
    if (tierBadge) {
      tierBadge.textContent = currentVaultTier
    }

    if (status.isUnlocked) {
      renderVaultDashboard(container)
    } else if (status.exists || (status.availableVaults && status.availableVaults.length > 0)) {
      // Show unlock screen if vault exists OR if there are any available vaults
      await renderUnlockScreen(container)
    } else {
      renderCreateVaultScreen(container)
    }
  } catch (err: any) {
    console.error('[VAULT UI] Init error:', err)
    console.error('[VAULT UI] Error stack:', err.stack)
    
    // Get debug logs from window
    const debugLogs = (window as any).vaultDebugLogs || []
    const logsText = debugLogs.map((log: any) => 
      `[${log.time}] [${log.level}] ${log.message}${log.data ? '\n' + log.data : ''}`
    ).join('\n\n')
    
    container.innerHTML = `
      <div style="text-align:center;padding:40px 20px;">
        <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
        <div style="font-size:18px;font-weight:600;margin-bottom:8px;color:var(--wrv-text);">Cannot Connect to Vault</div>
        <div style="font-size:14px;color:var(--wrv-text-3);margin-bottom:24px;">
          Please ensure the Electron app is running and try again.
        </div>
        
        <div style="font-size:12px;color:var(--wrv-text-3);font-family:monospace;white-space:pre-wrap;text-align:left;max-width:800px;margin:0 auto 20px;background:var(--wrv-bg-input);padding:16px;border-radius:8px;border:1px solid var(--wrv-danger-border);">
          <strong style="color:var(--wrv-danger);">Error:</strong> ${err.message || err}
          ${err.stack ? '\n\n<strong>Stack:</strong>\n' + err.stack : ''}
        </div>
        
        <div style="max-width:800px;margin:0 auto;">
          <button id="vault-retry-connection" style="
            margin-bottom:20px;
            padding:12px 24px;
            background:var(--wrv-btn-primary);
            border:none;
            border-radius:8px;
            color:#fff;
            font-size:15px;
            font-weight:600;
            cursor:pointer;
            transition:all 0.2s;
          ">🔄 Retry Connection</button>
          
          <details style="text-align:left;background:var(--wrv-bg-card);border-radius:8px;padding:16px;border:1px solid rgba(var(--wrv-accent-rgb),0.25);">
            <summary style="cursor:pointer;font-weight:600;color:var(--wrv-header-sub);margin-bottom:12px;user-select:none;">📋 Debug Logs (Click to expand)</summary>
            <div style="font-size:11px;color:var(--wrv-text-2);font-family:monospace;white-space:pre-wrap;max-height:400px;overflow-y:auto;padding:12px;background:var(--wrv-bg-input);border-radius:4px;margin-top:12px;">
              ${logsText || 'No debug logs available'}
            </div>
            <button onclick="navigator.clipboard.writeText(\`Error: ${(err.message || err).replace(/`/g, '\\`')}\n\nStack:\n${(err.stack || '').replace(/`/g, '\\`')}\n\nDebug Logs:\n${logsText.replace(/`/g, '\\`')}\`)" style="margin-top:12px;padding:8px 16px;background:var(--wrv-accent);border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:12px;">📋 Copy All Logs</button>
          </details>
        </div>
      </div>
    `
    
    // Add retry button handler
    const retryBtn = container.querySelector('#vault-retry-connection')
    if (retryBtn) {
      retryBtn.addEventListener('click', async () => {
        const btn = retryBtn as HTMLButtonElement
        btn.textContent = '🔄 Retrying...'
        btn.disabled = true
        try {
          // Check health first
          const isHealthy = await vaultAPI.checkHealth()
          if (isHealthy) {
            // Reload the vault UI
            initVaultUI(container)
          } else {
            throw new Error('Health check failed - Electron app may not be running')
          }
        } catch (retryErr: any) {
          console.error('[VAULT UI] Retry failed:', retryErr)
          btn.textContent = `❌ Retry Failed: ${retryErr.message}`
          setTimeout(() => {
            btn.textContent = '🔄 Retry Connection'
            btn.disabled = false
          }, 3000)
        }
      })
    }
  }
}

// Render Create Vault Screen
function renderCreateVaultScreen(container: HTMLElement) {
  // Hide the Auto/Manual toggle — vault doesn't exist yet
  const modeToggle = document.getElementById('wrv-mode-toggle')
  if (modeToggle) modeToggle.style.display = 'none'

  container.innerHTML = `
    <div style="max-width:580px;margin:40px auto;text-align:center;">
      <div style="font-size:64px;margin-bottom:24px;">🔐</div>
      <h2 style="font-size:28px;font-weight:700;margin-bottom:12px;color:var(--wrv-text);">Create Your Local Vault</h2>
      <p style="font-size:14px;color:var(--wrv-text-2);margin-bottom:32px;">
        Establish a secure, locally-encrypted password manager for your sensitive credentials and personal data
      </p>
      
      <!-- CRITICAL SECURITY WARNING -->
      <div style="background:rgba(var(--wrv-accent-rgb),0.10);border:2px solid rgba(var(--wrv-accent-rgb),0.35);border-radius:12px;padding:20px;margin-bottom:24px;text-align:left;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
          <div style="font-size:32px;">⚠️</div>
          <div style="font-size:18px;font-weight:700;color:var(--wrv-header-sub);">CRITICAL SECURITY NOTICE</div>
        </div>
        <ul style="margin:0;padding-left:20px;font-size:13px;color:var(--wrv-text);line-height:1.8;">
          <li><strong>Master password recovery is not available.</strong> There is no password reset mechanism by design.</li>
          <li><strong>Loss of your master password results in permanent data loss.</strong> All vault contents will become irretrievable.</li>
          <li><strong>No recovery assistance can be provided.</strong> Your password is known exclusively to you and never transmitted.</li>
          <li><strong>Document your master password securely.</strong> Store it in a secure physical location, separate from digital systems.</li>
          <li><strong>Implement a robust password policy.</strong> Utilize a minimum of 12 characters combining uppercase, lowercase, numerals, and special characters.</li>
        </ul>
      </div>
      
      <!-- DATA BACKUP INFORMATION -->
      <div style="background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.4);border-radius:12px;padding:16px;margin-bottom:32px;text-align:left;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <div style="font-size:20px;">💾</div>
          <div style="font-size:14px;font-weight:600;color:#3b82f6;">Data Backup & Recovery</div>
        </div>
        <p style="margin:0;font-size:12px;color:var(--wrv-text);line-height:1.7;">
          Your vault data can be exported as an encrypted CSV file for secure backup purposes. We recommend storing backups on encrypted external storage (e.g., VeraCrypt container on an external SSD) to maintain an air-gapped recovery option. Regular exports ensure data redundancy independent of the master password.
        </p>
      </div>
      
      <div style="background:rgba(var(--wrv-accent-rgb),0.04);border:1px solid rgba(var(--wrv-accent-rgb),0.15);border-radius:12px;padding:32px;text-align:left;">
        <label style="display:block;font-size:13px;font-weight:600;margin-bottom:8px;color:var(--wrv-text);">
          Vault Name <span style="color:var(--wrv-danger);">*</span>
        </label>
        <input type="text" id="vault-create-name" placeholder="e.g., Personal Vault, Work Vault" style="
          width:100%;
          padding:14px 16px;
          border:1px solid var(--wrv-border-accent);
          border-radius:8px;
          background:var(--wrv-bg-card);
          color:var(--wrv-text);
          font-size:15px;
          margin-bottom:24px;
        "/>
        
        <label style="display:block;font-size:13px;font-weight:600;margin-bottom:8px;color:var(--wrv-text);">
          Master Password <span style="color:var(--wrv-danger);">*</span>
        </label>
        <input type="password" id="vault-create-password" placeholder="Enter a strong master password (min. 12 characters)" style="
          width:100%;
          padding:14px 16px;
          border:1px solid var(--wrv-border-accent);
          border-radius:8px;
          background:var(--wrv-bg-card);
          color:var(--wrv-text);
          font-size:15px;
          margin-bottom:8px;
        "/>
        <div id="password-strength" style="height:4px;background:var(--wrv-bg-card);border-radius:2px;margin-bottom:16px;overflow:hidden;">
          <div id="password-strength-bar" style="height:100%;width:0%;background:#ff3b30;transition:all 0.3s;"></div>
        </div>
        <div id="password-strength-text" style="font-size:12px;color:var(--wrv-text-3);margin-bottom:16px;"></div>
        
        <label style="display:block;font-size:13px;font-weight:600;margin-bottom:8px;color:var(--wrv-text);">
          Confirm Master Password <span style="color:var(--wrv-danger);">*</span>
        </label>
        <input type="password" id="vault-create-confirm" placeholder="Re-enter your master password" style="
          width:100%;
          padding:14px 16px;
          border:1px solid var(--wrv-border-accent);
          border-radius:8px;
          background:var(--wrv-bg-card);
          color:var(--wrv-text);
          font-size:15px;
          margin-bottom:24px;
        "/>
        
                <!-- Security Acknowledgment Checkbox -->
                <div style="margin-bottom:56px;padding:16px;background:rgba(var(--wrv-accent-rgb),0.08);border:1px solid rgba(var(--wrv-accent-rgb),0.25);border-radius:8px;clear:both;">
                  <label style="display:flex;align-items:start;gap:12px;cursor:pointer;user-select:none;">
                    <input type="checkbox" id="vault-backup-confirm" style="width:18px;height:18px;min-width:18px;margin-top:3px;cursor:pointer;flex-shrink:0;"/>
                    <span style="font-size:13px;line-height:1.8;color:var(--wrv-text);flex:1;padding-bottom:0;">
                      <strong style="display:block;margin-bottom:8px;color:var(--wrv-header-sub);">I acknowledge the security implications and have documented my master password</strong>
                      <span style="display:block;margin-bottom:0;">I understand that this password has been stored securely in a physical location and that loss of access will result in permanent, irreversible data loss. I accept full responsibility for password management and backup procedures.</span>
                    </span>
                  </label>
                </div>
        
        <div id="vault-create-error" style="display:none;background:rgba(255,59,48,0.1);border:1px solid var(--wrv-danger-border);padding:12px;border-radius:8px;margin-bottom:24px;color:var(--wrv-danger);font-size:13px;clear:both;"></div>
        
        <div style="clear:both;margin-top:40px;margin-bottom:0;">
          <button id="vault-create-btn" disabled style="
            width:100%;
            padding:14px;
            background:var(--wrv-btn-primary);
            border:none;
            border-radius:8px;
            color:#fff;
            font-size:16px;
            font-weight:600;
            cursor:not-allowed;
            opacity:0.5;
            transition:all 0.2s;
            display:block;
            position:relative;
            z-index:1;
          ">Create Local Vault</button>
        </div>
        
        <div style="margin-top:16px;padding:12px;background:rgba(var(--wrv-accent-rgb),0.06);border-radius:8px;font-size:12px;color:var(--wrv-text-2);text-align:center;">
          🔒 Your data is encrypted with industry-standard AES-256-GCM + Argon2id
        </div>
      </div>
    </div>
  `

  const vaultNameInput = container.querySelector('#vault-create-name') as HTMLInputElement
  const passwordInput = container.querySelector('#vault-create-password') as HTMLInputElement
  const confirmInput = container.querySelector('#vault-create-confirm') as HTMLInputElement
  const createBtn = container.querySelector('#vault-create-btn') as HTMLButtonElement
  const errorDiv = container.querySelector('#vault-create-error') as HTMLElement
  const backupCheckbox = container.querySelector('#vault-backup-confirm') as HTMLInputElement
  const strengthBar = container.querySelector('#password-strength-bar') as HTMLElement
  const strengthText = container.querySelector('#password-strength-text') as HTMLElement

  // Ensure checkbox starts unchecked
  if (backupCheckbox) {
    backupCheckbox.checked = false
  }

  // Password strength checker
  function checkPasswordStrength(password: string) {
    let strength = 0
    let feedback = []

    if (password.length >= 12) strength += 25
    else feedback.push('at least 12 characters')

    if (password.length >= 16) strength += 10
    if (/[a-z]/.test(password)) strength += 15
    else feedback.push('lowercase letters')
    
    if (/[A-Z]/.test(password)) strength += 15
    else feedback.push('uppercase letters')
    
    if (/[0-9]/.test(password)) strength += 15
    else feedback.push('numbers')
    
    if (/[^a-zA-Z0-9]/.test(password)) strength += 20
    else feedback.push('symbols (!@#$%^&*)')

    let color = '#ff3b30'
    let label = 'Very Weak'
    
    if (strength >= 90) {
      color = '#34c759'
      label = 'Very Strong ✓'
    } else if (strength >= 70) {
      color = '#30d158'
      label = 'Strong'
    } else if (strength >= 50) {
      color = '#ff9500'
      label = 'Fair'
    } else if (strength >= 30) {
      color = '#ff9500'
      label = 'Weak'
    }

    strengthBar.style.width = `${strength}%`
    strengthBar.style.background = color
    
    if (password.length > 0) {
      if (feedback.length > 0) {
        strengthText.textContent = `${label} - Add: ${feedback.join(', ')}`
        strengthText.style.color = color
      } else {
        strengthText.textContent = `${label} - Excellent password!`
        strengthText.style.color = color
      }
    } else {
      strengthText.textContent = ''
    }

    return strength
  }

  // Enable/disable create button based on validation
  function validateForm() {
    const vaultName = vaultNameInput.value.trim()
    const password = passwordInput.value
    const confirm = confirmInput.value
    const isChecked = backupCheckbox.checked
    const strength = checkPasswordStrength(password)

    const isValid = vaultName.length > 0 && password.length >= 12 && password === confirm && isChecked && strength >= 50

    createBtn.disabled = !isValid
    createBtn.style.cursor = isValid ? 'pointer' : 'not-allowed'
    createBtn.style.opacity = isValid ? '1' : '0.5'
  }

  vaultNameInput?.addEventListener('input', validateForm)
  passwordInput?.addEventListener('input', () => {
    checkPasswordStrength(passwordInput.value)
    validateForm()
  })
  
  confirmInput?.addEventListener('input', validateForm)
  backupCheckbox?.addEventListener('change', validateForm)

  createBtn?.addEventListener('click', async () => {
    const vaultName = vaultNameInput?.value.trim() || ''
    const password = passwordInput?.value || ''
    const confirm = confirmInput?.value || ''

    if (!vaultName) {
      errorDiv.textContent = '❌ Please enter a vault name'
      errorDiv.style.display = 'block'
      return
    }

    if (!password || password.length < 12) {
      errorDiv.textContent = '❌ Master password must be at least 12 characters long'
      errorDiv.style.display = 'block'
      return
    }

    if (checkPasswordStrength(password) < 50) {
      errorDiv.textContent = '❌ Password is too weak. Please use a stronger password with letters, numbers, and symbols.'
      errorDiv.style.display = 'block'
      return
    }

    if (password !== confirm) {
      errorDiv.textContent = '❌ Passwords do not match'
      errorDiv.style.display = 'block'
      return
    }

    if (!backupCheckbox.checked) {
      errorDiv.textContent = '❌ You must acknowledge the security implications and confirm password documentation'
      errorDiv.style.display = 'block'
      return
    }

    try {
      createBtn.textContent = 'Creating Vault...'
      createBtn.disabled = true
      await vaultAPI.createVault(password, vaultName)
      
      // Show success message
      container.innerHTML = `
        <div style="max-width:520px;margin:80px auto;text-align:center;">
          <div style="font-size:72px;margin-bottom:24px;">✅</div>
          <h2 style="font-size:28px;font-weight:700;margin-bottom:16px;color:#34c759;">Local Vault Successfully Initialized</h2>
          <p style="font-size:14px;color:var(--wrv-text-2);margin-bottom:32px;">
            Your secure, locally-encrypted vault has been established. All stored data is protected with military-grade AES-256-GCM encryption derived from your master password.
          </p>
          <div style="background:rgba(var(--wrv-accent-rgb),0.08);border:1px solid var(--wrv-border-accent);border-radius:12px;padding:20px;margin-bottom:24px;text-align:left;">
            <div style="font-size:14px;font-weight:600;margin-bottom:12px;color:var(--wrv-text);">🔐 Security Best Practices:</div>
            <ul style="margin:0;padding-left:20px;font-size:13px;color:var(--wrv-text-2);line-height:1.8;">
              <li>Maintain your master password in a secure, offline location</li>
              <li>Never disclose your master password to any third party</li>
              <li>Regularly export vault data to encrypted external storage (CSV format available)</li>
              <li>Consider implementing a VeraCrypt container on an external SSD for backup redundancy</li>
              <li>Review and update your backup strategy periodically</li>
            </ul>
          </div>
          <button id="vault-continue-btn" style="
            padding:14px 32px;
            background:var(--wrv-btn-primary);
            border:none;
            border-radius:8px;
            color:#fff;
            font-size:16px;
            font-weight:600;
            cursor:pointer;
          ">Continue to Vault</button>
        </div>
      `
      
      container.querySelector('#vault-continue-btn')?.addEventListener('click', () => {
        renderVaultDashboard(container)
      })
    } catch (err: any) {
      errorDiv.textContent = `❌ ${err.message || 'Failed to create vault'}`
      errorDiv.style.display = 'block'
      createBtn.textContent = 'Create Vault'
      createBtn.disabled = false
      validateForm()
    }
  })
}

// Render Unlock Screen
async function renderUnlockScreen(container: HTMLElement) {
  // Hide the Auto/Manual toggle while vault is locked
  const modeToggle = document.getElementById('wrv-mode-toggle')
  if (modeToggle) modeToggle.style.display = 'none'

  // Load available vaults - always ensure dropdown has options even if API fails
  let availableVaults: Array<{ id: string, name: string, created: number }> = []
  let connectionError: string | null = null
  let unlockProviders: Array<{ id: string; name: string }> = [{ id: 'passphrase', name: 'Master Password' }]
  let activeProviderType = 'passphrase'
  
  try {
    // First check health
    const isHealthy = await vaultAPI.checkHealth()
    if (!isHealthy) {
      console.warn('[VAULT UI] Health check failed, but continuing with unlock screen')
    }
    
    const status = await vaultAPI.getVaultStatus()
    console.log('[VAULT UI] Status received:', status)
    availableVaults = status.availableVaults || []
    console.log('[VAULT UI] Available vaults:', availableVaults)
    
    // Provider info from status
    if (status.unlockProviders && status.unlockProviders.length > 0) {
      unlockProviders = status.unlockProviders
    }
    if (status.activeProviderType) {
      activeProviderType = status.activeProviderType
    }
    
    // If no vaults but status exists, add default vault
    if (availableVaults.length === 0 && status.exists) {
      availableVaults = [{ id: 'default', name: 'Default Vault', created: 0 }]
    }
  } catch (err: any) {
    console.error('[VAULT UI] Failed to load vaults:', err)
    connectionError = err.message || 'Connection error'
    // Fallback to default vault if error - UI should still render
  }
  
  // Always ensure at least one option in the dropdown
  if (availableVaults.length === 0) {
    availableVaults = [{ id: 'default', name: 'Default Vault', created: 0 }]
  }
  
  const hasMultipleProviders = unlockProviders.length > 1
  console.log('[VAULT UI] Rendering unlock screen with vaults:', availableVaults, 'providers:', unlockProviders)

  // Build provider selector HTML (hidden if only one provider)
  const providerSelectorHTML = hasMultipleProviders ? `
        <label style="display:block;font-size:13px;font-weight:600;margin-bottom:8px;color:var(--wrv-text);">Unlock Method</label>
        <select id="vault-provider-select" style="
          width:100%;
          padding:14px 16px;
          border:1px solid var(--wrv-border-accent);
          border-radius:8px;
          background:var(--wrv-bg-card);
          color:var(--wrv-text);
          font-size:15px;
          margin-bottom:24px;
          cursor:pointer;
          box-sizing:border-box;
          display:block;
        ">
          ${unlockProviders.map(p =>
            `<option value="${p.id}" ${p.id === activeProviderType ? 'selected' : ''}>${p.name}</option>`
          ).join('')}
        </select>
  ` : `<input type="hidden" id="vault-provider-select" value="${activeProviderType}" />`

  container.innerHTML = `
    <div style="max-width:440px;margin:80px auto;text-align:center;">
      <div style="font-size:64px;margin-bottom:24px;">🔒</div>
      <h2 style="font-size:28px;font-weight:700;margin-bottom:12px;color:var(--wrv-text);">Unlock Vault</h2>
      <p style="font-size:14px;color:var(--wrv-text-2);margin-bottom:40px;">
        Select a vault and enter your master password to access it
      </p>
      
      <div style="background:rgba(var(--wrv-accent-rgb),0.04);border:1px solid rgba(var(--wrv-accent-rgb),0.15);border-radius:12px;padding:32px;text-align:left;">
        <label style="display:block;font-size:13px;font-weight:600;margin-bottom:8px;color:var(--wrv-text);">Select Vault</label>
        <select id="vault-select" style="
          width:100%;
          padding:14px 16px;
          border:1px solid var(--wrv-border-accent);
          border-radius:8px;
          background:var(--wrv-bg-card);
          color:var(--wrv-text);
          font-size:15px;
          margin-bottom:24px;
          cursor:pointer;
          box-sizing:border-box;
          display:block;
        ">
          ${availableVaults.length > 0 
            ? availableVaults.map(v => `<option value="${v.id}">${v.name || v.id}</option>`).join('')
            : '<option value="default">Default Vault</option>'
          }
        </select>
        
        ${providerSelectorHTML}
        
        <!-- Passphrase unlock form -->
        <div id="vault-passphrase-form">
          <label style="display:block;font-size:13px;font-weight:600;margin-bottom:8px;color:var(--wrv-text);">Master Password</label>
          <input type="password" id="vault-unlock-password" placeholder="Enter master password" style="
            width:100%;
            padding:14px 16px;
            border:1px solid var(--wrv-border-accent);
            border-radius:8px;
            background:var(--wrv-bg-card);
            color:var(--wrv-text);
            font-size:15px;
            margin-bottom:24px;
            box-sizing:border-box;
          "/>
        </div>
        
        <div id="vault-unlock-error" style="display:${connectionError ? 'block' : 'none'};background:rgba(255,59,48,0.1);border:1px solid var(--wrv-danger-border);padding:12px;border-radius:8px;margin-bottom:16px;color:var(--wrv-danger);font-size:13px;">
          ${connectionError ? `⚠️ Connection issue: ${connectionError}. You can still try to unlock if Electron is running.` : ''}
        </div>
        
        <button id="vault-unlock-btn" style="
          width:100%;
          padding:14px;
          background:var(--wrv-btn-primary);
          border:none;
          border-radius:8px;
          color:#fff;
          font-size:16px;
          font-weight:600;
          cursor:pointer;
          transition:all 0.2s;
          margin-bottom:16px;
        ">Unlock with Password</button>
        
        <div style="border-top:1px solid rgba(var(--wrv-accent-rgb),0.15);padding-top:16px;margin-top:16px;text-align:center;">
          <button id="vault-create-new-btn" style="
            width:100%;
            padding:10px;
            background:rgba(var(--wrv-accent-rgb),0.15);
            border:1px solid rgba(var(--wrv-accent-rgb),0.30);
            border-radius:6px;
            color:var(--wrv-header-sub);
            font-size:13px;
            font-weight:500;
            cursor:pointer;
            transition:all 0.2s;
          ">Create New Vault</button>
        </div>
      </div>
    </div>
  `

  const vaultSelect = container.querySelector('#vault-select') as HTMLSelectElement
  const providerSelect = container.querySelector('#vault-provider-select') as HTMLSelectElement | HTMLInputElement
  const passwordInput = container.querySelector('#vault-unlock-password') as HTMLInputElement
  const unlockBtn = container.querySelector('#vault-unlock-btn') as HTMLButtonElement
  const errorDiv = container.querySelector('#vault-unlock-error') as HTMLElement

  // Passphrase unlock handler
  const doUnlock = async () => {
    const vaultId = vaultSelect?.value || 'default'
    const password = passwordInput?.value || ''

    if (!password) {
      errorDiv.textContent = 'Please enter your password'
      errorDiv.style.display = 'block'
      return
    }

    try {
      unlockBtn.textContent = 'Unlocking...'
      unlockBtn.disabled = true
      await vaultAPI.unlockVault(password, vaultId)
      renderVaultDashboard(container)
    } catch (err: any) {
      errorDiv.textContent = err.message || 'Failed to unlock vault'
      errorDiv.style.display = 'block'
      unlockBtn.textContent = 'Unlock with Password'
      unlockBtn.disabled = false
    }
  }

  unlockBtn?.addEventListener('click', doUnlock)
  passwordInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') doUnlock()
  })

  // Create New Vault button
  const createNewBtn = container.querySelector('#vault-create-new-btn') as HTMLButtonElement
  createNewBtn?.addEventListener('click', () => {
    renderCreateVaultScreen(container)
  })
}

// ---------------------------------------------------------------------------
// Sidebar category builder — generates HTML per tier
// ---------------------------------------------------------------------------

/** Metadata for sidebar categories: maps category → tree config */
const SIDEBAR_CATEGORY_CONFIG: Record<string, {
  containerType?: string // data-container attribute (for tree grouping)
  viewAction: string     // data-action on the "View X" button
  viewLabel: string      // label for the "View X" button
  containersId?: string  // id for the dynamic containers div
}> = {
  automation_secret: { viewAction: 'view-secrets', viewLabel: 'View Secrets' },
  password:          { viewAction: 'view-passwords', viewLabel: 'View Passwords' },
  identity:          { containerType: 'person', viewAction: 'view-identities', viewLabel: 'View Identities', containersId: 'person-containers' },
  company:           { containerType: 'company', viewAction: 'view-companies', viewLabel: 'View Companies', containersId: 'company-containers' },
  custom:            { viewAction: 'view-data', viewLabel: 'View Data', containersId: 'custom-containers' },
  document:          { viewAction: 'view-documents', viewLabel: 'View Documents' },
  handshake_context: { viewAction: 'view-handshake-context', viewLabel: 'View Context Items' },
}

function buildSidebarCategoriesHTML(tier: VaultTier): string {
  let html = ''

  // --- Active item categories ---
  const activeCats: Array<{ cat: string; accessible: boolean; minTier: string }> = []
  for (const cat of ALL_ITEM_CATEGORIES) {
    const uiInfo = CATEGORY_UI_MAP[cat]
    if (!uiInfo) continue
    const accessible = canAccessCategory(tier, cat)
    const minTier = RECORD_TYPE_MIN_TIER[uiInfo.recordType] || 'pro'
    activeCats.push({ cat, accessible, minTier })
  }

  for (const { cat, accessible, minTier } of activeCats) {
    const ui = CATEGORY_UI_MAP[cat]
    const cfg = SIDEBAR_CATEGORY_CONFIG[cat]
    if (!cfg) continue

    const parentAttr = cfg.containerType ? `data-container="${cfg.containerType}"` : `data-category="${cat}"`
    const parentKey = cfg.containerType || cat

    if (accessible) {
      // ── Accessible category: fully interactive ──
      html += `
          <div class="vault-category-main" ${parentAttr} style="border-radius:8px;overflow:hidden;">
            <div class="vault-category-btn vault-category-toggle" ${parentAttr} style="padding:10px 12px;background:var(--wrv-bg-card);cursor:pointer;font-size:13px;border:1px solid var(--wrv-border);transition:all 0.15s;display:flex;align-items:center;justify-content:space-between;">
              <span>${ui.icon} ${ui.sidebarLabel}</span>
              <span class="toggle-icon" style="font-size:10px;transition:transform 0.15s;">▶</span>
            </div>
            <div class="vault-subcategories" data-parent="${parentKey}" style="display:none;padding-left:14px;padding-top:4px;padding-bottom:4px;">
              <div class="vault-subcategory-btn" data-action="${cfg.viewAction}" data-category="${cat}" style="padding:7px 10px;background:rgba(var(--wrv-accent-rgb),0.08);border-radius:6px;cursor:pointer;font-size:12px;margin-top:4px;border:1px solid rgba(var(--wrv-accent-rgb),0.15);transition:all 0.15s;">${cfg.viewLabel}</div>
              ${cfg.containersId ? `<div id="${cfg.containersId}" style="margin-top:4px;"></div>` : ''}
            </div>
          </div>`
    } else {
      // ── Locked category: visible but disabled, with lock icon + tier badge ──
      const badgeLabel = minTier === 'publisher' || minTier === 'publisher_lifetime' ? 'Publisher' : 'Pro'
      html += `
          <div class="vault-category-main" ${parentAttr} style="border-radius:8px;overflow:hidden;">
            <div class="vault-category-btn vault-category-locked" ${parentAttr} title="Requires ${badgeLabel} plan" style="padding:8px 10px;background:var(--wrv-bg-card);cursor:default;font-size:13px;border:1px solid var(--wrv-border);transition:all 0.15s;display:flex;align-items:center;gap:6px;">
              <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--wrv-text-2);">${ui.icon} ${ui.sidebarLabel}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--wrv-text-3)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              <span style="flex-shrink:0;font-size:9px;font-weight:600;letter-spacing:0.3px;background:rgba(var(--wrv-accent-rgb),0.10);padding:2px 5px;border-radius:3px;color:var(--wrv-text-3);text-transform:uppercase;">${badgeLabel}</span>
            </div>
          </div>`
    }
  }

  return html
}

// Render Vault Dashboard (Main UI)
function renderVaultDashboard(container: HTMLElement) {
  // Show the Auto/Manual toggle now that the vault is unlocked
  const modeToggle = document.getElementById('wrv-mode-toggle')
  if (modeToggle) modeToggle.style.display = 'inline-flex'

  container.innerHTML = `
    <div style="display:flex;height:100%;gap:0;">
      <!-- Sidebar -->
      <div id="vault-sidebar" style="width:240px;min-width:240px;background:var(--wrv-bg-sidebar);padding:16px 14px;border-right:1px solid var(--wrv-border);display:flex;flex-direction:column;transition:width 0.2s ease,min-width 0.2s ease,padding 0.2s ease,opacity 0.15s ease;overflow:hidden;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <h3 style="font-size:12px;font-weight:700;color:var(--wrv-text-3);text-transform:uppercase;letter-spacing:1px;margin:0;">Categories</h3>
          <button id="vault-sidebar-collapse" title="Collapse sidebar" style="background:none;border:none;color:var(--wrv-text-3);cursor:pointer;font-size:14px;padding:2px 6px;border-radius:4px;transition:color 0.15s;" onmouseenter="this.style.color='var(--wrv-text)'" onmouseleave="this.style.color='var(--wrv-text-3)'">◀</button>
        </div>
        <div id="vault-categories" style="display:flex;flex-direction:column;gap:4px;flex:1;overflow-y:auto;">
          <div class="vault-category-btn" data-category="all" data-selected="true" style="padding:10px 12px;background:rgba(var(--wrv-accent-rgb),0.15);border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;border:1px solid rgba(var(--wrv-accent-rgb),0.3);transition:all 0.15s;">🗂️ All Items</div>
          
          ${buildSidebarCategoriesHTML(currentVaultTier)}
        </div>
        
        <div style="margin-top:auto;padding-top:16px;border-top:1px solid var(--wrv-border);">
          <button id="vault-settings-btn" style="width:100%;padding:10px;background:var(--wrv-bg-card);border:1px solid var(--wrv-border);border-radius:8px;color:var(--wrv-text-2);font-size:13px;cursor:pointer;margin-bottom:6px;transition:all 0.15s;">⚙️ Settings</button>
          <button id="vault-lock-btn" style="width:100%;padding:10px;background:rgba(var(--wrv-accent-rgb),0.10);border:1px solid rgba(var(--wrv-accent-rgb),0.20);border-radius:8px;color:var(--wrv-accent);font-size:13px;font-weight:600;cursor:pointer;transition:all 0.15s;">🔒 Lock Vault</button>
        </div>
      </div>
      
      <!-- Main content -->
      <div style="flex:1;display:flex;flex-direction:column;gap:14px;padding:18px 24px;min-width:0;background:var(--wrv-bg-content);">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
          <input type="text" id="vault-search" placeholder="🔍 Search vault..." style="
            flex:1;
            padding:10px 14px;
            background:var(--wrv-bg-input);
            border:1px solid var(--wrv-border-accent);
            border-radius:8px;
            color:var(--wrv-text);
            font-size:14px;
          "/>
          <button id="vault-add-btn" class="wrv-add-data-btn" style="
            padding:10px 20px;
            background:var(--wrv-btn-primary);
            border:none;
            border-radius:8px;
            color:#fff;
            font-size:13px;
            font-weight:600;
            cursor:pointer;
            transition:all 0.15s;
            white-space:nowrap;
          ">+ Add Data</button>
        </div>
        
        <div id="vault-items-list" style="flex:1;overflow-y:auto;background:var(--wrv-bg-card);border:1px solid var(--wrv-border);border-radius:10px;padding:16px;min-width:0;">
          <div style="text-align:center;padding:40px;color:var(--wrv-text-3);">
            Loading items...
          </div>
        </div>
      </div>
    </div>
  `

  // Hover effects for category buttons
  container.querySelectorAll('.vault-category-btn').forEach((btn) => {
    ;(btn as HTMLElement).addEventListener('mouseenter', function() {
      if (this.getAttribute('data-category') !== 'all') {
        this.style.background = 'rgba(var(--wrv-accent-rgb),0.08)'
      }
    })
    ;(btn as HTMLElement).addEventListener('mouseleave', function() {
      if (this.getAttribute('data-category') !== 'all') {
        this.style.background = 'var(--wrv-bg-card)'
      }
    })
  })

  // Sidebar collapse toggle
  const sidebar = container.querySelector('#vault-sidebar') as HTMLElement
  const collapseBtn = container.querySelector('#vault-sidebar-collapse') as HTMLElement
  if (sidebar && collapseBtn) {
    let sidebarCollapsed = false
    collapseBtn.addEventListener('click', () => {
      sidebarCollapsed = !sidebarCollapsed
      if (sidebarCollapsed) {
        sidebar.style.width = '0'
        sidebar.style.minWidth = '0'
        sidebar.style.padding = '0'
        sidebar.style.opacity = '0'
        sidebar.style.borderRight = 'none'
        collapseBtn.textContent = '▶'
        collapseBtn.title = 'Expand sidebar'
      } else {
        sidebar.style.width = '240px'
        sidebar.style.minWidth = '240px'
        sidebar.style.padding = '16px 14px'
        sidebar.style.opacity = '1'
        sidebar.style.borderRight = '1px solid var(--wrv-border)'
        collapseBtn.textContent = '◀'
        collapseBtn.title = 'Collapse sidebar'
      }
    })
  }

  // Load items and containers
  loadVaultItems(container, 'all')
  loadContainersIntoTree(container)
  addAddButtonsToTree(container)

  // Tree toggle functionality - clicking main category expands/collapses tree
  container.querySelectorAll('.vault-category-toggle').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const containerType = (btn as HTMLElement).getAttribute('data-container')
      const categoryType = (btn as HTMLElement).getAttribute('data-category')
      const parentType = containerType || categoryType
      const subcategories = container.querySelector(`.vault-subcategories[data-parent="${parentType}"]`) as HTMLElement
      const toggleIcon = btn.querySelector('.toggle-icon') as HTMLElement
      
      if (subcategories) {
        const isExpanded = subcategories.style.display !== 'none'
        subcategories.style.display = isExpanded ? 'none' : 'block'
        if (toggleIcon) {
          toggleIcon.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(90deg)'
        }
        
        // If expanding, refresh containers/items list
        if (!isExpanded) {
          loadContainersIntoTree(container)
          addAddButtonsToTree(container)
        }
      }
    })
  })

  // Add Password/Identity/Company/Business/Custom buttons (using event delegation for dynamically added buttons)
  container.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    const btn = target.closest('.vault-subcategory-btn[data-action]') as HTMLElement
    if (!btn) return
    
    e.stopPropagation()
    const action = btn.getAttribute('data-action')
    const category = btn.getAttribute('data-category')
    
    if (action === 'view-secrets') {
      loadVaultItems(container, 'automation_secret')
    } else if (action === 'view-passwords') {
      loadVaultItems(container, 'password')
    } else if (action === 'view-identities') {
      loadVaultItems(container, 'identity')
    } else if (action === 'view-companies') {
      loadVaultItems(container, 'company')
    } else if (action === 'view-data') {
      loadVaultItems(container, 'custom')
    } else if (action === 'view-documents') {
      loadDocumentsList(container)
    } else if (action === 'view-handshake-context') {
      loadHandshakeContextList(container)
    } else if (action === 'add-handshake-context') {
      renderHandshakeContextDialog(container)
    } else if (action === 'add-secret') {
      renderAddDataDialog(container, 'automation_secret')
    } else if (action === 'add-password') {
      renderAddDataDialog(container, 'password')
    } else if (action === 'add-identity') {
      renderAddDataDialog(container, 'identity')
    } else if (action === 'add-company') {
      renderAddDataDialog(container, 'company')
    } else if (action === 'add-custom') {
      renderAddDataDialog(container, 'custom')
    } else if (action === 'upload-document') {
      renderDocumentUploadDialog(container)
    }
  })

  // Category buttons
  container.querySelectorAll('.vault-category-btn:not(.vault-category-toggle)').forEach((btn) => {
    btn.addEventListener('click', () => {
      const category = (btn as HTMLElement).getAttribute('data-category')
      const containerId = (btn as HTMLElement).getAttribute('data-container-id')
      
      // Update selection styling
      container.querySelectorAll('.vault-category-btn').forEach((b) => {
        const isSelected = (b as HTMLElement).getAttribute('data-selected') === 'true'
        if (!isSelected) {
          ;(b as HTMLElement).style.background = 'var(--wrv-bg-card)'
          ;(b as HTMLElement).style.border = '1px solid var(--wrv-border)'
          ;(b as HTMLElement).removeAttribute('data-selected')
        }
      })
      ;(btn as HTMLElement).style.background = 'rgba(var(--wrv-accent-rgb),0.15)'
      ;(btn as HTMLElement).style.border = '1px solid rgba(var(--wrv-accent-rgb),0.3)'
      ;(btn as HTMLElement).setAttribute('data-selected', 'true')
      
      if (containerId) {
        // Load items for specific container
        loadContainerItems(container, containerId)
      } else if (category) {
        loadVaultItems(container, category)
      } else {
        loadVaultItems(container, 'all')
      }
    })
  })

  // Lock button
  container.querySelector('#vault-lock-btn')?.addEventListener('click', async () => {
    await vaultAPI.lockVault()
    renderUnlockScreen(container)
  })

  // Add data button - default to the first tier-allowed category
  container.querySelector('#vault-add-btn')?.addEventListener('click', () => {
    const allowed = getCategoryOptionsForTier(currentVaultTier)
    const defaultCat = allowed.length > 0 ? allowed[0].value : 'automation_secret'
    renderAddDataDialog(container, defaultCat as any)
  })

  // Settings button
  container.querySelector('#vault-settings-btn')?.addEventListener('click', () => {
    renderSettingsScreen(container)
  })
}

async function loadVaultItemsByContainer(container: HTMLElement, containerType: string) {
  const listDiv = container.querySelector('#vault-items-list') as HTMLElement
  if (!listDiv) return

  try {
    listDiv.innerHTML = '<div style="text-align:center;padding:40px;color:var(--wrv-text-3);">Loading...</div>'
    // Get containers first, then items for each container
    const containers = await vaultAPI.listContainers()
    const filteredContainers = containers.filter((c: Container) => c.type === containerType)
    
    if (filteredContainers.length === 0) {
      listDiv.innerHTML = `<div style="text-align:center;padding:40px;color:var(--wrv-text-3);">No ${containerType} containers found. Click "+ Add Data" to create your first ${containerType}.</div>`
      return
    }
    
    // Load items for all containers of this type
    const allItems: VaultItem[] = []
    for (const cont of filteredContainers) {
      const items = await vaultAPI.listItems({ container_id: cont.id } as any)
      allItems.push(...items)
    }
    
    if (allItems.length === 0) {
      listDiv.innerHTML = `<div style="text-align:center;padding:40px;color:var(--wrv-text-3);">No data found in ${containerType} containers. Click "+ Add Data" to create your first entry.</div>`
      return
    }
    
    await renderContainerData(listDiv, allItems)
  } catch (err: any) {
    console.error('[VAULT UI] Error loading items by container:', err)
    listDiv.innerHTML = `<div style="text-align:center;padding:40px;color:var(--wrv-danger);">Error loading items: ${err.message || err}</div>`
  }
}

// Legacy function - now uses renderContainerData for consistency
async function renderItemsList(listDiv: HTMLElement, items: any[]) {
  await renderContainerData(listDiv, items)
}

async function loadVaultItems(container: HTMLElement, category: string) {
  const listDiv = container.querySelector('#vault-items-list') as HTMLElement
  if (!listDiv) return

  // Store current category for refresh after save
  listDiv.setAttribute('data-current-category', category)

  try {
    listDiv.innerHTML = '<div style="text-align:center;padding:40px;color:var(--wrv-text-3);">Loading...</div>'
    const filters = category === 'all' ? undefined : { category: category as any }
    const items = await vaultAPI.listItems(filters)
    
    // Ensure items is an array
    if (!Array.isArray(items)) {
      console.error('[VAULT UI] listItems did not return an array:', items)
      listDiv.innerHTML = '<div style="text-align:center;padding:40px;color:var(--wrv-danger);">Error: Invalid response from server</div>'
      return
    }
    
    if (items.length === 0) {
      listDiv.innerHTML = '<div style="text-align:center;padding:40px;color:var(--wrv-text-3);">No items found. Click "+ Add Data" to create your first entry.</div>'
      return
    }

    // Use professional rendering for all items
    await renderContainerData(listDiv, items)
  } catch (err: any) {
    console.error('[VAULT] Error loading items:', err)
    listDiv.innerHTML = `<div style="text-align:center;padding:40px;color:var(--wrv-danger);">Error loading items: ${err.message || err}. Please try again.</div>`
  }
}

// Add "+ Add" buttons dynamically to tree structure
function addAddButtonsToTree(container: HTMLElement) {
  // Secrets & API Keys category
  const secretSubcategories = container.querySelector('.vault-subcategories[data-parent="automation_secret"]')
  if (secretSubcategories && !secretSubcategories.querySelector('[data-action="add-secret"]')) {
    const addSecretBtn = document.createElement('div')
    addSecretBtn.className = 'vault-subcategory-btn'
    addSecretBtn.setAttribute('data-action', 'add-secret')
    addSecretBtn.style.cssText = 'padding:7px 10px;background:rgba(var(--wrv-accent-rgb),0.08);border-radius:6px;cursor:pointer;font-size:12px;margin-top:4px;border:1px solid rgba(var(--wrv-accent-rgb),0.15);transition:all 0.15s;'
    addSecretBtn.textContent = '+ Add Secret'
    secretSubcategories.appendChild(addSecretBtn)
  }

  // Password category
  const passwordSubcategories = container.querySelector('.vault-subcategories[data-parent="password"]')
  if (passwordSubcategories && !passwordSubcategories.querySelector('[data-action="add-password"]')) {
    const addPasswordBtn = document.createElement('div')
    addPasswordBtn.className = 'vault-subcategory-btn'
    addPasswordBtn.setAttribute('data-action', 'add-password')
    addPasswordBtn.style.cssText = 'padding:7px 10px;background:rgba(var(--wrv-accent-rgb),0.08);border-radius:6px;cursor:pointer;font-size:12px;margin-top:4px;border:1px solid rgba(var(--wrv-accent-rgb),0.15);transition:all 0.15s;'
    addPasswordBtn.textContent = '+ Add Password'
    passwordSubcategories.appendChild(addPasswordBtn)
  }
  
  // Private Data category
  const personSubcategories = container.querySelector('.vault-subcategories[data-parent="person"]')
  if (personSubcategories && !personSubcategories.querySelector('[data-action="add-identity"]')) {
    const addIdentityBtn = document.createElement('div')
    addIdentityBtn.className = 'vault-subcategory-btn'
    addIdentityBtn.setAttribute('data-action', 'add-identity')
    addIdentityBtn.style.cssText = 'padding:7px 10px;background:rgba(var(--wrv-accent-rgb),0.08);border-radius:6px;cursor:pointer;font-size:12px;margin-top:4px;border:1px solid rgba(var(--wrv-accent-rgb),0.15);transition:all 0.15s;'
    addIdentityBtn.textContent = '+ Add Identity'
    personSubcategories.insertBefore(addIdentityBtn, personSubcategories.querySelector('#person-containers'))
  }
  
  // Company category
  const companySubcategories = container.querySelector('.vault-subcategories[data-parent="company"]')
  if (companySubcategories && !companySubcategories.querySelector('[data-action="add-company"]')) {
    const addCompanyBtn = document.createElement('div')
    addCompanyBtn.className = 'vault-subcategory-btn'
    addCompanyBtn.setAttribute('data-action', 'add-company')
    addCompanyBtn.style.cssText = 'padding:7px 10px;background:rgba(var(--wrv-accent-rgb),0.08);border-radius:6px;cursor:pointer;font-size:12px;margin-top:4px;border:1px solid rgba(var(--wrv-accent-rgb),0.15);transition:all 0.15s;'
    addCompanyBtn.textContent = '+ Add Company'
    companySubcategories.insertBefore(addCompanyBtn, companySubcategories.querySelector('#company-containers'))
  }
  
  // Custom category
  const customSubcategories = container.querySelector('.vault-subcategories[data-parent="custom"]')
  if (customSubcategories && !customSubcategories.querySelector('[data-action="add-custom"]')) {
    const addCustomBtn = document.createElement('div')
    addCustomBtn.className = 'vault-subcategory-btn'
    addCustomBtn.setAttribute('data-action', 'add-custom')
    addCustomBtn.style.cssText = 'padding:7px 10px;background:rgba(var(--wrv-accent-rgb),0.08);border-radius:6px;cursor:pointer;font-size:12px;margin-top:4px;border:1px solid rgba(var(--wrv-accent-rgb),0.15);transition:all 0.15s;'
    addCustomBtn.textContent = '+ Add Data'
    customSubcategories.insertBefore(addCustomBtn, customSubcategories.querySelector('#custom-containers'))
  }

  // Document Vault — "+ Upload Document" button
  const docSubcategories = container.querySelector('.vault-subcategories[data-parent="document"]')
  if (docSubcategories && !docSubcategories.querySelector('[data-action="upload-document"]')) {
    const addDocBtn = document.createElement('div')
    addDocBtn.className = 'vault-subcategory-btn'
    addDocBtn.setAttribute('data-action', 'upload-document')
    addDocBtn.style.cssText = 'padding:7px 10px;background:rgba(var(--wrv-accent-rgb),0.08);border-radius:6px;cursor:pointer;font-size:12px;margin-top:4px;border:1px solid rgba(var(--wrv-accent-rgb),0.15);transition:all 0.15s;'
    addDocBtn.textContent = '+ Upload Document'
    docSubcategories.appendChild(addDocBtn)
  }

  // Handshake Context — "+ Add Context" button
  const hcSubcategories = container.querySelector('.vault-subcategories[data-parent="handshake_context"]')
  if (hcSubcategories && !hcSubcategories.querySelector('[data-action="add-handshake-context"]')) {
    const addHcBtn = document.createElement('div')
    addHcBtn.className = 'vault-subcategory-btn'
    addHcBtn.setAttribute('data-action', 'add-handshake-context')
    addHcBtn.style.cssText = 'padding:7px 10px;background:rgba(var(--wrv-accent-rgb),0.08);border-radius:6px;cursor:pointer;font-size:12px;margin-top:4px;border:1px solid rgba(var(--wrv-accent-rgb),0.15);transition:all 0.15s;'
    addHcBtn.textContent = '+ Add Context'
    hcSubcategories.appendChild(addHcBtn)
  }
  
}

// =============================================================================
// Document Vault — List, Upload, Download
// =============================================================================

/** Format bytes into a human-readable size string. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Load and render the document list in the main content area. */
async function loadDocumentsList(parentContainer: HTMLElement) {
  const listDiv = parentContainer.querySelector('#vault-items-list') as HTMLElement
  if (!listDiv) return

  listDiv.setAttribute('data-current-category', 'document')
  listDiv.innerHTML = '<div style="text-align:center;padding:40px;color:var(--wrv-text-3);">Loading documents...</div>'

  try {
    const docs = await vaultAPI.listDocuments()

    if (!Array.isArray(docs) || docs.length === 0) {
      listDiv.innerHTML = `
        <div style="text-align:center;padding:60px 20px;color:var(--wrv-text-3);">
          <div style="font-size:48px;margin-bottom:16px;">📄</div>
          <div style="font-size:16px;margin-bottom:8px;">No documents stored</div>
          <div style="font-size:13px;margin-bottom:20px;">Upload files to securely store them in your encrypted vault.</div>
          <button id="doc-empty-upload-btn" style="
            background:rgba(var(--wrv-accent-rgb),0.15);
            border:1px solid rgba(var(--wrv-accent-rgb),0.3);
            padding:10px 24px;border-radius:8px;
            color:var(--wrv-accent);font-size:13px;font-weight:600;cursor:pointer;
          ">Upload Document</button>
        </div>`
      listDiv.querySelector('#doc-empty-upload-btn')?.addEventListener('click', () => {
        renderDocumentUploadDialog(parentContainer)
      })
      return
    }

    // Render document rows
    listDiv.innerHTML = `
      <div style="padding:4px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding:0 4px;">
          <span style="font-size:13px;color:var(--wrv-text-2);font-weight:600;">
            📄 ${docs.length} document${docs.length !== 1 ? 's' : ''}
          </span>
          <button id="doc-list-upload-btn" style="
            background:rgba(var(--wrv-accent-rgb),0.15);
            border:1px solid rgba(var(--wrv-accent-rgb),0.3);
            padding:6px 16px;border-radius:6px;
            color:var(--wrv-accent);font-size:12px;font-weight:500;cursor:pointer;
          ">+ Upload</button>
        </div>
        ${docs.map(doc => renderDocumentRow(doc)).join('')}
      </div>`

    // Attach upload button event
    listDiv.querySelector('#doc-list-upload-btn')?.addEventListener('click', () => {
      renderDocumentUploadDialog(parentContainer)
    })

    // Attach per-row events
    listDiv.querySelectorAll('.vault-doc-row').forEach(row => {
      const docId = (row as HTMLElement).getAttribute('data-doc-id')!

      row.querySelector('.vault-doc-download-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation()
        await downloadDocument(docId)
      })

      row.querySelector('.vault-doc-delete-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation()
        if (!confirm('Delete this document permanently?')) return
        try {
          await vaultAPI.deleteDocument(docId)
          loadDocumentsList(parentContainer)
        } catch (err: any) {
          alert('Failed to delete: ' + (err.message || err))
        }
      })
    })
  } catch (err: any) {
    console.error('[VAULT UI] Error loading documents:', err)
    listDiv.innerHTML = `<div style="text-align:center;padding:40px;color:var(--wrv-danger);">Error loading documents: ${err.message || err}</div>`
  }
}

/** Render a single document row (metadata only — no decryption). */
function renderDocumentRow(doc: vaultAPI.VaultDocumentMeta): string {
  const date = new Date(doc.created_at).toLocaleDateString()
  const size = formatBytes(doc.size_bytes)
  const ext = doc.filename.includes('.') ? doc.filename.split('.').pop()!.toUpperCase() : 'FILE'

  return `
    <div class="vault-doc-row" data-doc-id="${doc.id}" style="
      background:var(--wrv-bg-card);
      border:1px solid var(--wrv-border);
      border-radius:10px;
      padding:14px 18px;
      margin-bottom:10px;
      transition:all 0.15s;
      box-shadow:0 1px 4px rgba(0,0,0,0.08);
    " onmouseenter="this.style.background='rgba(var(--wrv-accent-rgb),0.06)';this.style.borderColor='var(--wrv-border-accent)'" onmouseleave="this.style.background='var(--wrv-bg-card)';this.style.borderColor='var(--wrv-border)'">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;">
        <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;">
          <div style="
            width:40px;height:40px;border-radius:8px;
            background:rgba(var(--wrv-accent-rgb),0.1);
            display:flex;align-items:center;justify-content:center;
            font-size:11px;font-weight:700;color:var(--wrv-accent);flex-shrink:0;
          ">${escapeHtml(ext)}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:14px;font-weight:600;color:var(--wrv-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(doc.filename)}">
              ${escapeHtml(doc.filename)}
            </div>
            <div style="display:flex;gap:12px;margin-top:4px;font-size:12px;color:var(--wrv-text-3);">
              <span>${size}</span>
              <span>${date}</span>
              <span title="SHA-256: ${doc.sha256}" style="cursor:help;">sha256: ${doc.sha256.slice(0, 8)}…</span>
            </div>
            ${doc.notes ? `<div style="font-size:11px;color:var(--wrv-text-2);margin-top:4px;font-style:italic;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(doc.notes)}</div>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">
          <button class="vault-doc-download-btn" title="Download" style="
            background:rgba(var(--wrv-accent-rgb),0.15);
            border:1px solid rgba(var(--wrv-accent-rgb),0.3);
            padding:7px 14px;border-radius:6px;
            color:var(--wrv-accent);font-size:12px;font-weight:500;cursor:pointer;
          ">⬇ Download</button>
          <button class="vault-doc-delete-btn" title="Delete" style="
            background:rgba(239,68,68,0.1);
            border:1px solid rgba(239,68,68,0.3);
            padding:7px 12px;border-radius:6px;
            color:#ef4444;font-size:12px;cursor:pointer;
          ">🗑</button>
        </div>
      </div>
    </div>`
}

/** Download (decrypt + save) a document — triggers browser download. */
async function downloadDocument(docId: string) {
  try {
    const result = await vaultAPI.getDocument(docId)
    const { document: doc, content } = result

    // Decode base64 → Uint8Array
    const binaryStr = atob(content)
    const bytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)

    // SECURITY: Always force download (Content-Disposition: attachment).
    // Never open inline, never dispatch to an executor.
    const blob = new Blob([bytes], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = doc.filename // Safe: just the basename, no path
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()

    // Clean up
    setTimeout(() => {
      URL.revokeObjectURL(url)
      a.remove()
    }, 1000)
  } catch (err: any) {
    alert('Download failed: ' + (err.message || err))
  }
}

/** Show the document upload dialog (file picker + notes). */
function renderDocumentUploadDialog(parentContainer: HTMLElement) {
  const savedContent = parentContainer.innerHTML

  const dialog = document.createElement('div')
  dialog.id = 'vault-doc-upload-overlay'
  dialog.setAttribute('data-wrv-no-autofill', '')
  dialog.style.cssText = `
    height:100%;
    overflow-y:auto;
    padding:28px 32px;
    color:var(--wrv-text, #ededf0);
  `

  dialog.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <button id="doc-upload-back" style="
          background:var(--wrv-bg-card);
          border:1px solid var(--wrv-border);
          padding:6px 14px;
          border-radius:8px;
          color:var(--wrv-text-2);
          font-size:13px;
          font-weight:600;
          cursor:pointer;
          display:flex;
          align-items:center;
          gap:6px;
          transition:all 0.15s;
        " onmouseenter="this.style.background='var(--wrv-bg-input)';this.style.color='var(--wrv-text)'" onmouseleave="this.style.background='var(--wrv-bg-card)';this.style.color='var(--wrv-text-2)'">← Back</button>
        <h3 style="margin:0;font-size:18px;font-weight:700;color:var(--wrv-text);">📄 Upload Document</h3>
      </div>
      <button id="doc-upload-close" style="background:none;border:none;color:var(--wrv-text-3);font-size:22px;cursor:pointer;padding:4px 8px;">✕</button>
    </div>

    <div id="doc-drop-zone" style="
      border:2px dashed var(--wrv-border-accent, rgba(139,92,246,0.25));
      border-radius:12px;
      padding:40px 20px;
      text-align:center;
      cursor:pointer;
      transition:all 0.15s;
      margin-bottom:16px;
    ">
      <div style="font-size:36px;margin-bottom:12px;">📁</div>
      <div style="font-size:14px;color:var(--wrv-text);margin-bottom:4px;font-weight:600;">Click to select a file</div>
      <div style="font-size:12px;color:var(--wrv-text-3);">or drag & drop (max 50 MB)</div>
      <div style="font-size:11px;color:var(--wrv-text-3);margin-top:8px;">Executable files (.exe, .bat, .sh, .js, etc.) are blocked.</div>
      <input type="file" id="doc-file-input" style="display:none;" />
    </div>

    <div id="doc-file-info" style="display:none;margin-bottom:16px;padding:12px;background:var(--wrv-bg-card);border:1px solid var(--wrv-border);border-radius:8px;">
      <div id="doc-file-name" style="font-size:14px;font-weight:600;color:var(--wrv-text);"></div>
      <div id="doc-file-size" style="font-size:12px;color:var(--wrv-text-3);margin-top:4px;"></div>
    </div>

    <div style="margin-bottom:16px;">
      <label style="font-size:12px;color:var(--wrv-text-2);font-weight:600;display:block;margin-bottom:6px;">Notes (optional)</label>
      <textarea id="doc-notes-input" rows="2" style="
        width:100%;box-sizing:border-box;
        background:var(--wrv-bg-input, rgba(0,0,0,0.25));
        border:1px solid var(--wrv-border);
        border-radius:8px;
        padding:10px 12px;
        color:var(--wrv-text);
        font-size:13px;
        resize:vertical;
        outline:none;
      " placeholder="Tags, description, or notes about this file..."></textarea>
    </div>

    <div style="display:flex;gap:10px;justify-content:flex-end;">
      <button id="doc-upload-cancel" style="
        background:var(--wrv-bg-card);
        border:1px solid var(--wrv-border);
        padding:10px 20px;border-radius:8px;
        color:var(--wrv-text-2);font-size:13px;cursor:pointer;
      ">Cancel</button>
      <button id="doc-upload-submit" disabled style="
        background:var(--wrv-accent, #8b5cf6);
        border:none;
        padding:10px 24px;border-radius:8px;
        color:var(--wrv-text);font-size:13px;font-weight:600;cursor:pointer;
        opacity:0.5;
      ">Upload & Encrypt</button>
    </div>

    <div id="doc-upload-status" style="display:none;margin-top:12px;padding:10px;border-radius:8px;font-size:13px;text-align:center;"></div>
  `

  parentContainer.innerHTML = ''
  parentContainer.appendChild(dialog)

  // Close handlers — restore vault dashboard
  const close = () => {
    parentContainer.innerHTML = savedContent
    restoreDashboardAfterDialogClose(parentContainer)
  }
  dialog.querySelector('#doc-upload-back')?.addEventListener('click', close)
  dialog.querySelector('#doc-upload-close')?.addEventListener('click', close)
  dialog.querySelector('#doc-upload-cancel')?.addEventListener('click', close)

  // File state
  let selectedFile: File | null = null
  let selectedBase64: string | null = null

  const fileInput = dialog.querySelector('#doc-file-input') as HTMLInputElement
  const dropZone = dialog.querySelector('#doc-drop-zone') as HTMLElement
  const fileInfo = dialog.querySelector('#doc-file-info') as HTMLElement
  const fileNameEl = dialog.querySelector('#doc-file-name') as HTMLElement
  const fileSizeEl = dialog.querySelector('#doc-file-size') as HTMLElement
  const submitBtn = dialog.querySelector('#doc-upload-submit') as HTMLButtonElement
  const statusDiv = dialog.querySelector('#doc-upload-status') as HTMLElement

  const handleFile = (file: File) => {
    selectedFile = file
    fileNameEl.textContent = file.name
    fileSizeEl.textContent = formatBytes(file.size)
    fileInfo.style.display = 'block'
    submitBtn.disabled = false
    submitBtn.style.opacity = '1'

    // Read as base64
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Remove data URL prefix (e.g., "data:application/pdf;base64,")
      selectedBase64 = result.includes(',') ? result.split(',')[1] : result
    }
    reader.readAsDataURL(file)
  }

  // Click to open file picker
  dropZone.addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', () => {
    if (fileInput.files?.[0]) handleFile(fileInput.files[0])
  })

  // Drag & drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault()
    dropZone.style.borderColor = 'var(--wrv-accent)'
    dropZone.style.background = 'rgba(var(--wrv-accent-rgb),0.05)'
  })
  dropZone.addEventListener('dragleave', () => {
    dropZone.style.borderColor = 'var(--wrv-border-accent)'
    dropZone.style.background = 'transparent'
  })
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault()
    dropZone.style.borderColor = 'var(--wrv-border-accent)'
    dropZone.style.background = 'transparent'
    if (e.dataTransfer?.files?.[0]) handleFile(e.dataTransfer.files[0])
  })

  // Submit handler
  submitBtn.addEventListener('click', async () => {
    if (!selectedFile || !selectedBase64) return

    submitBtn.disabled = true
    submitBtn.textContent = 'Encrypting...'
    statusDiv.style.display = 'block'
    statusDiv.style.background = 'rgba(var(--wrv-accent-rgb),0.08)'
    statusDiv.style.color = 'var(--wrv-accent)'
    statusDiv.textContent = 'Encrypting and storing document...'

    try {
      const notes = (dialog.querySelector('#doc-notes-input') as HTMLTextAreaElement).value.trim()
      const result = await vaultAPI.uploadDocument(selectedFile.name, selectedBase64, notes)

      statusDiv.style.background = 'rgba(34,197,94,0.1)'
      statusDiv.style.color = '#22c55e'
      statusDiv.textContent = result.deduplicated
        ? '✅ Document already exists (deduplicated).'
        : `✅ Document encrypted and stored (${formatBytes(selectedFile.size)}).`

      setTimeout(() => {
        close()
        loadDocumentsList(parentContainer)
      }, 1200)
    } catch (err: any) {
      statusDiv.style.background = 'rgba(239,68,68,0.1)'
      statusDiv.style.color = '#ef4444'
      statusDiv.textContent = '❌ ' + (err.message || 'Upload failed')
      submitBtn.disabled = false
      submitBtn.textContent = 'Upload & Encrypt'
    }
  })

}

// =============================================================================
// Handshake Context — List, Create/Edit, Attach Evaluation
// =============================================================================

/**
 * Load and render the list of handshake_context items.
 */
async function loadHandshakeContextList(parentContainer: HTMLElement) {
  const listDiv = parentContainer.querySelector('#vault-items-list') as HTMLElement
  if (!listDiv) return

  listDiv.innerHTML = '<div style="text-align:center;padding:30px;color:var(--wrv-text-3);">Loading context items...</div>'

  try {
    const items = await vaultAPI.listItems({ category: 'handshake_context' as any })
    if (!items || items.length === 0) {
      listDiv.innerHTML = `
        <div style="text-align:center;padding:40px;color:var(--wrv-text-3);">
          <div style="font-size:36px;margin-bottom:12px;">🤝</div>
          <div style="font-size:14px;margin-bottom:6px;">No handshake context items yet.</div>
          <div style="font-size:12px;color:var(--wrv-text-3);margin-bottom:16px;">Store data to attach to handshakes — personalized offers, user manuals, support profiles.</div>
          <button id="hc-empty-add-btn" style="padding:8px 20px;background:var(--wrv-btn-primary);border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:13px;">+ Add Context Item</button>
        </div>`
      listDiv.querySelector('#hc-empty-add-btn')?.addEventListener('click', () => {
        renderHandshakeContextDialog(parentContainer)
      })
      return
    }

    // Load meta for each item to show binding policy status
    const metaMap: Record<string, any> = {}
    for (const item of items) {
      try {
        const meta = await vaultAPI.getItemMeta(item.id)
        metaMap[item.id] = meta
      } catch { /* ignore */ }
    }

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <h3 style="margin:0;font-size:15px;color:var(--wrv-text);">🤝 HS Context Items (${items.length})</h3>
        <button id="hc-list-add-btn" style="padding:6px 16px;background:var(--wrv-btn-primary);border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:12px;">+ Add Context</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">`

    for (const item of items) {
      const meta = metaMap[item.id]
      const policy = meta?.binding_policy || DEFAULT_BINDING_POLICY
      const safeToShare = policy.safe_to_share
      const domainCount = policy.allowed_domains?.length || 0
      const typeCount = policy.handshake_types?.length || 0
      const expired = policy.valid_until !== null && Date.now() > policy.valid_until

      // Status badges
      let statusBadges = ''
      if (safeToShare) {
        statusBadges += '<span style="font-size:10px;background:rgba(34,197,94,0.12);color:#22c55e;padding:2px 6px;border-radius:4px;margin-right:4px;">shareable</span>'
      } else {
        statusBadges += '<span style="font-size:10px;background:rgba(239,68,68,0.12);color:#ef4444;padding:2px 6px;border-radius:4px;margin-right:4px;">not shareable</span>'
      }
      if (expired) {
        statusBadges += '<span style="font-size:10px;background:rgba(239,68,68,0.12);color:#ef4444;padding:2px 6px;border-radius:4px;margin-right:4px;">expired</span>'
      }
      if (domainCount > 0) {
        statusBadges += `<span style="font-size:10px;background:rgba(var(--wrv-accent-rgb),0.12);color:var(--wrv-accent);padding:2px 6px;border-radius:4px;margin-right:4px;">${domainCount} domain${domainCount > 1 ? 's' : ''}</span>`
      }
      if (typeCount > 0) {
        statusBadges += `<span style="font-size:10px;background:rgba(var(--wrv-accent-rgb),0.12);color:var(--wrv-accent);padding:2px 6px;border-radius:4px;margin-right:4px;">${typeCount} type${typeCount > 1 ? 's' : ''}</span>`
      }
      if (policy.step_up_required) {
        statusBadges += '<span style="font-size:10px;background:rgba(250,204,21,0.12);color:#facc15;padding:2px 6px;border-radius:4px;margin-right:4px;">step-up</span>'
      }

      // Extract summary field for display
      const summaryField = item.fields.find(f => f.key === 'summary')
      const summaryText = summaryField?.value || ''

      html += `
        <div class="hc-item-row" data-item-id="${item.id}" style="
          background:var(--wrv-bg-card);
          border:1px solid var(--wrv-border);
          border-radius:10px;
          padding:14px 18px;
          transition:all 0.15s;
          cursor:pointer;
        " onmouseenter="this.style.background='rgba(var(--wrv-accent-rgb),0.06)';this.style.borderColor='var(--wrv-border-accent)'" onmouseleave="this.style.background='var(--wrv-bg-card)';this.style.borderColor='var(--wrv-border)'">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:14px;font-weight:600;color:var(--wrv-text);margin-bottom:4px;">🤝 ${escapeHtml(item.title)}</div>
              ${summaryText ? `<div style="font-size:12px;color:var(--wrv-text-2);margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(summaryText)}</div>` : ''}
              <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;">${statusBadges}</div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0;">
              <button class="hc-eval-btn" data-item-id="${item.id}" title="Test attachment eligibility" style="padding:5px 10px;background:rgba(var(--wrv-accent-rgb),0.1);border:1px solid rgba(var(--wrv-accent-rgb),0.2);border-radius:6px;color:var(--wrv-accent);cursor:pointer;font-size:11px;">🔍 Test</button>
              <button class="hc-edit-btn" data-item-id="${item.id}" title="Edit binding policy" style="padding:5px 10px;background:rgba(var(--wrv-accent-rgb),0.1);border:1px solid rgba(var(--wrv-accent-rgb),0.2);border-radius:6px;color:var(--wrv-accent);cursor:pointer;font-size:11px;">✏️ Edit</button>
              <button class="hc-delete-btn" data-item-id="${item.id}" title="Delete" style="padding:5px 10px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:6px;color:#ef4444;cursor:pointer;font-size:11px;">🗑️</button>
            </div>
          </div>
        </div>`
    }

    html += '</div>'
    listDiv.innerHTML = html

    // Event handlers
    listDiv.querySelector('#hc-list-add-btn')?.addEventListener('click', () => {
      renderHandshakeContextDialog(parentContainer)
    })

    listDiv.querySelectorAll('.hc-eval-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const itemId = (btn as HTMLElement).getAttribute('data-item-id')!
        renderAttachEvalDialog(parentContainer, itemId)
      })
    })

    listDiv.querySelectorAll('.hc-edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const itemId = (btn as HTMLElement).getAttribute('data-item-id')!
        renderHandshakeContextDialog(parentContainer, itemId)
      })
    })

    listDiv.querySelectorAll('.hc-delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const itemId = (btn as HTMLElement).getAttribute('data-item-id')!
        if (!confirm('Delete this handshake context item?')) return
        try {
          await vaultAPI.deleteItem(itemId)
          loadHandshakeContextList(parentContainer)
        } catch (err: any) {
          alert('Delete failed: ' + (err.message || 'Unknown error'))
        }
      })
    })

    // Click row to view detail (same as edit for now)
    listDiv.querySelectorAll('.hc-item-row').forEach(row => {
      row.addEventListener('click', () => {
        const itemId = (row as HTMLElement).getAttribute('data-item-id')!
        renderHandshakeContextDialog(parentContainer, itemId)
      })
    })

  } catch (err: any) {
    listDiv.innerHTML = `<div style="text-align:center;padding:30px;color:#ef4444;">❌ Failed to load context items: ${escapeHtml(err.message || 'Unknown error')}</div>`
  }
}

/**
 * Render create/edit dialog for a handshake context item.
 * Includes standard fields AND binding policy fields.
 */
async function renderHandshakeContextDialog(parentContainer: HTMLElement, editItemId?: string) {
  // Load existing data for edit mode
  let existingItem: VaultItem | null = null
  let existingPolicy: HandshakeBindingPolicy = { ...DEFAULT_BINDING_POLICY }

  if (editItemId) {
    try {
      existingItem = await vaultAPI.getItem(editItemId)
      const meta = await vaultAPI.getItemMeta(editItemId)
      if (meta?.binding_policy) {
        existingPolicy = meta.binding_policy
      }
    } catch (err: any) {
      alert('Failed to load item: ' + (err.message || 'Unknown error'))
      return
    }
  }

  const isEdit = !!existingItem
  const dialogTitle = isEdit ? 'Edit HS Context' : 'New HS Context'

  // Render inline in the vault content area
  const savedContent = parentContainer.innerHTML

  const dialog = document.createElement('div')
  dialog.setAttribute('data-wrv-no-autofill', '')
  dialog.style.cssText = `
    height:100%;
    overflow-y:auto;
    padding:24px;
    color:var(--wrv-text);
  `

  // Build field values from existing item
  const getField = (key: string) => existingItem?.fields.find(f => f.key === key)?.value || ''

  dialog.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <button id="hc-dialog-back" style="
          background:var(--wrv-bg-card);
          border:1px solid var(--wrv-border);
          padding:6px 14px;
          border-radius:8px;
          color:var(--wrv-text-2);
          font-size:13px;
          font-weight:600;
          cursor:pointer;
          display:flex;
          align-items:center;
          gap:6px;
          transition:all 0.15s;
        " onmouseenter="this.style.background='var(--wrv-bg-input)';this.style.color='var(--wrv-text)'" onmouseleave="this.style.background='var(--wrv-bg-card)';this.style.color='var(--wrv-text-2)'">← Back</button>
        <h2 style="margin:0;font-size:18px;color:var(--wrv-text);">🤝 ${dialogTitle}</h2>
      </div>
      <button id="hc-dialog-close" style="background:none;border:none;color:var(--wrv-text-3);font-size:20px;cursor:pointer;padding:4px 8px;">&times;</button>
    </div>

    <!-- Title -->
    <div style="margin-bottom:14px;">
      <label style="display:block;font-size:12px;color:var(--wrv-text-2);margin-bottom:4px;font-weight:600;">Title *</label>
      <input id="hc-title" type="text" value="${escapeHtml(existingItem?.title || '')}" placeholder="e.g., Premium Support Profile" style="width:100%;padding:10px 12px;background:var(--wrv-bg-input);border:1px solid var(--wrv-border);border-radius:8px;color:var(--wrv-text);font-size:14px;box-sizing:border-box;" />
    </div>

    <!-- Standard fields -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px;">
      <div>
        <label style="display:block;font-size:12px;color:var(--wrv-text-2);margin-bottom:4px;font-weight:600;">Context Type *</label>
        <input id="hc-context-type" type="text" value="${escapeHtml(getField('context_type'))}" placeholder="e.g., Personalized Offer" style="width:100%;padding:10px 12px;background:var(--wrv-bg-input);border:1px solid var(--wrv-border);border-radius:8px;color:var(--wrv-text);font-size:13px;box-sizing:border-box;" />
      </div>
      <div>
        <label style="display:block;font-size:12px;color:var(--wrv-text-2);margin-bottom:4px;font-weight:600;">Summary *</label>
        <input id="hc-summary" type="text" value="${escapeHtml(getField('summary'))}" placeholder="Short description" style="width:100%;padding:10px 12px;background:var(--wrv-bg-input);border:1px solid var(--wrv-border);border-radius:8px;color:var(--wrv-text);font-size:13px;box-sizing:border-box;" />
      </div>
    </div>

    <div style="margin-bottom:14px;">
      <label style="display:block;font-size:12px;color:var(--wrv-text-2);margin-bottom:4px;font-weight:600;">Context Payload *</label>
      <textarea id="hc-payload" rows="4" placeholder="The data to attach to a handshake (JSON, text, offer details, etc.)" style="width:100%;padding:10px 12px;background:var(--wrv-bg-input);border:1px solid var(--wrv-border);border-radius:8px;color:var(--wrv-text);font-size:13px;resize:vertical;box-sizing:border-box;">${escapeHtml(getField('payload'))}</textarea>
    </div>

    <div style="margin-bottom:18px;">
      <label style="display:block;font-size:12px;color:var(--wrv-text-2);margin-bottom:4px;font-weight:600;">Internal Notes</label>
      <textarea id="hc-notes" rows="2" placeholder="Notes (not shared in handshake)" style="width:100%;padding:10px 12px;background:var(--wrv-bg-input);border:1px solid var(--wrv-border);border-radius:8px;color:var(--wrv-text);font-size:13px;resize:vertical;box-sizing:border-box;">${escapeHtml(getField('notes'))}</textarea>
    </div>

    <!-- Binding Policy Section -->
    <div style="border-top:1px solid var(--wrv-border);padding-top:16px;margin-bottom:18px;">
      <h3 style="margin:0 0 12px 0;font-size:14px;color:var(--wrv-text);">🔗 Binding Policy</h3>
      <p style="font-size:11px;color:var(--wrv-text-3);margin:0 0 14px 0;">Controls when and where this context can be attached to a handshake.</p>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
        <div>
          <label style="display:block;font-size:12px;color:var(--wrv-text-2);margin-bottom:4px;font-weight:600;">Allowed Domains</label>
          <input id="hc-allowed-domains" type="text" value="${escapeHtml(existingPolicy.allowed_domains.join(', '))}" placeholder="*.example.com, partner.org (empty = any)" style="width:100%;padding:10px 12px;background:var(--wrv-bg-input);border:1px solid var(--wrv-border);border-radius:8px;color:var(--wrv-text);font-size:13px;box-sizing:border-box;" />
          <div style="font-size:10px;color:var(--wrv-text-3);margin-top:2px;">Comma-separated, supports *.glob patterns</div>
        </div>
        <div>
          <label style="display:block;font-size:12px;color:var(--wrv-text-2);margin-bottom:4px;font-weight:600;">Handshake Types</label>
          <input id="hc-handshake-types" type="text" value="${escapeHtml(existingPolicy.handshake_types.join(', '))}" placeholder="support, sales, onboarding (empty = any)" style="width:100%;padding:10px 12px;background:var(--wrv-bg-input);border:1px solid var(--wrv-border);border-radius:8px;color:var(--wrv-text);font-size:13px;box-sizing:border-box;" />
          <div style="font-size:10px;color:var(--wrv-text-3);margin-top:2px;">Comma-separated type tags</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">
        <div>
          <label style="display:block;font-size:12px;color:var(--wrv-text-2);margin-bottom:4px;font-weight:600;">Valid Until</label>
          <input id="hc-valid-until" type="datetime-local" value="${existingPolicy.valid_until ? new Date(existingPolicy.valid_until).toISOString().slice(0, 16) : ''}" style="width:100%;padding:10px 12px;background:var(--wrv-bg-input);border:1px solid var(--wrv-border);border-radius:8px;color:var(--wrv-text);font-size:13px;box-sizing:border-box;" />
          <div style="font-size:10px;color:var(--wrv-text-3);margin-top:2px;">Leave empty for no expiry</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;padding-top:20px;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--wrv-text);">
            <input id="hc-safe-to-share" type="checkbox" ${existingPolicy.safe_to_share ? 'checked' : ''} style="width:16px;height:16px;" />
            Safe to Share
          </label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--wrv-text);">
            <input id="hc-step-up-required" type="checkbox" ${existingPolicy.step_up_required ? 'checked' : ''} style="width:16px;height:16px;" />
            Require Re-authentication
          </label>
        </div>
      </div>

      ${!existingPolicy.safe_to_share ? `
      <div style="background:rgba(250,204,21,0.08);border:1px solid rgba(250,204,21,0.2);border-radius:8px;padding:10px 14px;font-size:12px;color:#facc15;">
        ⚠️ This context item cannot be attached to handshakes until "Safe to Share" is enabled.
      </div>` : ''}
    </div>

    <!-- Actions -->
    <div style="display:flex;justify-content:flex-end;gap:10px;">
      <button id="hc-dialog-cancel" style="padding:10px 20px;background:var(--wrv-bg-card);border:1px solid var(--wrv-border);border-radius:8px;color:var(--wrv-text-2);cursor:pointer;font-size:13px;">Cancel</button>
      <button id="hc-dialog-save" style="padding:10px 24px;background:var(--wrv-btn-primary);border:none;border-radius:8px;color:#fff;cursor:pointer;font-size:13px;font-weight:600;">${isEdit ? 'Save Changes' : 'Create Context Item'}</button>
    </div>

    <div id="hc-dialog-status" style="display:none;margin-top:12px;padding:10px;border-radius:8px;font-size:12px;text-align:center;"></div>
  `

  parentContainer.innerHTML = ''
  parentContainer.appendChild(dialog)

  const close = () => {
    parentContainer.innerHTML = savedContent
    restoreDashboardAfterDialogClose(parentContainer)
  }
  dialog.querySelector('#hc-dialog-back')?.addEventListener('click', close)
  dialog.querySelector('#hc-dialog-close')?.addEventListener('click', close)
  dialog.querySelector('#hc-dialog-cancel')?.addEventListener('click', close)

  // Save handler
  dialog.querySelector('#hc-dialog-save')?.addEventListener('click', async () => {
    const saveBtn = dialog.querySelector('#hc-dialog-save') as HTMLButtonElement
    const statusDiv = dialog.querySelector('#hc-dialog-status') as HTMLElement
    const title = (dialog.querySelector('#hc-title') as HTMLInputElement).value.trim()
    const contextType = (dialog.querySelector('#hc-context-type') as HTMLInputElement).value.trim()
    const summary = (dialog.querySelector('#hc-summary') as HTMLInputElement).value.trim()
    const payload = (dialog.querySelector('#hc-payload') as HTMLTextAreaElement).value.trim()
    const notes = (dialog.querySelector('#hc-notes') as HTMLTextAreaElement).value.trim()

    // Validation
    if (!title || !contextType || !summary || !payload) {
      statusDiv.style.display = 'block'
      statusDiv.style.background = 'rgba(239,68,68,0.1)'
      statusDiv.style.color = '#ef4444'
      statusDiv.textContent = 'Please fill in all required fields (Title, Context Type, Summary, Payload).'
      return
    }

    saveBtn.disabled = true
    saveBtn.textContent = 'Saving...'

    // Parse binding policy from form
    const allowedDomainsRaw = (dialog.querySelector('#hc-allowed-domains') as HTMLInputElement).value
    const handshakeTypesRaw = (dialog.querySelector('#hc-handshake-types') as HTMLInputElement).value
    const validUntilRaw = (dialog.querySelector('#hc-valid-until') as HTMLInputElement).value
    const safeToShare = (dialog.querySelector('#hc-safe-to-share') as HTMLInputElement).checked
    const stepUpRequired = (dialog.querySelector('#hc-step-up-required') as HTMLInputElement).checked

    const bindingPolicy: HandshakeBindingPolicy = {
      allowed_domains: allowedDomainsRaw.split(',').map(s => s.trim()).filter(Boolean),
      handshake_types: handshakeTypesRaw.split(',').map(s => s.trim()).filter(Boolean),
      valid_until: validUntilRaw ? new Date(validUntilRaw).getTime() : null,
      safe_to_share: safeToShare,
      step_up_required: stepUpRequired,
    }

    const fields = [
      { key: 'context_type', value: contextType, encrypted: false, type: 'text' as const },
      { key: 'summary', value: summary, encrypted: false, type: 'text' as const },
      { key: 'payload', value: payload, encrypted: true, type: 'textarea' as const },
      { key: 'notes', value: notes, encrypted: false, type: 'textarea' as const },
    ]

    try {
      if (isEdit && editItemId) {
        // Update existing item
        await vaultAPI.updateItem(editItemId, { title, fields })
        // Update binding policy in meta
        await vaultAPI.setItemMeta(editItemId, { binding_policy: bindingPolicy })
      } else {
        // Create new item
        const newItem = await vaultAPI.createItem({
          category: 'handshake_context' as any,
          title,
          fields,
          favorite: false,
        })
        // Set binding policy in meta
        await vaultAPI.setItemMeta(newItem.id, { binding_policy: bindingPolicy })
      }

      statusDiv.style.display = 'block'
      statusDiv.style.background = 'rgba(34,197,94,0.1)'
      statusDiv.style.color = '#22c55e'
      statusDiv.textContent = isEdit ? '✅ Context item updated.' : '✅ Context item created.'

      setTimeout(() => {
        close()
        loadHandshakeContextList(parentContainer)
      }, 800)
    } catch (err: any) {
      statusDiv.style.display = 'block'
      statusDiv.style.background = 'rgba(239,68,68,0.1)'
      statusDiv.style.color = '#ef4444'
      statusDiv.textContent = '❌ ' + (err.message || 'Save failed')
      saveBtn.disabled = false
      saveBtn.textContent = isEdit ? 'Save Changes' : 'Create Context Item'
    }
  })

}

/**
 * Render the "Test Attachment" dialog — evaluates canAttachContext
 * and shows "why allowed/blocked" in a transparent way.
 */
function renderAttachEvalDialog(parentContainer: HTMLElement, itemId: string) {
  const savedContent = parentContainer.innerHTML

  const dialog = document.createElement('div')
  dialog.setAttribute('data-wrv-no-autofill', '')
  dialog.style.cssText = `
    height:100%;
    overflow-y:auto;
    padding:24px;
    color:var(--wrv-text);
  `

  dialog.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <button id="eval-back" style="
          background:var(--wrv-bg-card);
          border:1px solid var(--wrv-border);
          padding:6px 14px;
          border-radius:8px;
          color:var(--wrv-text-2);
          font-size:13px;
          font-weight:600;
          cursor:pointer;
          display:flex;
          align-items:center;
          gap:6px;
          transition:all 0.15s;
        " onmouseenter="this.style.background='var(--wrv-bg-input)';this.style.color='var(--wrv-text)'" onmouseleave="this.style.background='var(--wrv-bg-card)';this.style.color='var(--wrv-text-2)'">← Back</button>
        <h2 style="margin:0;font-size:16px;color:var(--wrv-text);">🔍 Test Attachment Eligibility</h2>
      </div>
      <button id="eval-close" style="background:none;border:none;color:var(--wrv-text-3);font-size:20px;cursor:pointer;padding:4px 8px;">&times;</button>
    </div>

    <p style="font-size:12px;color:var(--wrv-text-3);margin:0 0 14px 0;">Simulate a handshake to check if this context item can be attached. The evaluator checks tier, sharing flag, domain binding, type, TTL, and step-up requirements.</p>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">
      <div>
        <label style="display:block;font-size:12px;color:var(--wrv-text-2);margin-bottom:4px;font-weight:600;">Target Domain *</label>
        <input id="eval-domain" type="text" placeholder="e.g., partner.example.com" style="width:100%;padding:10px 12px;background:var(--wrv-bg-input);border:1px solid var(--wrv-border);border-radius:8px;color:var(--wrv-text);font-size:13px;box-sizing:border-box;" />
      </div>
      <div>
        <label style="display:block;font-size:12px;color:var(--wrv-text-2);margin-bottom:4px;font-weight:600;">Handshake Type</label>
        <input id="eval-type" type="text" placeholder="e.g., sales" style="width:100%;padding:10px 12px;background:var(--wrv-bg-input);border:1px solid var(--wrv-border);border-radius:8px;color:var(--wrv-text);font-size:13px;box-sizing:border-box;" />
      </div>
    </div>

    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--wrv-text);margin-bottom:16px;">
      <input id="eval-step-up" type="checkbox" style="width:16px;height:16px;" />
      Step-up authentication completed
    </label>

    <button id="eval-run-btn" style="width:100%;padding:10px;background:var(--wrv-btn-primary);border:none;border-radius:8px;color:#fff;cursor:pointer;font-size:13px;font-weight:600;">Evaluate</button>

    <div id="eval-result" style="display:none;margin-top:16px;"></div>
  `

  parentContainer.innerHTML = ''
  parentContainer.appendChild(dialog)

  const close = () => {
    parentContainer.innerHTML = savedContent
    restoreDashboardAfterDialogClose(parentContainer)
  }
  dialog.querySelector('#eval-back')?.addEventListener('click', close)
  dialog.querySelector('#eval-close')?.addEventListener('click', close)

  dialog.querySelector('#eval-run-btn')?.addEventListener('click', async () => {
    const resultDiv = dialog.querySelector('#eval-result') as HTMLElement
    const domain = (dialog.querySelector('#eval-domain') as HTMLInputElement).value.trim()
    const type = (dialog.querySelector('#eval-type') as HTMLInputElement).value.trim()
    const stepUpDone = (dialog.querySelector('#eval-step-up') as HTMLInputElement).checked

    if (!domain) {
      resultDiv.style.display = 'block'
      resultDiv.innerHTML = '<div style="padding:10px;background:rgba(239,68,68,0.1);border-radius:8px;color:#ef4444;font-size:13px;">Please enter a target domain.</div>'
      return
    }

    const target: HandshakeTarget = { domain, step_up_done: stepUpDone }
    if (type) target.type = type

    resultDiv.style.display = 'block'
    resultDiv.innerHTML = '<div style="padding:10px;background:rgba(var(--wrv-accent-rgb),0.08);border-radius:8px;color:var(--wrv-accent);font-size:13px;">Evaluating...</div>'

    try {
      const evalResult: AttachEvalResult = await vaultAPI.evaluateHandshakeAttach(itemId, target)

      if (evalResult.allowed) {
        resultDiv.innerHTML = `
          <div style="padding:14px;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:10px;">
            <div style="font-size:14px;font-weight:600;color:#22c55e;margin-bottom:8px;">✅ Attachment ALLOWED</div>
            <div style="font-size:12px;color:var(--wrv-text-2);">All checks passed. This context item can be attached to a handshake with domain "${escapeHtml(domain)}"${type ? ` and type "${escapeHtml(type)}"` : ''}.</div>
          </div>

          <div style="margin-top:12px;padding:12px;background:var(--wrv-bg-card);border:1px solid var(--wrv-border);border-radius:8px;font-size:12px;color:var(--wrv-text-2);">
            <div style="font-weight:600;margin-bottom:6px;">Checks performed:</div>
            <div style="display:flex;flex-direction:column;gap:4px;">
              <div>✅ Tier capability (Publisher+)</div>
              <div>✅ safe_to_share = true</div>
              <div>✅ Domain binding${domain ? ` → "${escapeHtml(domain)}"` : ''}</div>
              ${type ? `<div>✅ Handshake type → "${escapeHtml(type)}"</div>` : '<div>✅ Handshake type (not specified)</div>'}
              <div>✅ TTL / expiration</div>
              <div>✅ Step-up${stepUpDone ? ' (completed)' : ' (not required)'}</div>
            </div>
          </div>`
      } else {
        const reasonLabels: Record<string, string> = {
          tier_insufficient: '❌ Tier: insufficient privileges',
          not_safe_to_share: '❌ Item not marked as "Safe to Share"',
          domain_mismatch: '❌ Domain not in allowed list',
          type_mismatch: '❌ Handshake type not in allowed list',
          expired: '❌ Context item has expired',
          step_up_required: '❌ Re-authentication required',
        }

        resultDiv.innerHTML = `
          <div style="padding:14px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:10px;">
            <div style="font-size:14px;font-weight:600;color:#ef4444;margin-bottom:8px;">🚫 Attachment BLOCKED</div>
            <div style="font-size:13px;font-weight:600;color:#ef4444;margin-bottom:4px;">${reasonLabels[evalResult.reason || ''] || evalResult.reason}</div>
            <div style="font-size:12px;color:var(--wrv-text-2);">${escapeHtml(evalResult.message || '')}</div>
          </div>`
      }
    } catch (err: any) {
      resultDiv.innerHTML = `<div style="padding:10px;background:rgba(239,68,68,0.1);border-radius:8px;color:#ef4444;font-size:13px;">❌ Evaluation failed: ${escapeHtml(err.message || 'Unknown error')}</div>`
    }
  })

}

// Load containers into tree structure
async function loadContainersIntoTree(container: HTMLElement) {
  try {
    const containers = await vaultAPI.listContainers()
    
    // Ensure containers is an array
    if (!Array.isArray(containers)) {
      console.error('[VAULT UI] listContainers did not return an array:', containers)
      return
    }
    
    // Don't render individual containers/items in navigation tree to avoid performance issues
    // Users can use "View" buttons to see all entries in the main content area
    const personDiv = container.querySelector('#person-containers') as HTMLElement
    if (personDiv) {
      personDiv.innerHTML = ''
    }
    
    const companyDiv = container.querySelector('#company-containers') as HTMLElement
    if (companyDiv) {
      companyDiv.innerHTML = ''
    }
    
    const customDiv = container.querySelector('#custom-containers') as HTMLElement
    if (customDiv) {
      customDiv.innerHTML = ''
    }
  } catch (err) {
    console.error('[VAULT UI] Error loading containers:', err)
  }
}

// Load items for a specific container
async function loadContainerItems(container: HTMLElement, containerId: string) {
  const listDiv = container.querySelector('#vault-items-list') as HTMLElement
  if (!listDiv) return
  
  try {
    listDiv.innerHTML = '<div style="text-align:center;padding:40px;color:var(--wrv-text-3);">Loading...</div>'
    const items = await vaultAPI.listItems({ container_id: containerId } as any)
    
    if (items.length === 0) {
      listDiv.innerHTML = '<div style="text-align:center;padding:40px;color:var(--wrv-text-3);">No data found in this container. Add fields using the form below.</div>'
      return
    }
    
    await renderContainerData(listDiv, items)
  } catch (err: any) {
    console.error('[VAULT UI] Error loading container items:', err)
    listDiv.innerHTML = `<div style="text-align:center;padding:40px;color:var(--wrv-danger);">Error loading data: ${err.message || err}</div>`
  }
}

// Render container data professionally - Password Manager Style List View
// Fetches full decrypted fields for items that need them (e.g. passwords).
async function renderContainerData(listDiv: HTMLElement, items: VaultItem[]) {
  if (items.length === 0) {
    listDiv.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--wrv-text-3);"><div style="font-size:48px;margin-bottom:16px;">📭</div><div style="font-size:16px;margin-bottom:8px;">No entries found</div><div style="font-size:13px;">Click "+ Add" to create your first entry</div></div>'
    return
  }

  // The list API returns items with empty fields for security.
  // Fetch full decrypted data for items that need field display.
  const enriched = await Promise.all(items.map(async (item) => {
    if (item.fields.length === 0) {
      try {
        return await vaultAPI.getItem(item.id)
      } catch {
        return item
      }
    }
    return item
  }))
  
  // Password manager style: Compact list with view/edit buttons
  listDiv.innerHTML = `
    <div style="padding:4px;">
      ${enriched.map(item => renderListItemRow(item)).join('')}
    </div>
  `
  
  // Add event handlers
  listDiv.querySelectorAll('.vault-list-item').forEach((row) => {
    const itemId = (row as HTMLElement).getAttribute('data-item-id')
    if (!itemId) return
    
    // Copy username button
    const copyUsernameBtn = row.querySelector('.vault-copy-username-btn')
    copyUsernameBtn?.addEventListener('click', async (e) => {
      e.stopPropagation()
      await copyToClipboard(copyUsernameBtn as HTMLButtonElement)
    })
    
    // Copy password button
    const copyPasswordBtn = row.querySelector('.vault-copy-password-btn')
    copyPasswordBtn?.addEventListener('click', async (e) => {
      e.stopPropagation()
      await copyToClipboard(copyPasswordBtn as HTMLButtonElement)
    })
    
    // Copy field buttons (for non-password items)
    row.querySelectorAll('.vault-copy-field-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        await copyToClipboard(btn as HTMLButtonElement)
      })
    })
    
    // Reveal password button
    const revealPasswordBtn = row.querySelector('.vault-reveal-password-btn')
    revealPasswordBtn?.addEventListener('click', (e) => {
      e.stopPropagation()
      const passwordDisplay = row.querySelector('.password-display') as HTMLElement
      if (!passwordDisplay) return
      
      const isRevealed = passwordDisplay.getAttribute('data-revealed') === 'true'
      const password = passwordDisplay.getAttribute('data-password') || ''
      
      if (isRevealed) {
        // Hide password
        passwordDisplay.textContent = '••••••••'
        passwordDisplay.setAttribute('data-revealed', 'false')
        ;(revealPasswordBtn as HTMLElement).innerHTML = '👁️'
        ;(revealPasswordBtn as HTMLElement).title = 'Reveal password'
      } else {
        // Reveal password
        passwordDisplay.textContent = password
        passwordDisplay.setAttribute('data-revealed', 'true')
        ;(revealPasswordBtn as HTMLElement).innerHTML = '🙈'
        ;(revealPasswordBtn as HTMLElement).title = 'Hide password'
      }
    })
    
    // Edit button
    const editBtn = row.querySelector('.vault-item-edit-btn')
    editBtn?.addEventListener('click', async (e) => {
      e.stopPropagation()
      try {
        const item = await vaultAPI.getItem(itemId)
        const container = listDiv.closest('#vault-main-content') || document.querySelector('#vault-main-content')
        if (container) {
          renderEditDataDialog(container as HTMLElement, item)
        }
      } catch (err: any) {
        alert(`Error loading item: ${err.message || err}`)
      }
    })
    
    // Delete button
    const deleteBtn = row.querySelector('.vault-item-delete-btn')
    deleteBtn?.addEventListener('click', async (e) => {
      e.stopPropagation()
      const title = (row.querySelector('.vault-item-title') as HTMLElement)?.textContent || 'this item'
      if (confirm(`Are you sure you want to delete "${title}"?`)) {
        try {
          await vaultAPI.deleteItem(itemId)
          // Refresh the view
          const containerId = (row as HTMLElement).getAttribute('data-container-id')
          const category = (row as HTMLElement).getAttribute('data-category')
          const container = (listDiv.closest('#vault-main-content') || document.querySelector('#vault-main-content')) as HTMLElement
          
          if (containerId) {
            loadContainerItems(container, containerId)
          } else if (category) {
            loadVaultItems(container, category)
          } else {
            loadVaultItems(container, 'all')
          }
          loadContainersIntoTree(container)
          addAddButtonsToTree(container)
        } catch (err: any) {
          alert(`Error deleting item: ${err.message || err}`)
        }
      }
    })
  })
}

// Helper function for copy to clipboard with visual feedback
async function copyToClipboard(button: HTMLButtonElement) {
  const value = button.getAttribute('data-value')
  if (!value) return
  
  try {
    await navigator.clipboard.writeText(value)
    
    // Visual feedback
    const originalText = button.textContent
    button.textContent = '✓'
    button.style.background = 'rgba(34,197,94,0.3)'
    button.style.borderColor = 'rgba(34,197,94,0.5)'
    button.style.color = '#4ade80'
    
    setTimeout(() => {
      button.textContent = originalText
      button.style.background = 'rgba(var(--wrv-accent-rgb),0.12)'
      button.style.borderColor = 'rgba(var(--wrv-accent-rgb),0.25)'
      button.style.color = 'var(--wrv-accent)'
    }, 1500)
  } catch (err) {
    console.error('[VAULT UI] Failed to copy:', err)
    alert('Failed to copy. Please try again.')
  }
}

// Render a single list item row (Password Manager Style)
function renderListItemRow(item: VaultItem): string {
  // Extract key fields for password items
  let username = ''
  let website = ''
  let password = ''
  
  if (item.category === 'password') {
    const usernameField = item.fields.find(f => f.key === 'username' || f.key === 'email')
    username = usernameField ? usernameField.value : ''
    
    const urlField = item.fields.find(f => f.key === 'url' || f.key === 'website')
    website = urlField ? urlField.value : (item.domain || '')
    
    const passwordField = item.fields.find(f => f.key === 'password')
    password = passwordField ? passwordField.value : ''
  }
  
  const categoryIcon = {
    automation_secret: '🔐',
    password: '🔑',
    identity: '👤',
    company: '🏢',
    custom: '📝',
    document: '📄',
    handshake_context: '🤝'
  }[item.category] || '📄'
  
  // For non-password items, show minimal view with field names
  if (item.category !== 'password') {
    // Show up to 3 fields with their names
    const displayFields = item.fields.slice(0, 3)
    const hasMoreFields = item.fields.length > 3
    
    return `
      <div class="vault-list-item" data-item-id="${item.id}" data-container-id="${item.container_id || ''}" data-category="${item.category}" style="
        background:var(--wrv-bg-card);
        border:1px solid var(--wrv-border);
        border-radius:10px;
        padding:14px 18px;
        margin-bottom:10px;
        transition:all 0.15s;
        box-shadow:0 1px 4px rgba(0,0,0,0.08);
      " onmouseenter="this.style.background='rgba(var(--wrv-accent-rgb),0.06)';this.style.borderColor='var(--wrv-border-accent)'" onmouseleave="this.style.background='var(--wrv-bg-card)';this.style.borderColor='var(--wrv-border)'">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;">
          <div style="display:flex;align-items:flex-start;gap:12px;flex:1;min-width:0;">
            <div style="font-size:22px;flex-shrink:0;margin-top:2px;">${categoryIcon}</div>
            <div style="flex:1;min-width:0;">
              <div class="vault-item-title" style="font-size:14px;font-weight:600;color:var(--wrv-text);margin-bottom:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.title || 'Untitled')}</div>
              ${displayFields.length > 0 ? `
                <div style="display:flex;flex-direction:column;gap:6px;">
                  ${displayFields.map(field => {
                    const fieldLabel = field.key.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
                    const displayValue = field.encrypted ? '••••••••' : (field.value || 'Not set')
                    const truncatedValue = field.encrypted ? displayValue : (displayValue.length > 40 ? displayValue.substring(0, 40) + '...' : displayValue)
                    
                    return `
                      <div style="display:flex;align-items:center;gap:8px;">
                        <div style="font-size:11px;color:var(--wrv-text-3);text-transform:uppercase;letter-spacing:0.5px;font-weight:600;min-width:110px;flex-shrink:0;">${escapeHtml(fieldLabel)}:</div>
                        <div style="font-size:13px;color:var(--wrv-text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;${field.encrypted ? 'font-family:monospace;letter-spacing:1px;' : ''}" title="${field.encrypted ? '' : escapeHtml(field.value)}">${escapeHtml(truncatedValue)}</div>
                      </div>
                    `
                  }).join('')}
                  ${hasMoreFields ? `
                    <div style="font-size:11px;color:var(--wrv-text-3);margin-top:4px;font-style:italic;">
                      + ${item.fields.length - 3} more field${item.fields.length - 3 > 1 ? 's' : ''} (click Edit to view all)
                    </div>
                  ` : ''}
                </div>
              ` : '<div style="font-size:13px;color:var(--wrv-text-3);">No fields</div>'}
            </div>
          </div>
          <div style="display:flex;gap:6px;align-items:flex-start;flex-shrink:0;padding-top:2px;">
            <button class="vault-item-edit-btn" style="
              background:rgba(var(--wrv-accent-rgb),0.15);
              border:1px solid rgba(var(--wrv-accent-rgb),0.3);
              padding:7px 16px;
              border-radius:6px;
              color:var(--wrv-accent);
              font-size:12px;
              font-weight:500;
              cursor:pointer;
              transition:all 0.15s;
              white-space:nowrap;
            " onmouseenter="this.style.background='rgba(var(--wrv-accent-rgb),0.25)'" onmouseleave="this.style.background='rgba(var(--wrv-accent-rgb),0.15)'">Edit</button>
            <button class="vault-item-delete-btn" style="
              background:var(--wrv-danger-bg);
              border:1px solid var(--wrv-danger-border);
              padding:7px 16px;
              border-radius:6px;
              color:var(--wrv-danger);
              font-size:12px;
              font-weight:500;
              cursor:pointer;
              transition:all 0.15s;
              white-space:nowrap;
            " onmouseenter="this.style.opacity='0.8'" onmouseleave="this.style.opacity='1'">Delete</button>
          </div>
        </div>
      </div>
    `
  }
  
  // Professional password item view with username, website, password
  return `
    <div class="vault-list-item" data-item-id="${item.id}" data-container-id="${item.container_id || ''}" data-category="${item.category}" style="
      background:var(--wrv-bg-card);
      border:1px solid var(--wrv-border);
      border-radius:10px;
      padding:18px;
      margin-bottom:10px;
      transition:all 0.15s;
      box-shadow:0 1px 4px rgba(0,0,0,0.08);
    " onmouseenter="this.style.background='rgba(var(--wrv-accent-rgb),0.06)';this.style.borderColor='var(--wrv-border-accent)'" onmouseleave="this.style.background='var(--wrv-bg-card)';this.style.borderColor='var(--wrv-border)'">
      
      <!-- Header: Icon, Title, Actions -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--wrv-border);">
        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
          <div style="font-size:24px;flex-shrink:0;">${categoryIcon}</div>
          <div class="vault-item-title" style="font-size:15px;font-weight:600;color:var(--wrv-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.title || 'Untitled')}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button class="vault-item-edit-btn" style="
            background:rgba(var(--wrv-accent-rgb),0.15);
            border:1px solid rgba(var(--wrv-accent-rgb),0.3);
            padding:7px 16px;
            border-radius:6px;
            color:var(--wrv-accent);
            font-size:12px;
            font-weight:500;
            cursor:pointer;
            transition:all 0.15s;
            white-space:nowrap;
          " onmouseenter="this.style.background='rgba(var(--wrv-accent-rgb),0.25)'" onmouseleave="this.style.background='rgba(var(--wrv-accent-rgb),0.15)'">Edit</button>
          <button class="vault-item-delete-btn" style="
            background:var(--wrv-danger-bg);
            border:1px solid var(--wrv-danger-border);
            padding:7px 16px;
            border-radius:6px;
            color:var(--wrv-danger);
            font-size:12px;
            font-weight:500;
            cursor:pointer;
            transition:all 0.15s;
            white-space:nowrap;
          " onmouseenter="this.style.opacity='0.8'" onmouseleave="this.style.opacity='1'">Delete</button>
        </div>
      </div>
      
      <!-- Fields Grid -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        
        <!-- Username Field -->
        <div>
          <div style="font-size:11px;color:var(--wrv-text-3);text-transform:uppercase;letter-spacing:0.8px;font-weight:600;margin-bottom:6px;">Username</div>
          <div style="display:flex;align-items:center;gap:8px;background:var(--wrv-bg-input);border:1px solid var(--wrv-border);border-radius:6px;padding:8px 10px;">
            <div style="font-size:13px;color:var(--wrv-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;font-weight:500;" title="${escapeHtml(username)}">${username ? escapeHtml(username) : '<span style="color:var(--wrv-text-3);font-weight:400;">Not set</span>'}</div>
            ${username ? `
              <button class="vault-copy-username-btn" data-value="${escapeHtml(username)}" style="
                background:rgba(var(--wrv-accent-rgb),0.15);
                border:none;
                padding:6px 10px;
                border-radius:6px;
                color:var(--wrv-header-sub);
                font-size:16px;
                cursor:pointer;
                transition:all 0.2s;
                flex-shrink:0;
                line-height:1;
              " onclick="event.stopPropagation()" onmouseenter="this.style.background='rgba(var(--wrv-accent-rgb),0.25)'" onmouseleave="this.style.background='rgba(var(--wrv-accent-rgb),0.15)'" title="Copy username">📋</button>
            ` : ''}
          </div>
        </div>
        
        <!-- Website Field -->
        <div>
          <div style="font-size:11px;color:var(--wrv-text-3);text-transform:uppercase;letter-spacing:0.8px;font-weight:600;margin-bottom:6px;">Website</div>
          <div style="display:flex;align-items:center;gap:8px;background:var(--wrv-bg-input);border:1px solid var(--wrv-border);border-radius:6px;padding:8px 10px;">
            ${website ? `
              <a href="${escapeHtml(website)}" target="_blank" rel="noopener noreferrer" style="
                font-size:13px;
                color:var(--wrv-accent);
                text-decoration:none;
                white-space:nowrap;
                overflow:hidden;
                text-overflow:ellipsis;
                display:flex;
                align-items:center;
                gap:8px;
                flex:1;
                font-weight:500;
              " onclick="event.stopPropagation()" title="${escapeHtml(website)}">
                <span style="font-size:14px;">🔗</span>
                <span style="overflow:hidden;text-overflow:ellipsis;">${escapeHtml(website.replace(/^https?:\/\//i, ''))}</span>
              </a>
            ` : '<span style="font-size:13px;color:var(--wrv-text-3);font-weight:400;">Not set</span>'}
          </div>
        </div>
        
        <!-- Password Field -->
        <div style="grid-column:span 2;">
          <div style="font-size:11px;color:var(--wrv-text-3);text-transform:uppercase;letter-spacing:0.8px;font-weight:600;margin-bottom:6px;">Password</div>
          <div style="display:flex;align-items:center;gap:8px;background:var(--wrv-bg-input);border:1px solid var(--wrv-border-accent);border-radius:6px;padding:10px 12px;">
            <div class="password-display" data-password="${escapeHtml(password)}" data-revealed="false" style="
              font-family:'Courier New',monospace;
              font-size:14px;
              color:var(--wrv-text);
              flex:1;
              font-weight:500;
              letter-spacing:2px;
            ">${password ? '••••••••••••' : '<span style="color:var(--wrv-text-3);font-weight:400;letter-spacing:0;">Not set</span>'}</div>
            ${password ? `
              <button class="vault-reveal-password-btn" style="
                background:rgba(var(--wrv-accent-rgb),0.15);
                border:none;
                padding:8px 12px;
                border-radius:8px;
                color:var(--wrv-header-sub);
                font-size:18px;
                cursor:pointer;
                transition:all 0.2s;
                flex-shrink:0;
                line-height:1;
              " onclick="event.stopPropagation()" onmouseenter="this.style.background='rgba(var(--wrv-accent-rgb),0.25)'" onmouseleave="this.style.background='rgba(var(--wrv-accent-rgb),0.15)'" title="Reveal password">👁️</button>
              <button class="vault-copy-password-btn" data-value="${escapeHtml(password)}" style="
                background:rgba(var(--wrv-accent-rgb),0.15);
                border:none;
                padding:8px 12px;
                border-radius:8px;
                color:var(--wrv-header-sub);
                font-size:18px;
                cursor:pointer;
                transition:all 0.2s;
                flex-shrink:0;
                line-height:1;
              " onclick="event.stopPropagation()" onmouseenter="this.style.background='rgba(var(--wrv-accent-rgb),0.25)'" onmouseleave="this.style.background='rgba(var(--wrv-accent-rgb),0.15)'" title="Copy password">📋</button>
            ` : ''}
          </div>
        </div>
        
      </div>
    </div>
  `
}

// Render item view modal (Password Manager Style)
function renderItemViewModal(item: VaultItem) {
  const overlay = document.createElement('div')
  overlay.setAttribute('data-wrv-no-autofill', '')
  overlay.style.cssText = `
    position:fixed;
    inset:0;
    background:transparent;
    z-index:2147483651;
    display:flex;
    align-items:center;
    justify-content:center;
    overflow-y:auto;
  `
  
  const fieldsHtml = item.fields.map((field, index) => {
    const actualValue = field.value || ''
    const isPassword = field.encrypted || field.type === 'password' || field.key === 'password'
    const fieldId = `vault-field-${item.id}-${index}`
    const maskedValue = '••••••••'
    
    return `
      <div style="margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <div style="font-size:11px;color:var(--wrv-text-3);text-transform:uppercase;letter-spacing:0.5px;">
            ${escapeHtml(field.key)}
          </div>
          <div style="display:flex;gap:6px;">
            ${isPassword && actualValue ? `
              <button class="vault-reveal-btn" data-field-id="${fieldId}" style="
                background:rgba(var(--wrv-accent-rgb),0.15);
                border:1px solid rgba(var(--wrv-accent-rgb),0.3);
                padding:4px 10px;
                border-radius:6px;
                color:var(--wrv-accent);
                font-size:11px;
                cursor:pointer;
                transition:all 0.15s;
                white-space:nowrap;
              " onmouseenter="this.style.background='rgba(var(--wrv-accent-rgb),0.25)'" onmouseleave="this.style.background='rgba(var(--wrv-accent-rgb),0.15)'">👁️ Reveal</button>
            ` : ''}
            ${actualValue ? `
              <button class="vault-copy-btn" data-field-id="${fieldId}" data-value="${escapeHtml(actualValue)}" style="
                background:rgba(var(--wrv-accent-rgb),0.15);
                border:1px solid rgba(var(--wrv-accent-rgb),0.3);
                padding:4px 10px;
                border-radius:6px;
                color:var(--wrv-accent);
                font-size:11px;
                cursor:pointer;
                transition:all 0.15s;
                white-space:nowrap;
              " onmouseenter="this.style.background='rgba(var(--wrv-accent-rgb),0.25)'" onmouseleave="this.style.background='rgba(var(--wrv-accent-rgb),0.15)'">📋 Copy</button>
            ` : ''}
          </div>
        </div>
        <div id="${fieldId}" data-actual-value="${escapeHtml(actualValue)}" data-is-revealed="false" style="font-size:15px;color:var(--wrv-text);word-break:break-word;background:var(--wrv-bg-input);padding:12px;border-radius:8px;border:1px solid rgba(var(--wrv-accent-rgb),0.2);position:relative;font-family:monospace;">
          ${isPassword ? maskedValue : escapeHtml(actualValue)}
        </div>
        ${field.explanation ? `<div style="font-size:12px;color:var(--wrv-text-3);margin-top:6px;font-style:italic;">${escapeHtml(field.explanation)}</div>` : ''}
      </div>
    `
  }).join('')
  
  overlay.innerHTML = `
    <div style="
      background:var(--wrv-bg);
      border-radius:16px;
      width:90vw;
      max-width:700px;
      max-height:90vh;
      overflow-y:auto;
      color:var(--wrv-text);
      box-shadow:0 25px 50px rgba(var(--wrv-accent-rgb),0.30);
      border:1px solid rgba(var(--wrv-accent-rgb),0.30);
    ">
      <div style="padding:32px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
          <h2 style="font-size:24px;font-weight:700;color:var(--wrv-text);">${escapeHtml(item.title || 'Untitled')}</h2>
          <button id="vault-view-close" style="
            background:var(--wrv-bg-card);
            border:1px solid var(--wrv-border);
            width:32px;
            height:32px;
            border-radius:8px;
            color:var(--wrv-text);
            font-size:20px;
            cursor:pointer;
            display:flex;
            align-items:center;
            justify-content:center;
          ">×</button>
        </div>
        ${item.domain ? `<div style="margin-bottom:20px;padding:12px;background:rgba(var(--wrv-accent-rgb),0.08);border-radius:8px;border:1px solid rgba(var(--wrv-accent-rgb),0.2);"><div style="font-size:11px;color:var(--wrv-text-3);margin-bottom:4px;">Domain</div><div style="font-size:14px;color:var(--wrv-text);">${escapeHtml(item.domain)}</div></div>` : ''}
        <div style="border-top:1px solid rgba(var(--wrv-accent-rgb),0.15);padding-top:20px;">
          ${fieldsHtml}
        </div>
      </div>
    </div>
  `
  
  document.body.appendChild(overlay)
  
  // Reveal/Hide password functionality
  overlay.querySelectorAll('.vault-reveal-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const fieldId = (btn as HTMLElement).getAttribute('data-field-id')
      const fieldDiv = overlay.querySelector(`#${fieldId}`) as HTMLElement
      if (!fieldDiv) return
      
      const isRevealed = fieldDiv.getAttribute('data-is-revealed') === 'true'
      const actualValue = fieldDiv.getAttribute('data-actual-value') || ''
      
      if (isRevealed) {
        // Hide password
        fieldDiv.textContent = '••••••••'
        fieldDiv.setAttribute('data-is-revealed', 'false')
        ;(btn as HTMLElement).innerHTML = '👁️ Reveal'
      } else {
        // Reveal password
        fieldDiv.textContent = actualValue
        fieldDiv.setAttribute('data-is-revealed', 'true')
        ;(btn as HTMLElement).innerHTML = '🙈 Hide'
      }
    })
  })
  
  // Copy to clipboard functionality
  overlay.querySelectorAll('.vault-copy-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const button = btn as HTMLButtonElement
      const value = button.getAttribute('data-value')
      const fieldId = button.getAttribute('data-field-id')
      
      if (value) {
        try {
          await navigator.clipboard.writeText(value)
          
          // Visual feedback
          const originalText = button.textContent
          button.textContent = '✓ Copied!'
          button.style.background = 'rgba(34,197,94,0.3)'
          button.style.borderColor = 'rgba(34,197,94,0.5)'
          button.style.color = '#4ade80'
          
          setTimeout(() => {
            button.textContent = originalText
            button.style.background = 'rgba(var(--wrv-accent-rgb),0.15)'
            button.style.borderColor = 'rgba(var(--wrv-accent-rgb),0.30)'
            button.style.color = 'var(--wrv-accent)'
          }, 2000)
        } catch (err) {
          console.error('[VAULT UI] Failed to copy to clipboard:', err)
          alert('Failed to copy to clipboard. Please try again.')
        }
      }
    })
  })
  
  overlay.querySelector('#vault-view-close')?.addEventListener('click', () => overlay.remove())
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove()
  })
}

// Render a single item card professionally
function renderItemCard(item: VaultItem): string {
  const fieldsHtml = item.fields.map(field => {
    const value = field.encrypted ? '••••••••' : escapeHtml(field.value || '')
    return `
      <div style="margin-bottom:10px;">
        <div style="font-size:11px;color:var(--wrv-text-3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">
          ${escapeHtml(field.key)}
        </div>
        <div style="font-size:14px;color:var(--wrv-text);word-break:break-word;">
          ${value}
        </div>
      </div>
    `
  }).join('')
  
  return `
    <div style="
      background:var(--wrv-bg-card);
      border:1px solid var(--wrv-border);
      border-radius:10px;
      padding:16px;
      margin-bottom:12px;
      transition:all 0.15s;
    " class="vault-item-card" data-item-id="${item.id}" data-container-id="${item.container_id || ''}" data-category="${item.category}" onmouseenter="this.style.background='rgba(var(--wrv-accent-rgb),0.06)';this.style.borderColor='var(--wrv-border-accent)'" onmouseleave="this.style.background='var(--wrv-bg-card)';this.style.borderColor='var(--wrv-border)'">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px;">
        <div>
          <div class="vault-item-title" style="font-size:16px;font-weight:600;margin-bottom:4px;color:var(--wrv-text);">${escapeHtml(item.title || 'Untitled')}</div>
          ${item.domain ? `<div style="font-size:12px;color:var(--wrv-text-2);">${escapeHtml(item.domain)}</div>` : ''}
        </div>
        <div style="display:flex;gap:6px;">
          <button class="vault-item-edit-btn" style="
            background:rgba(var(--wrv-accent-rgb),0.15);
            border:1px solid rgba(var(--wrv-accent-rgb),0.3);
            padding:6px 14px;
            border-radius:6px;
            color:var(--wrv-accent);
            font-size:12px;
            cursor:pointer;
            transition:all 0.15s;
          " onmouseenter="this.style.background='rgba(var(--wrv-accent-rgb),0.25)'" onmouseleave="this.style.background='rgba(var(--wrv-accent-rgb),0.15)'">Edit</button>
          <button class="vault-item-delete-btn" style="
            background:var(--wrv-danger-bg);
            border:1px solid var(--wrv-danger-border);
            padding:6px 14px;
            border-radius:6px;
            color:var(--wrv-danger);
            font-size:12px;
            cursor:pointer;
            transition:all 0.15s;
          " onmouseenter="this.style.opacity='0.8'" onmouseleave="this.style.opacity='1'">Delete</button>
        </div>
      </div>
      <div style="border-top:1px solid var(--wrv-border);padding-top:12px;">
        ${fieldsHtml}
      </div>
    </div>
  `
}

// Render Add Data Dialog
function renderAddDataDialog(container: HTMLElement, preselectedCategory?: 'automation_secret' | 'password' | 'identity' | 'company' | 'custom' | 'document' | 'handshake_context') {
  // Documents use their own dedicated upload dialog — redirect immediately.
  if (preselectedCategory === 'document') {
    renderDocumentUploadDialog(container)
    return
  }
  // Handshake context uses its own dialog with binding policy fields.
  if (preselectedCategory === 'handshake_context') {
    renderHandshakeContextDialog(container)
    return
  }
  // Render the Add Data form inline inside the vault's main content area.
  // Save current content so we can restore on cancel/close.
  const savedContent = container.innerHTML

  const dialog = document.createElement('div')
  dialog.id = 'vault-add-data-overlay'
  dialog.setAttribute('data-wrv-no-autofill', '')
  dialog.style.cssText = `
    height:100%;
    overflow-y:auto;
    color:var(--wrv-text);
  `
  
  // Category options filtered by the user's tier (capability-gated)
  const categoryOptions = getCategoryOptionsForTier(currentVaultTier)
  
  dialog.innerHTML = `
    <div style="padding:28px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <div style="display:flex;align-items:center;gap:12px;">
          <button id="vault-add-data-back" style="
            background:var(--wrv-bg-card);
            border:1px solid var(--wrv-border);
            padding:6px 14px;
            border-radius:8px;
            color:var(--wrv-text-2);
            font-size:13px;
            font-weight:600;
            cursor:pointer;
            display:flex;
            align-items:center;
            gap:6px;
            transition:all 0.15s;
          " onmouseenter="this.style.background='var(--wrv-bg-input)';this.style.color='var(--wrv-text)'" onmouseleave="this.style.background='var(--wrv-bg-card)';this.style.color='var(--wrv-text-2)'">← Back</button>
          <h2 style="font-size:20px;font-weight:700;margin:0;">Add Data</h2>
        </div>
        <button id="vault-add-data-close" style="
          background:var(--wrv-bg-card);
          border:1px solid var(--wrv-border);
          width:30px;
          height:30px;
          border-radius:6px;
          color:var(--wrv-text-2);
          font-size:18px;
          cursor:pointer;
          display:flex;
          align-items:center;
          justify-content:center;
          transition:all 0.15s;
        ">×</button>
      </div>
      
      <div style="margin-bottom:20px;">
        <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:var(--wrv-text-2);">Select Category *</label>
        <select id="vault-add-category" required style="
          width:100%;
          min-height:42px;
          padding:10px 14px;
          padding-right:36px;
          border:1px solid var(--wrv-border-accent);
          border-radius:8px;
          background:var(--wrv-bg-input);
          color:var(--wrv-text);
          font-size:14px;
          cursor:pointer;
          box-sizing:border-box;
          display:block;
          visibility:visible;
          opacity:1;
          appearance:none;
          -webkit-appearance:none;
          -moz-appearance:none;
          background-image:url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"12\" height=\"12\" viewBox=\"0 0 12 12\"><path fill=\"%23888\" d=\"M6 9L1 4h10z\"/></svg>');
          background-repeat:no-repeat;
          background-position:right 12px center;
        ">
          <option value="">Loading categories...</option>
        </select>
      </div>
      
      <div id="vault-add-form-container">
        <!-- Form will be dynamically generated based on category -->
      </div>
      
      <div style="display:flex;gap:10px;margin-top:20px;padding-top:20px;border-top:1px solid var(--wrv-border);justify-content:flex-end;">
        <button id="vault-add-data-cancel" style="
          padding:10px 20px;
          background:var(--wrv-bg-card);
          border:1px solid var(--wrv-border);
          border-radius:8px;
          color:var(--wrv-text-2);
          font-size:13px;
          font-weight:600;
          cursor:pointer;
          transition:all 0.15s;
        ">Cancel</button>
        <button id="vault-add-data-save" style="
          padding:10px 20px;
          background:var(--wrv-btn-primary);
          border:none;
          border-radius:8px;
          color:#fff;
          font-size:13px;
          font-weight:600;
          cursor:pointer;
          transition:all 0.15s;
        ">Save Data</button>
      </div>
    </div>
  `
  
  container.innerHTML = ''
  container.appendChild(dialog)
  
  // Populate select options programmatically AFTER dialog is in DOM
  const categorySelect = dialog.querySelector('#vault-add-category') as HTMLSelectElement
  // Default to the first allowed category for this tier
  const defaultCategory = preselectedCategory || (categoryOptions.length > 0 ? categoryOptions[0].value : 'automation_secret')
  
  if (!categorySelect) {
    console.error('[VAULT] Category select element not found!')
    return
  }
  
  // Clear any existing options first
  categorySelect.innerHTML = ''
  
  categoryOptions.forEach(opt => {
    const option = document.createElement('option')
    option.value = opt.value
    option.textContent = opt.label
    if (opt.value === defaultCategory) {
      option.selected = true
    }
    categorySelect.appendChild(option)
  })
  
  // Ensure selectbox is visible
  categorySelect.style.display = 'block'
  categorySelect.style.visibility = 'visible'
  categorySelect.style.opacity = '1'
  
  // Get references after dialog is added to DOM
  const formContainer = dialog.querySelector('#vault-add-form-container') as HTMLElement
  
  const generateForm = (category: string) => {
    let standardFields: StandardFieldDef[] = []
    let titleLabel = 'Title'
    let isCustomData = false
    
    if (category === 'automation_secret') {
      standardFields = AUTOMATION_SECRET_STANDARD_FIELDS
      titleLabel = 'Secret Name'
    } else if (category === 'password') {
      standardFields = PASSWORD_STANDARD_FIELDS
      titleLabel = 'Service Name'
    } else if (category === 'identity') {
      standardFields = IDENTITY_STANDARD_FIELDS
      titleLabel = 'Identity Name'
    } else if (category === 'company') {
      standardFields = COMPANY_STANDARD_FIELDS
      titleLabel = 'Company Name'
    } else if (category === 'custom') {
      isCustomData = true
      titleLabel = 'Data Group Name'
    }
    
    if (isCustomData) {
      // Custom Data form - multiple field groups
      formContainer.innerHTML = `
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:var(--wrv-text-2);">${titleLabel} *</label>
          <input type="text" id="vault-add-title" placeholder="Enter ${titleLabel.toLowerCase()}" style="
            width:100%;
            padding:10px 14px;
            border:1px solid var(--wrv-border-accent);
            border-radius:8px;
            background:var(--wrv-bg-input);
            color:var(--wrv-text);
            font-size:14px;
            box-sizing:border-box;
          "/>
        </div>
        
        <div style="margin-bottom:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <label style="font-size:12px;font-weight:600;color:var(--wrv-text-2);">Data Fields</label>
            <button type="button" id="vault-add-custom-field-group" style="
              padding:5px 10px;
              background:rgba(var(--wrv-accent-rgb),0.15);
              border:1px solid rgba(var(--wrv-accent-rgb),0.3);
              border-radius:6px;
              color:var(--wrv-accent);
              font-size:12px;
              cursor:pointer;
            ">+ Add Field</button>
          </div>
          <div id="vault-custom-field-groups" style="display:flex;flex-direction:column;gap:16px;">
            <!-- Field groups will be added here -->
          </div>
        </div>
      `
      
      // Add first field group for custom data
      const customFieldGroupsContainer = dialog.querySelector('#vault-custom-field-groups') as HTMLElement
      const addCustomFieldGroupBtn = dialog.querySelector('#vault-add-custom-field-group')
      
      const addCustomFieldGroup = () => {
        const fieldGroupDiv = document.createElement('div')
        fieldGroupDiv.style.cssText = 'background:rgba(var(--wrv-accent-rgb),0.04);border:1px solid rgba(var(--wrv-accent-rgb),0.2);border-radius:8px;padding:16px;'
        fieldGroupDiv.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <span style="font-size:12px;font-weight:600;color:var(--wrv-text-2);">Field</span>
            <button type="button" class="remove-custom-field-group" style="
              background:var(--wrv-danger-bg);
              border:1px solid var(--wrv-danger-bg);
              padding:4px 8px;
              border-radius:4px;
              color:var(--wrv-danger);
              font-size:11px;
              cursor:pointer;
            ">Remove</button>
          </div>
          <div style="display:flex;flex-direction:column;gap:12px;">
            <div>
              <label style="display:block;font-size:11px;font-weight:600;margin-bottom:4px;color:var(--wrv-text-2);">Field Name *</label>
              <input type="text" class="custom-field-name" placeholder="e.g., License Number" style="
                width:100%;
                padding:10px 12px;
                border:1px solid var(--wrv-border-accent);
                border-radius:6px;
                background:var(--wrv-bg-input);
                color:var(--wrv-text);
                font-size:13px;
                box-sizing:border-box;
              "/>
            </div>
            <div>
              <label style="display:block;font-size:11px;font-weight:600;margin-bottom:4px;color:var(--wrv-text-2);">Field Value *</label>
              <input type="text" class="custom-field-value" placeholder="Enter the value" style="
                width:100%;
                padding:10px 12px;
                border:1px solid var(--wrv-border-accent);
                border-radius:6px;
                background:var(--wrv-bg-input);
                color:var(--wrv-text);
                font-size:13px;
                box-sizing:border-box;
              "/>
            </div>
            <div>
              <label style="display:block;font-size:11px;font-weight:600;margin-bottom:4px;color:var(--wrv-text-2);">Additional Info</label>
              <div style="font-size:10px;color:var(--wrv-text-3);margin-bottom:4px;font-style:italic;">💡 This information helps AI autofill match this data to forms more accurately</div>
              <textarea class="custom-field-additional-info" placeholder="Additional context or notes..." style="
                width:100%;
                padding:10px 12px;
                border:1px solid var(--wrv-border-accent);
                border-radius:6px;
                background:var(--wrv-bg-input);
                color:var(--wrv-text);
                font-size:13px;
                min-height:60px;
                resize:vertical;
                font-family:inherit;
                box-sizing:border-box;
              "></textarea>
            </div>
          </div>
        `
        customFieldGroupsContainer.appendChild(fieldGroupDiv)
        
        fieldGroupDiv.querySelector('.remove-custom-field-group')?.addEventListener('click', () => {
          fieldGroupDiv.remove()
        })
      }
      
      // Add initial field group
      addCustomFieldGroup()
      
      addCustomFieldGroupBtn?.addEventListener('click', addCustomFieldGroup)
      return
    }
    
    // Standard form for password/identity/company
    formContainer.innerHTML = `
      ${category !== 'identity' ? `
      <div style="margin-bottom:20px;">
        <div style="font-size:11px;color:var(--wrv-text-3);text-transform:uppercase;letter-spacing:0.8px;font-weight:600;margin-bottom:6px;">${titleLabel}</div>
        <input type="text" id="vault-add-title" placeholder="Enter ${titleLabel.toLowerCase()}" style="
          width:100%;
          padding:10px 14px;
          border:1px solid var(--wrv-border);
          border-radius:8px;
          background:var(--wrv-bg-input);
          color:var(--wrv-text);
          font-size:14px;
          font-weight:500;
          box-sizing:border-box;
          transition:all 0.15s;
        " onfocus="this.style.borderColor='var(--wrv-border-accent)'" onblur="this.style.borderColor='var(--wrv-border)'"/>
      </div>
      ` : ''}
      
      <div style="margin-bottom:16px;">
        <div style="font-size:11px;color:var(--wrv-text-3);text-transform:uppercase;letter-spacing:0.8px;font-weight:600;margin-bottom:12px;">Standard Fields</div>
        <div id="vault-standard-fields" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          ${(() => {
            let fieldsHtml = ''
            let i = 0
            while (i < standardFields.length) {
              const field = standardFields[i]
              
              // Check if this is CEO first name and next is CEO surname - render them side by side
              if (field.key === 'ceo_first_name' && i + 1 < standardFields.length && standardFields[i + 1].key === 'ceo_surname') {
                const ceoFirstNameField = field
                const ceoSurnameField = standardFields[i + 1]
                fieldsHtml += `
                  <div>
                    <div style="font-size:11px;color:var(--wrv-text-3);text-transform:uppercase;letter-spacing:0.8px;font-weight:600;margin-bottom:6px;">${escapeHtml(ceoFirstNameField.label)}${ceoFirstNameField.required ? ' *' : ''}</div>
                    <input type="text" 
                      id="field-${ceoFirstNameField.key}" 
                      placeholder="Enter ${ceoFirstNameField.label.toLowerCase()}" 
                      ${ceoFirstNameField.required ? 'required' : ''}
                      style="
                        width:100%;
                        padding:12px 14px;
                        border:1px solid var(--wrv-border);
                        border-radius:8px;
                        background:var(--wrv-bg-input);
                        color:var(--wrv-text);
                        font-size:14px;
                        font-weight:500;
                        box-sizing:border-box;
                        transition:all 0.15s;
                      " onfocus="this.style.borderColor='var(--wrv-border-accent)'" onblur="this.style.borderColor='var(--wrv-border)'"/>
                  </div>
                  <div>
                    <div style="font-size:11px;color:var(--wrv-text-3);text-transform:uppercase;letter-spacing:0.8px;font-weight:600;margin-bottom:6px;">${escapeHtml(ceoSurnameField.label)}${ceoSurnameField.required ? ' *' : ''}</div>
                    <input type="text" 
                      id="field-${ceoSurnameField.key}" 
                      placeholder="Enter ${ceoSurnameField.label.toLowerCase()}" 
                      ${ceoSurnameField.required ? 'required' : ''}
                      style="
                        width:100%;
                        padding:12px 14px;
                        border:1px solid var(--wrv-border);
                        border-radius:8px;
                        background:var(--wrv-bg-input);
                        color:var(--wrv-text);
                        font-size:14px;
                        font-weight:500;
                        box-sizing:border-box;
                        transition:all 0.15s;
                      " onfocus="this.style.borderColor='var(--wrv-border-accent)'" onblur="this.style.borderColor='var(--wrv-border)'"/>
                  </div>
                `
                i += 2 // Skip both fields
                continue
              }
              
              // Check if this is street field and next is street_number - render them side by side
              if (field.key === 'street' && i + 1 < standardFields.length && standardFields[i + 1].key === 'street_number') {
                const streetField = field
                const numberField = standardFields[i + 1]
                fieldsHtml += `
                  <div>
                    <div style="font-size:11px;color:var(--wrv-text-3);text-transform:uppercase;letter-spacing:0.8px;font-weight:600;margin-bottom:6px;">${escapeHtml(streetField.label)}${streetField.required ? ' *' : ''}</div>
                    <input type="text" 
                      id="field-${streetField.key}" 
                      placeholder="Enter ${streetField.label.toLowerCase()}" 
                      ${streetField.required ? 'required' : ''}
                      style="
                        width:100%;
                        padding:12px 14px;
                        border:1px solid var(--wrv-border);
                        border-radius:8px;
                        background:var(--wrv-bg-input);
                        color:var(--wrv-text);
                        font-size:14px;
                        font-weight:500;
                        box-sizing:border-box;
                        transition:all 0.15s;
                      " onfocus="this.style.borderColor='var(--wrv-border-accent)'" onblur="this.style.borderColor='var(--wrv-border)'"/>
                  </div>
                  <div>
                    <div style="font-size:11px;color:var(--wrv-text-3);text-transform:uppercase;letter-spacing:0.8px;font-weight:600;margin-bottom:6px;">${escapeHtml(numberField.label)}${numberField.required ? ' *' : ''}</div>
                    <input type="text" 
                      id="field-${numberField.key}" 
                      placeholder="Enter ${numberField.label.toLowerCase()}" 
                      ${numberField.required ? 'required' : ''}
                      style="
                        width:100%;
                        padding:12px 14px;
                        border:1px solid var(--wrv-border);
                        border-radius:8px;
                        background:var(--wrv-bg-input);
                        color:var(--wrv-text);
                        font-size:14px;
                        font-weight:500;
                        box-sizing:border-box;
                        transition:all 0.15s;
                      " onfocus="this.style.borderColor='var(--wrv-border-accent)'" onblur="this.style.borderColor='var(--wrv-border)'"/>
                  </div>
                `
                i += 2 // Skip both fields
                continue
              }
              
              // Date of birth: render 3 select dropdowns in one row
              if (field.key === 'birth_day' && i + 2 < standardFields.length && standardFields[i + 1].key === 'birth_month' && standardFields[i + 2].key === 'birth_year') {
                const days = Array.from({ length: 31 }, (_, n) => n + 1)
                const months = [
                  'January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December',
                ]
                const currentYear = new Date().getFullYear()
                const years = Array.from({ length: 120 }, (_, n) => currentYear - n)

                const selectStyle = `
                  width:100%;
                  padding:12px 10px;
                  border:1px solid var(--wrv-border);
                  border-radius:8px;
                  background:var(--wrv-bg-input);
                  color:var(--wrv-text);
                  font-size:13px;
                  font-weight:500;
                  box-sizing:border-box;
                  transition:all 0.15s;
                  cursor:pointer;
                  appearance:auto;
                `

                fieldsHtml += `
                  <div style="grid-column:span 2;">
                    <div style="font-size:11px;color:var(--wrv-text-3);text-transform:uppercase;letter-spacing:0.8px;font-weight:600;margin-bottom:6px;">Date of Birth</div>
                    <div style="display:grid;grid-template-columns:1fr 1.3fr 1fr;gap:8px;">
                      <select id="field-birth_day" style="${selectStyle}"
                        onfocus="this.style.borderColor='var(--wrv-border-accent)'" onblur="this.style.borderColor='var(--wrv-border)'">
                        <option value="">Day</option>
                        ${days.map(d => `<option value="${d}">${d}</option>`).join('')}
                      </select>
                      <select id="field-birth_month" style="${selectStyle}"
                        onfocus="this.style.borderColor='var(--wrv-border-accent)'" onblur="this.style.borderColor='var(--wrv-border)'">
                        <option value="">Month</option>
                        ${months.map((m, idx) => `<option value="${idx + 1}">${m}</option>`).join('')}
                      </select>
                      <select id="field-birth_year" style="${selectStyle}"
                        onfocus="this.style.borderColor='var(--wrv-border-accent)'" onblur="this.style.borderColor='var(--wrv-border)'">
                        <option value="">Year</option>
                        ${years.map(y => `<option value="${y}">${y}</option>`).join('')}
                      </select>
                    </div>
                  </div>
                `
                i += 3
                continue
              }

              // Regular field rendering
              const isFullWidth = field.key === 'additional_info' || field.type === 'textarea'
              fieldsHtml += `
                <div style="${isFullWidth ? 'grid-column:span 2;' : ''}">
                  <div style="font-size:11px;color:var(--wrv-text-3);text-transform:uppercase;letter-spacing:0.8px;font-weight:600;margin-bottom:6px;">${escapeHtml(field.label)}${field.required ? ' *' : ''}</div>
                  ${field.key === 'additional_info' ? `
                    <div style="font-size:10px;color:var(--wrv-text-3);margin-bottom:6px;font-style:italic;">💡 This information helps AI autofill match this data to forms more accurately</div>
                  ` : ''}
                  ${field.type === 'textarea' ? `
                    <textarea id="field-${field.key}" placeholder="Enter ${field.label.toLowerCase()}" style="
                      width:100%;
                      padding:10px 14px;
                      border:1px solid var(--wrv-border);
                      border-radius:8px;
                      background:var(--wrv-bg-input);
                      color:var(--wrv-text);
                      font-size:14px;
                      font-weight:500;
                      min-height:100px;
                      resize:vertical;
                      font-family:inherit;
                      box-sizing:border-box;
                      transition:all 0.15s;
                    " onfocus="this.style.borderColor='var(--wrv-border-accent)'" onblur="this.style.borderColor='var(--wrv-border)'"></textarea>
                  ` : `
                    <input type="${field.type === 'password' ? 'password' : field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : 'text'}" 
                      id="field-${field.key}" 
                      placeholder="Enter ${field.label.toLowerCase()}" 
                      ${field.required ? 'required' : ''}
                      style="
                        width:100%;
                        padding:12px 14px;
                        border:1px solid var(--wrv-border);
                        border-radius:8px;
                        background:var(--wrv-bg-input);
                        color:var(--wrv-text);
                        font-size:14px;
                        font-weight:500;
                        box-sizing:border-box;
                        transition:all 0.15s;
                      " onfocus="this.style.borderColor='var(--wrv-border-accent)'" onblur="this.style.borderColor='var(--wrv-border)'"/>
                  `}
                </div>
              `
              i++
            }
            return fieldsHtml
          })()}
        </div>
      </div>
      
      ${(category === 'identity' || category === 'company') ? `
      <div id="vault-payment-section" style="margin-bottom:16px;border:1px solid var(--wrv-border);border-radius:10px;overflow:hidden;">
        <button type="button" id="vault-payment-toggle" style="
          width:100%;
          padding:12px 16px;
          background:var(--wrv-bg-card);
          border:none;
          cursor:pointer;
          display:flex;
          align-items:center;
          gap:10px;
          color:var(--wrv-text);
          font-size:13px;
          font-weight:600;
          transition:all 0.15s;
        ">
          <svg id="vault-payment-chevron" width="12" height="12" viewBox="0 0 12 12" fill="currentColor" style="transition:transform 0.2s;transform:rotate(0deg);">
            <path d="M4.5 2L8.5 6L4.5 10" stroke="currentColor" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span style="display:flex;align-items:center;gap:6px;">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="3.5" width="14" height="9" rx="1.5" stroke="currentColor" stroke-width="1.2"/><line x1="1" y1="6.5" x2="15" y2="6.5" stroke="currentColor" stroke-width="1.2"/><line x1="3" y1="9.5" x2="7" y2="9.5" stroke="currentColor" stroke-width="1"/></svg>
            Payment Methods
          </span>
          <span style="font-size:11px;color:var(--wrv-text-3);font-weight:400;margin-left:auto;">Credit Card, IBAN, PayPal</span>
        </button>
        <div id="vault-payment-fields" style="display:none;padding:16px;background:var(--wrv-bg);border-top:1px solid var(--wrv-border);">
          <div style="font-size:11px;color:var(--wrv-text-3);margin-bottom:14px;font-style:italic;">Add payment details for autofill on checkout and payment forms.</div>
          <div id="vault-payment-methods-list">
            <!-- Payment method entries will be added here -->
          </div>
          <button type="button" id="vault-add-payment-method" style="
            width:100%;
            padding:10px 14px;
            background:rgba(var(--wrv-accent-rgb),0.08);
            border:2px dashed rgba(var(--wrv-accent-rgb),0.3);
            border-radius:8px;
            color:var(--wrv-accent);
            font-size:13px;
            font-weight:500;
            cursor:pointer;
            transition:all 0.15s;
            margin-top:8px;
          " onmouseenter="this.style.background='rgba(var(--wrv-accent-rgb),0.15)'" onmouseleave="this.style.background='rgba(var(--wrv-accent-rgb),0.08)'">+ Add Payment Method</button>
        </div>
      </div>
      ` : ''}

      <div style="margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <div style="font-size:11px;color:var(--wrv-text-3);text-transform:uppercase;letter-spacing:0.8px;font-weight:600;">Custom Fields</div>
          <button type="button" id="vault-add-custom-field" style="
            padding:6px 14px;
            background:rgba(var(--wrv-accent-rgb),0.15);
            border:1px solid rgba(var(--wrv-accent-rgb),0.3);
            border-radius:6px;
            color:var(--wrv-accent);
            font-size:12px;
            font-weight:500;
            cursor:pointer;
            transition:all 0.15s;
          " onmouseenter="this.style.background='rgba(var(--wrv-accent-rgb),0.25)'" onmouseleave="this.style.background='rgba(var(--wrv-accent-rgb),0.15)'">+ Add Custom Field</button>
        </div>
        <div id="vault-custom-fields" style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
          <!-- Custom fields will be added here -->
        </div>
      </div>
    `
    
    // Add custom field functionality
    const addCustomFieldBtn = dialog.querySelector('#vault-add-custom-field')
    const customFieldsContainer = dialog.querySelector('#vault-custom-fields') as HTMLElement
    
    addCustomFieldBtn?.addEventListener('click', () => {
      const customFieldDiv = document.createElement('div')
      customFieldDiv.style.cssText = 'grid-column:span 2;background:rgba(var(--wrv-accent-rgb),0.04);border:1px solid var(--wrv-border);border-radius:8px;padding:14px;'
      customFieldDiv.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <span style="font-size:11px;color:var(--wrv-text-3);text-transform:uppercase;letter-spacing:0.8px;font-weight:600;">Custom Field</span>
          <button type="button" class="remove-custom-field" style="
            background:var(--wrv-danger-bg);
            border:1px solid var(--wrv-danger-border);
            padding:5px 10px;
            border-radius:6px;
            color:var(--wrv-danger);
            font-size:12px;
            font-weight:500;
            cursor:pointer;
            transition:all 0.15s;
          " onmouseenter="this.style.opacity='0.8'" onmouseleave="this.style.opacity='1'">Remove</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          <div>
            <div style="font-size:11px;color:var(--wrv-text-3);text-transform:uppercase;letter-spacing:0.8px;font-weight:600;margin-bottom:6px;">Field Name *</div>
            <input type="text" class="custom-field-name" placeholder="e.g., License Number" style="
              width:100%;
              padding:10px 14px;
              border:1px solid var(--wrv-border);
              border-radius:8px;
              background:var(--wrv-bg-input);
              color:var(--wrv-text);
              font-size:14px;
              font-weight:500;
              box-sizing:border-box;
              transition:all 0.15s;
            " onfocus="this.style.borderColor='var(--wrv-border-accent)'" onblur="this.style.borderColor='var(--wrv-border)'"/>
          </div>
          <div>
            <div style="font-size:11px;color:var(--wrv-text-3);text-transform:uppercase;letter-spacing:0.8px;font-weight:600;margin-bottom:6px;">Field Value *</div>
            <input type="text" class="custom-field-value" placeholder="Enter the value" style="
              width:100%;
              padding:10px 14px;
              border:1px solid var(--wrv-border);
              border-radius:8px;
              background:var(--wrv-bg-input);
              color:var(--wrv-text);
              font-size:14px;
              font-weight:500;
              box-sizing:border-box;
              transition:all 0.15s;
            " onfocus="this.style.borderColor='var(--wrv-border-accent)'" onblur="this.style.borderColor='var(--wrv-border)'"/>
          </div>
          <div style="grid-column:span 2;">
            <div style="font-size:11px;color:var(--wrv-text-3);text-transform:uppercase;letter-spacing:0.8px;font-weight:600;margin-bottom:6px;">Additional Info</div>
            <div style="font-size:10px;color:var(--wrv-text-3);margin-bottom:6px;font-style:italic;">💡 This information helps AI autofill match this data to forms more accurately</div>
            <textarea class="custom-field-explanation" placeholder="Additional context or notes..." style="
              width:100%;
              padding:10px 14px;
              border:1px solid var(--wrv-border);
              border-radius:8px;
              background:var(--wrv-bg-input);
              color:var(--wrv-text);
              font-size:14px;
              font-weight:500;
              min-height:80px;
              resize:vertical;
              font-family:inherit;
              box-sizing:border-box;
              transition:all 0.2s;
            " onfocus="this.style.borderColor='var(--wrv-border-accent)';this.style.background='var(--wrv-bg-input)'" onblur="this.style.borderColor='var(--wrv-border)';this.style.background='var(--wrv-bg-input)'"></textarea>
          </div>
        </div>
      `
      customFieldsContainer.appendChild(customFieldDiv)
      
      customFieldDiv.querySelector('.remove-custom-field')?.addEventListener('click', () => {
        customFieldDiv.remove()
      })
    })

    // ── Payment Methods section (identity / company only) ──
    const paymentToggle = dialog.querySelector('#vault-payment-toggle')
    const paymentFields = dialog.querySelector('#vault-payment-fields') as HTMLElement | null
    const paymentChevron = dialog.querySelector('#vault-payment-chevron') as SVGElement | null
    const paymentMethodsList = dialog.querySelector('#vault-payment-methods-list') as HTMLElement | null
    const addPaymentMethodBtn = dialog.querySelector('#vault-add-payment-method')

    if (paymentToggle && paymentFields && paymentChevron) {
      let paymentOpen = false
      paymentToggle.addEventListener('click', () => {
        paymentOpen = !paymentOpen
        paymentFields.style.display = paymentOpen ? 'block' : 'none'
        paymentChevron.style.transform = paymentOpen ? 'rotate(90deg)' : 'rotate(0deg)'
      })
    }

    if (addPaymentMethodBtn && paymentMethodsList) {
      let paymentCounter = 0

      const addPaymentEntry = (presetType?: string) => {
        paymentCounter++
        const idx = paymentCounter
        const entry = document.createElement('div')
        entry.className = 'payment-method-entry'
        entry.dataset.paymentIdx = String(idx)
        entry.style.cssText = 'background:var(--wrv-bg-card);border:1px solid var(--wrv-border);border-radius:8px;padding:14px;margin-bottom:10px;'
        entry.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <select class="payment-type-select" style="
              padding:8px 12px;
              border:1px solid var(--wrv-border-accent);
              border-radius:6px;
              background:var(--wrv-bg-input);
              color:var(--wrv-text);
              font-size:13px;
              font-weight:500;
              cursor:pointer;
            ">
              <option value="bank_account"${presetType === 'bank_account' ? ' selected' : ''}>Bank Account (IBAN)</option>
              <option value="credit_card"${presetType === 'credit_card' ? ' selected' : ''}>Credit / Debit Card</option>
              <option value="paypal"${presetType === 'paypal' ? ' selected' : ''}>PayPal</option>
            </select>
            <button type="button" class="remove-payment-method" style="
              background:var(--wrv-danger-bg);
              border:1px solid var(--wrv-danger-border);
              padding:5px 10px;
              border-radius:6px;
              color:var(--wrv-danger);
              font-size:12px;
              font-weight:500;
              cursor:pointer;
              transition:all 0.15s;
            ">Remove</button>
          </div>
          <div class="payment-type-fields" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          </div>
        `
        paymentMethodsList.appendChild(entry)

        const typeSelect = entry.querySelector('.payment-type-select') as HTMLSelectElement
        const fieldsContainer = entry.querySelector('.payment-type-fields') as HTMLElement

        const renderPaymentFields = (type: string) => {
          fieldsContainer.innerHTML = ''
          const inputStyle = `
            width:100%;padding:10px 12px;border:1px solid var(--wrv-border);border-radius:6px;
            background:var(--wrv-bg-input);color:var(--wrv-text);font-size:13px;font-weight:500;
            box-sizing:border-box;transition:all 0.15s;
          `
          const labelStyle = 'display:block;font-size:11px;color:var(--wrv-text-3);text-transform:uppercase;letter-spacing:0.6px;font-weight:600;margin-bottom:4px;'

          if (type === 'bank_account') {
            fieldsContainer.style.gridTemplateColumns = '1fr 1fr'
            fieldsContainer.innerHTML = `
              <div style="grid-column:span 2;">
                <label style="${labelStyle}">IBAN</label>
                <input type="text" class="pay-iban" placeholder="e.g. DE89 3704 0044 0532 0130 00" style="${inputStyle}"/>
              </div>
              <div>
                <label style="${labelStyle}">BIC / SWIFT</label>
                <input type="text" class="pay-bic" placeholder="e.g. COBADEFFXXX" style="${inputStyle}"/>
              </div>
              <div>
                <label style="${labelStyle}">Bank Name</label>
                <input type="text" class="pay-bank-name" placeholder="Bank name" style="${inputStyle}"/>
              </div>
              <div style="grid-column:span 2;">
                <label style="${labelStyle}">Account Holder</label>
                <input type="text" class="pay-account-holder" placeholder="Name on the account" style="${inputStyle}"/>
              </div>
            `
          } else if (type === 'credit_card') {
            fieldsContainer.style.gridTemplateColumns = '1fr 1fr'
            fieldsContainer.innerHTML = `
              <div style="grid-column:span 2;">
                <label style="${labelStyle}">Card Number</label>
                <input type="password" class="pay-cc-number" placeholder="&bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull;" style="${inputStyle}"/>
              </div>
              <div style="grid-column:span 2;">
                <label style="${labelStyle}">Cardholder Name</label>
                <input type="text" class="pay-cc-holder" placeholder="Name on card" style="${inputStyle}"/>
              </div>
              <div>
                <label style="${labelStyle}">Expiry Date</label>
                <input type="text" class="pay-cc-expiry" placeholder="MM/YY" style="${inputStyle}"/>
              </div>
              <div>
                <label style="${labelStyle}">CVV / CVC</label>
                <input type="password" class="pay-cc-cvv" placeholder="&bull;&bull;&bull;" maxlength="4" style="${inputStyle}"/>
              </div>
            `
          } else if (type === 'paypal') {
            fieldsContainer.style.gridTemplateColumns = '1fr'
            fieldsContainer.innerHTML = `
              <div>
                <label style="${labelStyle}">PayPal Email</label>
                <input type="email" class="pay-paypal-email" placeholder="your@email.com" style="${inputStyle}"/>
              </div>
            `
          }
        }

        renderPaymentFields(typeSelect.value)
        typeSelect.addEventListener('change', () => renderPaymentFields(typeSelect.value))
        entry.querySelector('.remove-payment-method')?.addEventListener('click', () => entry.remove())
      }

      addPaymentMethodBtn.addEventListener('click', () => addPaymentEntry())
    }
  }
  
  // Generate form - default to password if no preselected category
  generateForm(defaultCategory)
  
  // Update category select to match default
  categorySelect.value = defaultCategory
  
  categorySelect.addEventListener('change', () => {
    const selectedCategory = categorySelect.value
    if (selectedCategory === 'document') {
      renderDocumentUploadDialog(container)
      return
    }
    if (selectedCategory === 'handshake_context') {
      renderHandshakeContextDialog(container)
      return
    }
    if (selectedCategory) {
      generateForm(selectedCategory)
    }
  })
  
  // Close handlers — restore the vault dashboard
  const closeDialog = () => {
    container.innerHTML = savedContent
    restoreDashboardAfterDialogClose(container)
  }
  
  dialog.querySelector('#vault-add-data-back')?.addEventListener('click', closeDialog)
  dialog.querySelector('#vault-add-data-close')?.addEventListener('click', closeDialog)
  dialog.querySelector('#vault-add-data-cancel')?.addEventListener('click', closeDialog)
  
  // Save handler
  dialog.querySelector('#vault-add-data-save')?.addEventListener('click', async () => {
    const saveBtn = dialog.querySelector('#vault-add-data-save') as HTMLButtonElement
    const originalBtnText = saveBtn.textContent
    
    // Disable button during save
    saveBtn.disabled = true
    saveBtn.style.opacity = '0.6'
    saveBtn.style.cursor = 'not-allowed'
    saveBtn.textContent = 'Saving...'
    
    try {
      // Check vault status before attempting to save
      const status = await vaultAPI.getVaultStatus()
      if (!status.isUnlocked) {
        alert('Vault is locked. Please unlock your vault first.')
        saveBtn.disabled = false
        saveBtn.style.opacity = '1'
        saveBtn.style.cursor = 'pointer'
        saveBtn.textContent = originalBtnText
        return
      }
      
      const category = categorySelect.value
      
      if (!category) {
        alert('Please select a category')
        saveBtn.disabled = false
        saveBtn.style.opacity = '1'
        saveBtn.style.cursor = 'pointer'
        saveBtn.textContent = originalBtnText
        return
      }
      
      let title: string
      
      if (category === 'identity') {
        // For identity, generate title from first_name + surname
        const firstName = (dialog.querySelector('#field-first_name') as HTMLInputElement)?.value.trim()
        const surname = (dialog.querySelector('#field-surname') as HTMLInputElement)?.value.trim()
        
        if (!firstName || !surname) {
          alert('Please enter both first name and surname')
          saveBtn.disabled = false
          saveBtn.style.opacity = '1'
          saveBtn.style.cursor = 'pointer'
          saveBtn.textContent = originalBtnText
          return
        }
        
        title = `${firstName} ${surname}`
      } else {
        title = (dialog.querySelector('#vault-add-title') as HTMLInputElement)?.value.trim()
        
        if (!title) {
          const categoryLabels: Record<string, string> = {
            automation_secret: 'secret name',
            password: 'service name',
            identity: 'identity name',
            company: 'company name',
            custom: 'data group name',
            document: 'document name',
            handshake_context: 'context name'
          }
          alert(`Please enter a ${categoryLabels[category] || 'title'}`)
          saveBtn.disabled = false
          saveBtn.style.opacity = '1'
          saveBtn.style.cursor = 'pointer'
          saveBtn.textContent = originalBtnText
          return
        }
      }
      
      const fields: any[] = []
      
      if (category === 'custom') {
        // Custom Data: collect from field groups
        const customFieldGroupsContainer = dialog.querySelector('#vault-custom-field-groups') as HTMLElement
        customFieldGroupsContainer.querySelectorAll('.remove-custom-field-group').forEach((btn) => {
          const fieldGroupDiv = btn.parentElement?.parentElement
          const nameInput = fieldGroupDiv?.querySelector('.custom-field-name') as HTMLInputElement
          const valueInput = fieldGroupDiv?.querySelector('.custom-field-value') as HTMLInputElement
          const additionalInfoInput = fieldGroupDiv?.querySelector('.custom-field-additional-info') as HTMLTextAreaElement
          
          if (nameInput?.value.trim() && valueInput?.value.trim()) {
            fields.push({
              key: nameInput.value.trim(),
              value: valueInput.value.trim(),
              encrypted: false,
              type: 'text',
              explanation: additionalInfoInput?.value.trim() || undefined
            })
          }
        })
      } else {
        // Standard categories: collect standard fields and custom fields
        let standardFields: StandardFieldDef[] = []
        if (category === 'automation_secret') standardFields = AUTOMATION_SECRET_STANDARD_FIELDS
        else if (category === 'password') standardFields = PASSWORD_STANDARD_FIELDS
        else if (category === 'identity') standardFields = IDENTITY_STANDARD_FIELDS
        else if (category === 'company') standardFields = COMPANY_STANDARD_FIELDS
        
        // Collect standard field values
        standardFields.forEach(field => {
          const input = dialog.querySelector(`#field-${field.key}`) as HTMLInputElement | HTMLTextAreaElement
          if (input && input.value.trim()) {
            fields.push({
              key: field.key,
              value: input.value.trim(),
              encrypted: field.type === 'password',
              type: field.type,
              explanation: field.explanation
            })
          }
        })
        
        // Collect custom fields
        const customFieldsContainer = dialog.querySelector('#vault-custom-fields') as HTMLElement
        if (customFieldsContainer) {
          customFieldsContainer.querySelectorAll('.remove-custom-field').forEach((btn) => {
            const fieldDiv = btn.parentElement?.parentElement
            const nameInput = fieldDiv?.querySelector('.custom-field-name') as HTMLInputElement
            const valueInput = fieldDiv?.querySelector('.custom-field-value') as HTMLInputElement
            const explanationInput = fieldDiv?.querySelector('.custom-field-explanation') as HTMLTextAreaElement
            
            if (nameInput?.value.trim() && valueInput?.value.trim()) {
              fields.push({
                key: nameInput.value.trim(),
                value: valueInput.value.trim(),
                encrypted: false,
                type: 'text',
                explanation: explanationInput?.value.trim() || undefined
              })
            }
          })
        }

        // Collect payment method fields (identity / company)
        const paymentEntries = dialog.querySelectorAll('.payment-method-entry')
        let paymentIdx = 0
        paymentEntries.forEach((entry) => {
          paymentIdx++
          const typeSelect = entry.querySelector('.payment-type-select') as HTMLSelectElement
          const payType = typeSelect?.value || 'bank_account'
          const prefix = paymentIdx > 1 ? `payment_${paymentIdx}_` : 'payment_'

          if (payType === 'bank_account') {
            const iban = (entry.querySelector('.pay-iban') as HTMLInputElement)?.value.trim()
            const bic = (entry.querySelector('.pay-bic') as HTMLInputElement)?.value.trim()
            const bankName = (entry.querySelector('.pay-bank-name') as HTMLInputElement)?.value.trim()
            const holder = (entry.querySelector('.pay-account-holder') as HTMLInputElement)?.value.trim()
            if (iban) fields.push({ key: `${prefix}iban`, value: iban, encrypted: true, type: 'text', explanation: 'IBAN – International Bank Account Number' })
            if (bic) fields.push({ key: `${prefix}bic`, value: bic, encrypted: false, type: 'text', explanation: 'BIC / SWIFT code' })
            if (bankName) fields.push({ key: `${prefix}bank_name`, value: bankName, encrypted: false, type: 'text', explanation: 'Bank or financial institution name' })
            if (holder) fields.push({ key: `${prefix}account_holder`, value: holder, encrypted: false, type: 'text', explanation: 'Name on the bank account' })
          } else if (payType === 'credit_card') {
            const ccNum = (entry.querySelector('.pay-cc-number') as HTMLInputElement)?.value.trim()
            const ccHolder = (entry.querySelector('.pay-cc-holder') as HTMLInputElement)?.value.trim()
            const ccExpiry = (entry.querySelector('.pay-cc-expiry') as HTMLInputElement)?.value.trim()
            const ccCvv = (entry.querySelector('.pay-cc-cvv') as HTMLInputElement)?.value.trim()
            if (ccNum) fields.push({ key: `${prefix}cc_number`, value: ccNum, encrypted: true, type: 'password', explanation: 'Credit / debit card number' })
            if (ccHolder) fields.push({ key: `${prefix}cc_holder`, value: ccHolder, encrypted: false, type: 'text', explanation: 'Cardholder name' })
            if (ccExpiry) fields.push({ key: `${prefix}cc_expiry`, value: ccExpiry, encrypted: true, type: 'text', explanation: 'Card expiry date (MM/YY)' })
            if (ccCvv) fields.push({ key: `${prefix}cc_cvv`, value: ccCvv, encrypted: true, type: 'password', explanation: 'Card verification value (CVV/CVC)' })
          } else if (payType === 'paypal') {
            const ppEmail = (entry.querySelector('.pay-paypal-email') as HTMLInputElement)?.value.trim()
            if (ppEmail) fields.push({ key: `${prefix}paypal_email`, value: ppEmail, encrypted: false, type: 'email', explanation: 'PayPal account email' })
          }
        })
      }
      
      if (fields.length === 0) {
        alert('Please fill in at least one field')
        saveBtn.disabled = false
        saveBtn.style.opacity = '1'
        saveBtn.style.cursor = 'pointer'
        saveBtn.textContent = originalBtnText
        return
      }
      
      // For identity/company: Create container first, then item with container_id
      // For password/custom: Create item directly without container
      let containerId: string | undefined
      if (category === 'identity' || category === 'company') {
        const containerType = category === 'identity' ? 'person' : 'company'
        try {
          console.log('[VAULT UI] Creating container:', containerType, title)
          const container = await vaultAPI.createContainer(containerType, title, false)
          containerId = container.id
          console.log('[VAULT UI] Container created successfully:', containerId)
        } catch (err: any) {
          console.error('[VAULT UI] Error creating container:', err)
          console.error('[VAULT UI] Error stack:', err.stack)
          alert(`Error creating ${category}: ${err.message || err}`)
          saveBtn.disabled = false
          saveBtn.style.opacity = '1'
          saveBtn.style.cursor = 'pointer'
          saveBtn.textContent = originalBtnText
          return
        }
      }
      
      // Create item with fields
      try {
        console.log('[VAULT UI] Creating item:', { category, title, fieldsCount: fields.length, containerId })
        const createdItem = await vaultAPI.createItem({
          container_id: containerId,
          category: category as any,
          title,
          fields,
          domain: category === 'password' ? (dialog.querySelector('#field-url') as HTMLInputElement)?.value.trim() : undefined,
          favorite: false
        })
        console.log('[VAULT UI] Item created successfully:', createdItem.id)
      } catch (err: any) {
        console.error('[VAULT UI] Error creating item:', err)
        console.error('[VAULT UI] Error stack:', err.stack)
        alert(`Error saving data: ${err.message || err}`)
        saveBtn.disabled = false
        saveBtn.style.opacity = '1'
        saveBtn.style.cursor = 'pointer'
        saveBtn.textContent = originalBtnText
        return
      }
      
      // Success - close dialog and show notification
      closeDialog()
      
      // Show success notification
      showSuccessNotification(`Successfully saved ${category === 'password' ? 'password' : category === 'identity' ? 'identity' : category === 'company' ? 'company' : 'data'}!`)
      
      // One-time QSO onboarding dialog on first password entry creation
      if (category === 'password') {
        showQsoOnboardingIfNeeded()
      }
      
      // Store current category view to refresh it
      const listDiv = container.querySelector('#vault-items-list') as HTMLElement
      const currentCategory = listDiv?.getAttribute('data-current-category') || category
      
      // Refresh dashboard and reload containers into tree
      renderVaultDashboard(container)
      
      // Small delay to ensure DOM is ready, then refresh items list
      setTimeout(() => {
        loadContainersIntoTree(container)
        addAddButtonsToTree(container)
        // Refresh the items list with the current category
        loadVaultItems(container, currentCategory)
        // Store current category for next refresh
        const newListDiv = container.querySelector('#vault-items-list') as HTMLElement
        if (newListDiv) {
          newListDiv.setAttribute('data-current-category', category)
        }
      }, 200)
    } catch (err: any) {
      console.error('[VAULT UI] Unexpected error saving data:', err)
      console.error('[VAULT UI] Error stack:', err.stack)
      alert(`Error saving data: ${err.message || err}`)
      saveBtn.disabled = false
      saveBtn.style.opacity = '1'
      saveBtn.style.cursor = 'pointer'
      saveBtn.textContent = originalBtnText
    }
  })
  
}

// Render Edit Data Dialog (similar to Add Data Dialog but pre-filled)
function renderEditDataDialog(container: HTMLElement, item: VaultItem) {
  // Reuse the add dialog function but with pre-filled data
  renderAddDataDialog(container, item.category as any)
  
  // Wait for dialog to be rendered, then fill in the data
  setTimeout(() => {
    const addDialog = document.querySelector('#vault-add-data-overlay') as HTMLElement
    if (!addDialog) return
    
    // Set category (should already be set, but ensure it)
    const categorySelect = addDialog.querySelector('#vault-add-category') as HTMLSelectElement
    if (categorySelect) {
      categorySelect.value = item.category
      categorySelect.dispatchEvent(new Event('change'))
    }
    
    // Fill in title (except for identity which generates from name fields)
    if (item.category !== 'identity') {
      const titleInput = addDialog.querySelector('#vault-add-title') as HTMLInputElement
      if (titleInput) {
        titleInput.value = item.title
      }
    }
    
    // Fill in fields
    item.fields.forEach(field => {
      // Migrate legacy date_of_birth → birth_day/birth_month/birth_year
      if (field.key === 'date_of_birth' && field.value) {
        const parsed = parseDateOfBirth(field.value)
        if (parsed) {
          const daySelect = addDialog.querySelector('#field-birth_day') as HTMLSelectElement
          const monthSelect = addDialog.querySelector('#field-birth_month') as HTMLSelectElement
          const yearSelect = addDialog.querySelector('#field-birth_year') as HTMLSelectElement
          if (daySelect) daySelect.value = String(parsed.day)
          if (monthSelect) monthSelect.value = String(parsed.month)
          if (yearSelect) yearSelect.value = String(parsed.year)
        }
        return
      }

      const input = addDialog.querySelector(`#field-${field.key}`) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      if (input) {
        input.value = field.value || ''
      }
    })
    
    // Update save button to say "Update" and change handler
    const saveBtn = addDialog.querySelector('#vault-add-data-save') as HTMLElement
    if (saveBtn) {
      saveBtn.textContent = 'Update Data'
      
      // Remove old click handler and add new one for update
      const newSaveBtn = saveBtn.cloneNode(true) as HTMLElement
      saveBtn.parentNode?.replaceChild(newSaveBtn, saveBtn)
      
      newSaveBtn.addEventListener('click', async () => {
        const category = categorySelect.value
        
        let title: string
        if (category === 'identity') {
          const firstName = (addDialog.querySelector('#field-first_name') as HTMLInputElement)?.value.trim()
          const surname = (addDialog.querySelector('#field-surname') as HTMLInputElement)?.value.trim()
          if (!firstName || !surname) {
            alert('Please enter both first name and surname')
            return
          }
          title = `${firstName} ${surname}`
        } else {
          title = (addDialog.querySelector('#vault-add-title') as HTMLInputElement)?.value.trim()
          if (!title) {
            alert('Please enter a title')
            return
          }
        }
        
        try {
          const fields: any[] = []
          
          // Collect standard fields
          let standardFields: StandardFieldDef[] = []
          if (category === 'password') standardFields = PASSWORD_STANDARD_FIELDS
          else if (category === 'identity') standardFields = IDENTITY_STANDARD_FIELDS
          else if (category === 'company') standardFields = COMPANY_STANDARD_FIELDS
          
          standardFields.forEach(field => {
            const input = addDialog.querySelector(`#field-${field.key}`) as HTMLInputElement | HTMLTextAreaElement
            if (input && input.value.trim()) {
              fields.push({
                key: field.key,
                value: input.value.trim(),
                encrypted: field.type === 'password',
                type: field.type,
                explanation: field.explanation
              })
            }
          })
          
          // Collect custom fields
          const customFieldsContainer = addDialog.querySelector('#vault-custom-fields') as HTMLElement
          if (customFieldsContainer) {
            customFieldsContainer.querySelectorAll('.remove-custom-field').forEach((btn) => {
              const fieldDiv = btn.parentElement?.parentElement
              const nameInput = fieldDiv?.querySelector('.custom-field-name') as HTMLInputElement
              const valueInput = fieldDiv?.querySelector('.custom-field-value') as HTMLInputElement
              const explanationInput = fieldDiv?.querySelector('.custom-field-explanation') as HTMLTextAreaElement
              
              if (nameInput?.value.trim() && valueInput?.value.trim()) {
                fields.push({
                  key: nameInput.value.trim(),
                  value: valueInput.value.trim(),
                  encrypted: false,
                  type: 'text',
                  explanation: explanationInput?.value.trim() || undefined
                })
              }
            })
          }
          
          if (fields.length === 0) {
            alert('Please fill in at least one field')
            return
          }
          
          // Update item
          await vaultAPI.updateItem(item.id, {
            title,
            fields,
            domain: category === 'password' ? (addDialog.querySelector('#field-url') as HTMLInputElement)?.value.trim() : undefined
          })
          
          // Restore dashboard and refresh
          
          // Refresh the view
          if (item.container_id) {
            loadContainerItems(container, item.container_id)
          } else {
            loadVaultItems(container, item.category)
          }
          loadContainersIntoTree(container)
          addAddButtonsToTree(container)
        } catch (err: any) {
          alert(`Error updating data: ${err.message || err}`)
          console.error('[VAULT UI] Error updating data:', err)
        }
      })
    }
  }, 100)
}

/**
 * Parse a legacy date_of_birth string into day/month/year components.
 * Supports: DD.MM.YYYY, DD/MM/YYYY, YYYY-MM-DD, MM/DD/YYYY (US)
 */
function parseDateOfBirth(value: string): { day: number; month: number; year: number } | null {
  const trimmed = value.trim()

  // YYYY-MM-DD (ISO)
  let m = trimmed.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/)
  if (m) return { year: parseInt(m[1]), month: parseInt(m[2]), day: parseInt(m[3]) }

  // DD.MM.YYYY or DD/MM/YYYY (European)
  m = trimmed.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/)
  if (m) return { day: parseInt(m[1]), month: parseInt(m[2]), year: parseInt(m[3]) }

  return null
}

// Helper function to escape HTML
function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// Show success notification
function showSuccessNotification(message: string) {
  const notification = document.createElement('div')
  notification.style.cssText = `
    position:fixed;
    top:20px;
    right:20px;
    background:linear-gradient(135deg, rgba(34,197,94,0.95) 0%, rgba(22,163,74,0.95) 100%);
    color:var(--wrv-text);
    padding:16px 24px;
    border-radius:12px;
    box-shadow:0 10px 30px rgba(34,197,94,0.4);
    z-index:2147483652;
    font-size:14px;
    font-weight:600;
    display:flex;
    align-items:center;
    gap:12px;
    animation:slideIn 0.3s ease-out;
    border:1px solid rgba(34,197,94,0.5);
  `
  notification.innerHTML = `
    <span style="font-size:20px;">✓</span>
    <span>${escapeHtml(message)}</span>
  `
  
  // Add animation
  const style = document.createElement('style')
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    @keyframes slideOut {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(100%);
        opacity: 0;
      }
    }
  `
  document.head.appendChild(style)
  
  document.body.appendChild(notification)
  
  // Auto-remove after 3 seconds
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-out'
    setTimeout(() => {
      notification.remove()
      style.remove()
    }, 300)
  }, 3000)
}

function renderSettingsScreen(container: HTMLElement) {
  container.innerHTML = `
    <div style="max-width:600px;margin:40px auto;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:32px;">
        <button id="settings-back-btn" style="background:var(--wrv-bg-card);border:1px solid var(--wrv-border);padding:8px 16px;border-radius:8px;color:var(--wrv-text);cursor:pointer;">← Back</button>
        <h2 style="font-size:24px;font-weight:700;color:var(--wrv-text);">Settings</h2>
      </div>

      <div style="background:rgba(var(--wrv-accent-rgb),0.04);border:1px solid rgba(var(--wrv-accent-rgb),0.15);border-radius:12px;padding:24px;margin-bottom:16px;">
        <h3 style="font-size:16px;font-weight:600;margin-bottom:16px;color:var(--wrv-text);">Autolock Settings</h3>
        <label style="display:block;font-size:13px;color:var(--wrv-text-2);margin-bottom:8px;">Lock vault after inactivity:</label>
        <select id="autolock-select" style="width:100%;min-height:44px;padding:12px 16px;padding-right:40px;background:var(--wrv-bg-card);border:1px solid var(--wrv-border-accent);border-radius:8px;color:var(--wrv-text);font-size:14px;cursor:pointer;box-sizing:border-box;display:block;visibility:visible;opacity:1;appearance:none;-webkit-appearance:none;-moz-appearance:none;background-image:url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"12\" height=\"12\" viewBox=\"0 0 12 12\"><path fill=\"%23888\" d=\"M6 9L1 4h10z\"/></svg>');background-repeat:no-repeat;background-position:right 12px center;">
          <option value="0">Loading...</option>
        </select>
      </div>

      <div id="autofill-settings-section" style="background:rgba(var(--wrv-accent-rgb),0.04);border:1px solid rgba(var(--wrv-accent-rgb),0.15);border-radius:12px;padding:24px;margin-bottom:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <div>
            <h3 style="font-size:16px;font-weight:600;color:var(--wrv-text);margin:0;">Quick Sign-On (QSO)</h3>
            <p style="font-size:12px;color:var(--wrv-text-3);margin:4px 0 0 0;">Show autofill icons on form fields for one-click sign-on</p>
          </div>
          <label style="position:relative;display:inline-block;width:44px;height:24px;flex-shrink:0;">
            <input type="checkbox" id="autofill-global-toggle" style="opacity:0;width:0;height:0;">
            <span id="autofill-global-slider" style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:var(--wrv-bg-input);border:1px solid var(--wrv-border-accent);border-radius:24px;transition:all 0.25s;"></span>
          </label>
        </div>

        <div id="autofill-section-toggles" style="display:flex;flex-direction:column;gap:10px;padding-left:4px;">
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
            <input type="checkbox" id="autofill-toggle-login" style="width:16px;height:16px;accent-color:var(--wrv-accent);cursor:pointer;">
            <div>
              <span style="font-size:13px;color:var(--wrv-text);">Login autofill</span>
              <span style="display:block;font-size:11px;color:var(--wrv-text-3);">Username, email, password</span>
            </div>
          </label>

          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
            <input type="checkbox" id="autofill-toggle-identity" style="width:16px;height:16px;accent-color:var(--wrv-accent);cursor:pointer;">
            <div>
              <span style="font-size:13px;color:var(--wrv-text);">Identity autofill</span>
              <span style="display:block;font-size:11px;color:var(--wrv-text-3);">Name, address, phone, birthday</span>
            </div>
          </label>

          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
            <input type="checkbox" id="autofill-toggle-company" style="width:16px;height:16px;accent-color:var(--wrv-accent);cursor:pointer;">
            <div>
              <span style="font-size:13px;color:var(--wrv-text);">Company autofill</span>
              <span style="display:block;font-size:11px;color:var(--wrv-text-3);">Company name, VAT, HRB, IBAN</span>
            </div>
          </label>

          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
            <input type="checkbox" id="autofill-toggle-custom" style="width:16px;height:16px;accent-color:var(--wrv-accent);cursor:pointer;">
            <div>
              <span style="font-size:13px;color:var(--wrv-text);">Custom fields</span>
              <span style="display:block;font-size:11px;color:var(--wrv-text-3);">Tagged custom entries</span>
            </div>
          </label>
        </div>

        <p id="autofill-status-msg" style="font-size:11px;color:var(--wrv-text-3);margin:12px 0 0 0;min-height:16px;"></p>
      </div>

      <div style="background:rgba(var(--wrv-accent-rgb),0.04);border:1px solid rgba(var(--wrv-accent-rgb),0.15);border-radius:12px;padding:24px;margin-bottom:16px;">
        <h3 style="font-size:16px;font-weight:600;margin-bottom:12px;color:var(--wrv-text);">Export & Backup</h3>
        <p style="font-size:13px;color:var(--wrv-text-2);margin-bottom:16px;">Export your vault data to a CSV file for backup purposes.</p>
        <button id="export-btn" style="padding:12px 24px;background:rgba(var(--wrv-accent-rgb),0.20);border:1px solid rgba(var(--wrv-accent-rgb),0.35);border-radius:8px;color:var(--wrv-text);font-size:14px;cursor:pointer;transition:all 0.2s;">📥 Export to CSV</button>
      </div>

      <div style="background:rgba(255,59,48,0.05);border:1px solid var(--wrv-danger-bg);border-radius:12px;padding:24px;">
        <h3 style="font-size:16px;font-weight:600;margin-bottom:12px;color:var(--wrv-danger);">Danger Zone</h3>
        <p style="font-size:13px;color:var(--wrv-text-2);margin-bottom:16px;">Permanently delete your vault and all stored data. This action cannot be undone.</p>
        <button id="delete-vault-btn" style="padding:12px 24px;background:var(--wrv-danger-bg);border:1px solid var(--wrv-danger-bg);border-radius:8px;color:var(--wrv-danger);font-size:14px;font-weight:600;cursor:pointer;transition:all 0.2s;">🗑️ Delete Vault</button>
      </div>
    </div>
  `

  container.querySelector('#settings-back-btn')?.addEventListener('click', () => {
    renderVaultDashboard(container)
  })

  // Populate autolock select options and load current settings
  const select = container.querySelector('#autolock-select') as HTMLSelectElement
  if (select) {
    // Clear loading option and populate with all options
    select.innerHTML = ''
    const options = [
      { value: '0', label: 'Never' },
      { value: '15', label: '15 minutes' },
      { value: '30', label: '30 minutes' },
      { value: '60', label: '1 hour' },
      { value: '180', label: '3 hours' },
      { value: '720', label: '12 hours' },
      { value: '1440', label: '24 hours' },
      { value: '10080', label: '1 week' },
      { value: '43200', label: '1 month' },
    ]
    
    options.forEach(opt => {
      const option = document.createElement('option')
      option.value = opt.value
      option.textContent = opt.label
      select.appendChild(option)
    })
    
    // Load current settings
    const loadAutolockSettings = async () => {
      try {
        const settings = await vaultAPI.getSettings()
        const currentMinutes = settings.autoLockMinutes || 0
        select.value = currentMinutes.toString()
      } catch (err) {
        console.error('[VAULT] Error loading autolock settings:', err)
        // Default to "Never" if settings can't be loaded
        select.value = '0'
      }
    }
    
    loadAutolockSettings()
    
    // Save autolock settings when changed
    select.addEventListener('change', async (e) => {
      const selectEl = e.target as HTMLSelectElement
      const minutes = parseInt(selectEl.value, 10)
      try {
        await vaultAPI.updateSettings({ autoLockMinutes: minutes })
        console.log('[VAULT] Autolock settings updated:', minutes === 0 ? 'Never' : `${minutes} minutes`)
      } catch (err: any) {
        console.error('[VAULT] Error updating autolock settings:', err)
        alert(`Failed to save autolock settings: ${err.message || err}`)
        // Revert selection
        await loadAutolockSettings()
      }
    })
  }

  // ── Autofill toggle wiring ──
  const globalToggle = container.querySelector('#autofill-global-toggle') as HTMLInputElement
  const globalSlider = container.querySelector('#autofill-global-slider') as HTMLElement
  const sectionTogglesEl = container.querySelector('#autofill-section-toggles') as HTMLElement
  const loginToggle = container.querySelector('#autofill-toggle-login') as HTMLInputElement
  const identityToggle = container.querySelector('#autofill-toggle-identity') as HTMLInputElement
  const companyToggle = container.querySelector('#autofill-toggle-company') as HTMLInputElement
  const customToggle = container.querySelector('#autofill-toggle-custom') as HTMLInputElement
  const statusMsg = container.querySelector('#autofill-status-msg') as HTMLElement

  function updateSliderVisual(checked: boolean) {
    if (!globalSlider) return
    if (checked) {
      globalSlider.style.background = `rgba(var(--wrv-accent-rgb),0.6)`
      globalSlider.style.setProperty('--dot-left', '22px')
    } else {
      globalSlider.style.background = 'var(--wrv-bg-input)'
      globalSlider.style.setProperty('--dot-left', '2px')
    }
    // The slider dot is rendered via ::after, but since this is inline,
    // we create/update a child element for the toggle knob.
    let dot = globalSlider.querySelector('.wrv-toggle-dot') as HTMLElement
    if (!dot) {
      dot = document.createElement('span')
      dot.className = 'wrv-toggle-dot'
      dot.style.cssText = 'position:absolute;top:2px;width:18px;height:18px;background:#fff;border-radius:50%;transition:left 0.25s;box-shadow:0 1px 3px rgba(0,0,0,0.3);'
      globalSlider.appendChild(dot)
    }
    dot.style.left = checked ? '22px' : '2px'
  }

  function updateSectionDisabledState(globalEnabled: boolean) {
    if (!sectionTogglesEl) return
    sectionTogglesEl.style.opacity = globalEnabled ? '1' : '0.4'
    sectionTogglesEl.style.pointerEvents = globalEnabled ? 'auto' : 'none'
  }

  function showStatus(msg: string) {
    if (statusMsg) {
      statusMsg.textContent = msg
      setTimeout(() => { if (statusMsg) statusMsg.textContent = '' }, 2500)
    }
  }

  // Load current autofill settings
  const loadAutofillSettings = async () => {
    try {
      const settings = await vaultAPI.getSettings()
      // Safe defaults: if fields are missing (old vault), treat as ON
      const enabled = settings.autofillEnabled ?? true
      const sections = settings.autofillSections ?? { login: true, identity: true, company: true, custom: true }

      if (globalToggle) globalToggle.checked = enabled
      updateSliderVisual(enabled)
      updateSectionDisabledState(enabled)

      if (loginToggle) loginToggle.checked = sections.login ?? true
      if (identityToggle) identityToggle.checked = sections.identity ?? true
      if (companyToggle) companyToggle.checked = sections.company ?? true
      if (customToggle) customToggle.checked = sections.custom ?? true
    } catch (err) {
      console.error('[VAULT] Error loading autofill settings:', err)
      // Default: everything ON (safe default)
      if (globalToggle) globalToggle.checked = true
      updateSliderVisual(true)
      updateSectionDisabledState(true)
      if (loginToggle) loginToggle.checked = true
      if (identityToggle) identityToggle.checked = true
      if (companyToggle) companyToggle.checked = true
      if (customToggle) customToggle.checked = true
    }
  }

  loadAutofillSettings()

  // Global toggle handler
  globalToggle?.addEventListener('change', async () => {
    const enabled = globalToggle.checked
    updateSliderVisual(enabled)
    updateSectionDisabledState(enabled)
    try {
      await vaultAPI.updateSettings({ autofillEnabled: enabled } as any)
      showStatus(enabled ? 'Quick Sign-On enabled' : 'Quick Sign-On disabled')
      console.log('[VAULT] Autofill global toggle:', enabled)
    } catch (err: any) {
      console.error('[VAULT] Error updating autofill toggle:', err)
      globalToggle.checked = !enabled
      updateSliderVisual(!enabled)
      updateSectionDisabledState(!enabled)
      showStatus('Failed to save — please try again')
    }
  })

  // Section toggle handler factory
  const handleSectionToggle = (section: string, checkbox: HTMLInputElement | null) => {
    checkbox?.addEventListener('change', async () => {
      try {
        await vaultAPI.updateSettings({ autofillSections: { [section]: checkbox.checked } } as any)
        const label = section.charAt(0).toUpperCase() + section.slice(1)
        showStatus(`${label} autofill ${checkbox.checked ? 'enabled' : 'disabled'}`)
        console.log(`[VAULT] Autofill section toggle [${section}]:`, checkbox.checked)
      } catch (err: any) {
        console.error(`[VAULT] Error updating ${section} toggle:`, err)
        checkbox.checked = !checkbox.checked
        showStatus('Failed to save — please try again')
      }
    })
  }

  handleSectionToggle('login', loginToggle)
  handleSectionToggle('identity', identityToggle)
  handleSectionToggle('company', companyToggle)
  handleSectionToggle('custom', customToggle)

  container.querySelector('#export-btn')?.addEventListener('click', async () => {
    alert('Export functionality - TODO: Will export vault data to CSV')
  })

  container.querySelector('#delete-vault-btn')?.addEventListener('click', async () => {
    if (confirm('⚠️ WARNING: This will permanently DELETE the vault and all its data. This cannot be undone.\n\nAre you sure you want to delete the vault?')) {
      const deleteBtn = container.querySelector('#delete-vault-btn') as HTMLButtonElement
      try {
        deleteBtn.textContent = 'Deleting...'
        deleteBtn.disabled = true
        await vaultAPI.deleteVault()
        // Reload UI - vault no longer exists, show create screen
        initVaultUI(container)
      } catch (err: any) {
        alert(`❌ Failed to delete vault: ${err.message || err}`)
        deleteBtn.textContent = '🗑️ Delete Vault'
        deleteBtn.disabled = false
      }
    }
  })
}


// ============================================================================
// QSO Onboarding Dialog — shown once on first password entry creation
// ============================================================================

const QSO_ONBOARDING_KEY = 'wrv_qso_onboarding_seen'
const QSO_AUTO_CONSENT_KEY = 'wrv_qso_auto_consent'

function loadOnboardingSeen(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve(false)
      return
    }
    chrome.storage.local.get(QSO_ONBOARDING_KEY, (result) => {
      resolve(result[QSO_ONBOARDING_KEY] === true)
    })
  })
}

function saveOnboardingSeen(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve()
      return
    }
    chrome.storage.local.set({ [QSO_ONBOARDING_KEY]: true }, () => resolve())
  })
}

function saveAutoConsent(enabled: boolean): Promise<void> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve()
      return
    }
    chrome.storage.local.set({ [QSO_AUTO_CONSENT_KEY]: enabled }, () => resolve())
  })
}

function loadAutoConsentForVault(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve(false)
      return
    }
    chrome.storage.local.get(QSO_AUTO_CONSENT_KEY, (result) => {
      resolve(result[QSO_AUTO_CONSENT_KEY] === true)
    })
  })
}

/**
 * Consent dialog shown from the vault header when toggling to Auto mode.
 * Same design as the popover consent dialog — full-page Shadow DOM overlay.
 */
function showVaultAutoConsentDialog(): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    host.setAttribute('data-wrv-vault-consent-host', '')
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483655;pointer-events:auto;'

    const shadow = host.attachShadow({ mode: 'closed' })

    const style = document.createElement('style')
    style.textContent = `
      :host { all: initial; display: block; }
      .wrv-vc-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      }
      .wrv-vc-dialog {
        background: #ffffff;
        border-radius: 12px;
        padding: 28px;
        max-width: 400px;
        width: 90%;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
        text-align: center;
      }
      .wrv-vc-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: #22c55e;
        color: #fff;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.5px;
        padding: 3px 8px;
        border-radius: 5px;
        margin-bottom: 14px;
      }
      .wrv-vc-title {
        font-size: 18px;
        font-weight: 700;
        color: #1e293b;
        margin-bottom: 12px;
      }
      .wrv-vc-body {
        font-size: 13px;
        line-height: 1.6;
        color: #475569;
        margin-bottom: 20px;
        text-align: left;
      }
      .wrv-vc-body strong {
        color: #1e293b;
      }
      .wrv-vc-actions {
        display: flex;
        gap: 10px;
        justify-content: center;
      }
      .wrv-vc-btn {
        padding: 10px 20px;
        border-radius: 8px;
        border: none;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s ease, transform 0.1s ease;
      }
      .wrv-vc-btn:active {
        transform: scale(0.96);
      }
      .wrv-vc-btn--cancel {
        background: #f1f5f9;
        color: #64748b;
      }
      .wrv-vc-btn--cancel:hover {
        background: #e2e8f0;
      }
      .wrv-vc-btn--accept {
        background: #22c55e;
        color: #ffffff;
      }
      .wrv-vc-btn--accept:hover {
        background: #16a34a;
      }
    `
    shadow.appendChild(style)

    const overlay = document.createElement('div')
    overlay.className = 'wrv-vc-overlay'
    overlay.innerHTML = `
      <div class="wrv-vc-dialog">
        <div class="wrv-vc-badge">QSO</div>
        <div class="wrv-vc-title">Enable QSO Auto Mode</div>
        <div class="wrv-vc-body">
          By enabling <strong>Auto</strong> mode, you consent to 1-click
          Quick Sign-On (QSO). When a matching credential is found, the
          QSO button will auto-fill your username and password and
          automatically click the login button — no extra confirmation needed.
          <br><br>
          This is a <strong>global setting</strong> that stays active across all
          sites until you switch back to Manual.
        </div>
        <div class="wrv-vc-actions">
          <button class="wrv-vc-btn wrv-vc-btn--cancel" type="button">Cancel</button>
          <button class="wrv-vc-btn wrv-vc-btn--accept" type="button">Enable Auto QSO</button>
        </div>
      </div>
    `

    const cleanup = () => { try { host.remove() } catch { /* noop */ } }

    overlay.querySelector('.wrv-vc-btn--cancel')?.addEventListener('click', () => {
      cleanup()
      resolve(false)
    })
    overlay.querySelector('.wrv-vc-btn--accept')?.addEventListener('click', () => {
      cleanup()
      resolve(true)
    })

    shadow.appendChild(overlay)
    document.documentElement.appendChild(host)
  })
}

/**
 * Show the QSO onboarding dialog if this is the first password entry
 * the user has ever created. The dialog explains Manual vs Auto mode
 * and offers to enable Auto (QSO) immediately.
 *
 * Shown at most once; persisted via `wrv_qso_onboarding_seen`.
 */
async function showQsoOnboardingIfNeeded(): Promise<void> {
  try {
    const alreadySeen = await loadOnboardingSeen()
    if (alreadySeen) return
    
    const userChoice = await showQsoOnboardingDialog()
    
    await saveOnboardingSeen()
    
    if (userChoice === 'auto') {
      await saveAutoConsent(true)
    }
  } catch {
    // Non-fatal — don't block the save flow
  }
}

function showQsoOnboardingDialog(): Promise<'auto' | 'manual'> {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    host.setAttribute('data-wrv-onboarding-host', '')
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483655;pointer-events:auto;'

    const shadow = host.attachShadow({ mode: 'closed' })

    const style = document.createElement('style')
    style.textContent = `
      :host { all: initial; display: block; }
      .wrv-onboard-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      }
      .wrv-onboard-dialog {
        background: #ffffff;
        border-radius: 14px;
        padding: 32px;
        max-width: 420px;
        width: 90%;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.25);
        text-align: center;
      }
      .wrv-onboard-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: #22c55e;
        color: #fff;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.5px;
        padding: 4px 10px;
        border-radius: 6px;
        margin-bottom: 16px;
      }
      .wrv-onboard-title {
        font-size: 20px;
        font-weight: 700;
        color: #1e293b;
        margin-bottom: 8px;
      }
      .wrv-onboard-subtitle {
        font-size: 13px;
        color: #64748b;
        margin-bottom: 20px;
      }
      .wrv-onboard-modes {
        display: flex;
        flex-direction: column;
        gap: 12px;
        text-align: left;
        margin-bottom: 24px;
      }
      .wrv-onboard-mode {
        padding: 14px 16px;
        border-radius: 10px;
        border: 1px solid #e2e8f0;
        background: #f8fafc;
      }
      .wrv-onboard-mode-label {
        font-size: 14px;
        font-weight: 600;
        color: #1e293b;
        margin-bottom: 4px;
      }
      .wrv-onboard-mode-desc {
        font-size: 12px;
        color: #64748b;
        line-height: 1.5;
      }
      .wrv-onboard-note {
        font-size: 11px;
        color: #94a3b8;
        margin-bottom: 20px;
      }
      .wrv-onboard-actions {
        display: flex;
        gap: 10px;
        justify-content: center;
      }
      .wrv-onboard-btn {
        padding: 11px 22px;
        border-radius: 8px;
        border: none;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s ease, transform 0.1s ease;
      }
      .wrv-onboard-btn:active {
        transform: scale(0.96);
      }
      .wrv-onboard-btn--manual {
        background: #f1f5f9;
        color: #475569;
      }
      .wrv-onboard-btn--manual:hover {
        background: #e2e8f0;
      }
      .wrv-onboard-btn--auto {
        background: #22c55e;
        color: #ffffff;
      }
      .wrv-onboard-btn--auto:hover {
        background: #16a34a;
      }
    `
    shadow.appendChild(style)

    const overlay = document.createElement('div')
    overlay.className = 'wrv-onboard-overlay'
    overlay.innerHTML = `
      <div class="wrv-onboard-dialog">
        <div class="wrv-onboard-badge">QSO</div>
        <div class="wrv-onboard-title">Quick Sign-On (QSO)</div>
        <div class="wrv-onboard-subtitle">Choose how WR Vault fills your credentials</div>
        <div class="wrv-onboard-modes">
          <div class="wrv-onboard-mode">
            <div class="wrv-onboard-mode-label">Manual Mode</div>
            <div class="wrv-onboard-mode-desc">
              One click fills your credentials into the login form.
              You click the site's Login button yourself.
            </div>
          </div>
          <div class="wrv-onboard-mode">
            <div class="wrv-onboard-mode-label">Auto Mode (QSO)</div>
            <div class="wrv-onboard-mode-desc">
              One click fills your credentials and automatically clicks
              Login for you — only on verified pages with security checks.
            </div>
          </div>
        </div>
        <div class="wrv-onboard-note">You can change this anytime in the popover settings.</div>
        <div class="wrv-onboard-actions">
          <button class="wrv-onboard-btn wrv-onboard-btn--manual" type="button">Keep Manual</button>
          <button class="wrv-onboard-btn wrv-onboard-btn--auto" type="button">Enable Auto (QSO)</button>
        </div>
      </div>
    `

    const cleanup = () => { try { host.remove() } catch { /* noop */ } }

    overlay.querySelector('.wrv-onboard-btn--manual')?.addEventListener('click', () => {
      cleanup()
      resolve('manual')
    })
    overlay.querySelector('.wrv-onboard-btn--auto')?.addEventListener('click', () => {
      cleanup()
      resolve('auto')
    })

    shadow.appendChild(overlay)
    document.documentElement.appendChild(host)
  })
}
