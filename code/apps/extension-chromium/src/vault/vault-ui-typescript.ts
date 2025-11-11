/**
 * Pure TypeScript Vault UI - No React dependencies
 * Professional black design for WRVault password manager
 */

import * as vaultAPI from './api'
import type { VaultItem, VaultStatus, Container, CategoryNode, StandardFieldDef } from './types'
import { IDENTITY_STANDARD_FIELDS, COMPANY_STANDARD_FIELDS, BUSINESS_STANDARD_FIELDS, PASSWORD_STANDARD_FIELDS } from './types'

// Connect to vault on module load
let connectionPromise: Promise<void> | null = null

function ensureConnected(): Promise<void> {
  if (!connectionPromise) {
    connectionPromise = vaultAPI.connectVault()
  }
  return connectionPromise
}

export function openVaultLightbox() {
  const overlay = document.createElement('div')
  overlay.id = 'wrvault-overlay'
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:2147483649;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px)`

  const container = document.createElement('div')
  container.id = 'wrvault-container'
  container.style.cssText = `
    background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%);
    border-radius: 20px;
    width: 90vw;
    max-width: 1000px;
    height: 85vh;
    color: white;
    overflow: hidden;
    box-shadow: 0 25px 50px rgba(139, 92, 246, 0.3), 0 0 100px rgba(0,0,0,0.8);
    display: flex;
    flex-direction: column;
    border: 1px solid rgba(139, 92, 246, 0.4);
  `

  // Header
  const header = document.createElement('div')
  header.style.cssText = `
    padding: 20px 24px;
    background: linear-gradient(90deg, rgba(139, 92, 246, 0.15) 0%, rgba(0,0,0,0.2) 100%);
    border-bottom: 1px solid rgba(139, 92, 246, 0.3);
    display: flex;
    align-items: center;
    justify-content: space-between;
  `
  header.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;">
      <div style="font-size:28px;">🔒</div>
      <div>
        <div style="font-size:20px;font-weight:700;color:#fff;">WRVault</div>
        <div style="font-size:11px;color:rgba(139, 92, 246, 0.9);font-weight:500;">Secure Password Manager</div>
      </div>
    </div>
    <button id="wrv-close" style="
      background: rgba(255,59,48,0.2);
      border: 1px solid rgba(255,59,48,0.4);
      color: #fff;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      cursor: pointer;
      font-size: 20px;
      transition: all 0.2s;
    ">×</button>
  `

  // Main content area
  const mainContent = document.createElement('div')
  mainContent.id = 'vault-main-content'
  mainContent.style.cssText = `
    flex: 1;
    overflow-y: auto;
    padding: 24px;
    background: #0f0f0f;
  `

  container.appendChild(header)
  container.appendChild(mainContent)
  overlay.appendChild(container)

  // Close button handler
  const closeBtn = header.querySelector('#wrv-close') as HTMLElement
  closeBtn?.addEventListener('mouseenter', () => {
    closeBtn.style.background = 'rgba(255,59,48,0.4)'
    closeBtn.style.transform = 'scale(1.1)'
  })
  closeBtn?.addEventListener('mouseleave', () => {
    closeBtn.style.background = 'rgba(255,59,48,0.2)'
    closeBtn.style.transform = 'scale(1)'
  })
  closeBtn?.addEventListener('click', () => {
    overlay.remove()
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
        <div style="font-size:18px;font-weight:600;margin-bottom:8px;color:#fff;">Cannot Connect to Vault</div>
        <div style="font-size:14px;color:rgba(255,255,255,0.6);margin-bottom:24px;">
          Please ensure the Electron app is running and try again.
        </div>
        
        <div style="font-size:12px;color:rgba(255,255,255,0.4);font-family:monospace;white-space:pre-wrap;text-align:left;max-width:800px;margin:0 auto 20px;background:rgba(0,0,0,0.3);padding:16px;border-radius:8px;border:1px solid rgba(255,59,48,0.3);">
          <strong style="color:#ff3b30;">Error:</strong> ${err.message || err}
          ${err.stack ? '\n\n<strong>Stack:</strong>\n' + err.stack : ''}
        </div>
        
        <div style="max-width:800px;margin:0 auto;">
          <button id="vault-retry-connection" style="
            margin-bottom:20px;
            padding:12px 24px;
            background:linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%);
            border:none;
            border-radius:8px;
            color:#fff;
            font-size:15px;
            font-weight:600;
            cursor:pointer;
            transition:all 0.2s;
          ">🔄 Retry Connection</button>
          
          <details style="text-align:left;background:rgba(0,0,0,0.4);border-radius:8px;padding:16px;border:1px solid rgba(139,92,246,0.3);">
            <summary style="cursor:pointer;font-weight:600;color:#a78bfa;margin-bottom:12px;user-select:none;">📋 Debug Logs (Click to expand)</summary>
            <div style="font-size:11px;color:rgba(255,255,255,0.7);font-family:monospace;white-space:pre-wrap;max-height:400px;overflow-y:auto;padding:12px;background:rgba(0,0,0,0.3);border-radius:4px;margin-top:12px;">
              ${logsText || 'No debug logs available'}
            </div>
            <button onclick="navigator.clipboard.writeText(\`Error: ${(err.message || err).replace(/`/g, '\\`')}\n\nStack:\n${(err.stack || '').replace(/`/g, '\\`')}\n\nDebug Logs:\n${logsText.replace(/`/g, '\\`')}\`)" style="margin-top:12px;padding:8px 16px;background:#8b5cf6;border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:12px;">📋 Copy All Logs</button>
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
  container.innerHTML = `
    <div style="max-width:580px;margin:40px auto;text-align:center;">
      <div style="font-size:64px;margin-bottom:24px;">🔐</div>
      <h2 style="font-size:28px;font-weight:700;margin-bottom:12px;color:#fff;">Create Your Local Vault</h2>
      <p style="font-size:14px;color:rgba(255,255,255,0.7);margin-bottom:32px;">
        Establish a secure, locally-encrypted password manager for your sensitive credentials and personal data
      </p>
      
      <!-- CRITICAL SECURITY WARNING -->
      <div style="background:rgba(139, 92, 246,0.15);border:2px solid rgba(139, 92, 246,0.5);border-radius:12px;padding:20px;margin-bottom:24px;text-align:left;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
          <div style="font-size:32px;">⚠️</div>
          <div style="font-size:18px;font-weight:700;color:#a78bfa;">CRITICAL SECURITY NOTICE</div>
        </div>
        <ul style="margin:0;padding-left:20px;font-size:13px;color:rgba(255,255,255,0.9);line-height:1.8;">
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
        <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.85);line-height:1.7;">
          Your vault data can be exported as an encrypted CSV file for secure backup purposes. We recommend storing backups on encrypted external storage (e.g., VeraCrypt container on an external SSD) to maintain an air-gapped recovery option. Regular exports ensure data redundancy independent of the master password.
        </p>
      </div>
      
      <div style="background:rgba(139, 92, 246,0.05);border:1px solid rgba(139, 92, 246,0.2);border-radius:12px;padding:32px;text-align:left;">
        <label style="display:block;font-size:13px;font-weight:600;margin-bottom:8px;color:rgba(255,255,255,0.9);">
          Vault Name <span style="color:#ff3b30;">*</span>
        </label>
        <input type="text" id="vault-create-name" placeholder="e.g., Personal Vault, Work Vault" style="
          width:100%;
          padding:14px 16px;
          border:1px solid rgba(139, 92, 246,0.4);
          border-radius:8px;
          background:rgba(0,0,0,0.4);
          color:#fff;
          font-size:15px;
          margin-bottom:24px;
        "/>
        
        <label style="display:block;font-size:13px;font-weight:600;margin-bottom:8px;color:rgba(255,255,255,0.9);">
          Master Password <span style="color:#ff3b30;">*</span>
        </label>
        <input type="password" id="vault-create-password" placeholder="Enter a strong master password (min. 12 characters)" style="
          width:100%;
          padding:14px 16px;
          border:1px solid rgba(139, 92, 246,0.4);
          border-radius:8px;
          background:rgba(0,0,0,0.4);
          color:#fff;
          font-size:15px;
          margin-bottom:8px;
        "/>
        <div id="password-strength" style="height:4px;background:rgba(255,255,255,0.1);border-radius:2px;margin-bottom:16px;overflow:hidden;">
          <div id="password-strength-bar" style="height:100%;width:0%;background:#ff3b30;transition:all 0.3s;"></div>
        </div>
        <div id="password-strength-text" style="font-size:12px;color:rgba(255,255,255,0.6);margin-bottom:16px;"></div>
        
        <label style="display:block;font-size:13px;font-weight:600;margin-bottom:8px;color:rgba(255,255,255,0.9);">
          Confirm Master Password <span style="color:#ff3b30;">*</span>
        </label>
        <input type="password" id="vault-create-confirm" placeholder="Re-enter your master password" style="
          width:100%;
          padding:14px 16px;
          border:1px solid rgba(139, 92, 246,0.4);
          border-radius:8px;
          background:rgba(0,0,0,0.4);
          color:#fff;
          font-size:15px;
          margin-bottom:24px;
        "/>
        
                <!-- Security Acknowledgment Checkbox -->
                <div style="margin-bottom:56px;padding:16px;background:rgba(139,92,246,0.08);border:1px solid rgba(139,92,246,0.3);border-radius:8px;clear:both;">
                  <label style="display:flex;align-items:start;gap:12px;cursor:pointer;user-select:none;">
                    <input type="checkbox" id="vault-backup-confirm" style="width:18px;height:18px;min-width:18px;margin-top:3px;cursor:pointer;flex-shrink:0;"/>
                    <span style="font-size:13px;line-height:1.8;color:rgba(255,255,255,0.9);flex:1;padding-bottom:0;">
                      <strong style="display:block;margin-bottom:8px;color:#a78bfa;">I acknowledge the security implications and have documented my master password</strong>
                      <span style="display:block;margin-bottom:0;">I understand that this password has been stored securely in a physical location and that loss of access will result in permanent, irreversible data loss. I accept full responsibility for password management and backup procedures.</span>
                    </span>
                  </label>
                </div>
        
        <div id="vault-create-error" style="display:none;background:rgba(255,59,48,0.1);border:1px solid rgba(255,59,48,0.3);padding:12px;border-radius:8px;margin-bottom:24px;color:#ff3b30;font-size:13px;clear:both;"></div>
        
        <div style="clear:both;margin-top:40px;margin-bottom:0;">
          <button id="vault-create-btn" disabled style="
            width:100%;
            padding:14px;
            background:linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%);
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
        
        <div style="margin-top:16px;padding:12px;background:rgba(139, 92, 246,0.08);border-radius:8px;font-size:12px;color:rgba(255,255,255,0.7);text-align:center;">
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
          <p style="font-size:14px;color:rgba(255,255,255,0.7);margin-bottom:32px;">
            Your secure, locally-encrypted vault has been established. All stored data is protected with military-grade AES-256-GCM encryption derived from your master password.
          </p>
          <div style="background:rgba(139, 92, 246,0.1);border:1px solid rgba(139, 92, 246,0.3);border-radius:12px;padding:20px;margin-bottom:24px;text-align:left;">
            <div style="font-size:14px;font-weight:600;margin-bottom:12px;color:#fff;">🔐 Security Best Practices:</div>
            <ul style="margin:0;padding-left:20px;font-size:13px;color:rgba(255,255,255,0.8);line-height:1.8;">
              <li>Maintain your master password in a secure, offline location</li>
              <li>Never disclose your master password to any third party</li>
              <li>Regularly export vault data to encrypted external storage (CSV format available)</li>
              <li>Consider implementing a VeraCrypt container on an external SSD for backup redundancy</li>
              <li>Review and update your backup strategy periodically</li>
            </ul>
          </div>
          <button id="vault-continue-btn" style="
            padding:14px 32px;
            background:linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%);
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
  // Load available vaults - always ensure dropdown has options even if API fails
  let availableVaults: Array<{ id: string, name: string, created: number }> = []
  let connectionError: string | null = null
  
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
  
  console.log('[VAULT UI] Rendering unlock screen with vaults:', availableVaults)

  container.innerHTML = `
    <div style="max-width:440px;margin:80px auto;text-align:center;">
      <div style="font-size:64px;margin-bottom:24px;">🔒</div>
      <h2 style="font-size:28px;font-weight:700;margin-bottom:12px;color:#fff;">Unlock Vault</h2>
      <p style="font-size:14px;color:rgba(255,255,255,0.7);margin-bottom:40px;">
        Select a vault and enter your master password to access it
      </p>
      
      <div style="background:rgba(139, 92, 246,0.05);border:1px solid rgba(139, 92, 246,0.2);border-radius:12px;padding:32px;text-align:left;">
        <label style="display:block;font-size:13px;font-weight:600;margin-bottom:8px;color:rgba(255,255,255,0.9);">Select Vault</label>
        <select id="vault-select" style="
          width:100%;
          padding:14px 16px;
          border:1px solid rgba(139, 92, 246,0.4);
          border-radius:8px;
          background:rgba(0,0,0,0.4);
          color:#fff;
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
        
        <label style="display:block;font-size:13px;font-weight:600;margin-bottom:8px;color:rgba(255,255,255,0.9);">Master Password</label>
        <input type="password" id="vault-unlock-password" placeholder="Enter master password" style="
          width:100%;
          padding:14px 16px;
          border:1px solid rgba(139, 92, 246,0.4);
          border-radius:8px;
          background:rgba(0,0,0,0.4);
          color:#fff;
          font-size:15px;
          margin-bottom:24px;
          box-sizing:border-box;
        "/>
        
        <div id="vault-unlock-error" style="display:${connectionError ? 'block' : 'none'};background:rgba(255,59,48,0.1);border:1px solid rgba(255,59,48,0.3);padding:12px;border-radius:8px;margin-bottom:16px;color:#ff3b30;font-size:13px;">
          ${connectionError ? `⚠️ Connection issue: ${connectionError}. You can still try to unlock if Electron is running.` : ''}
        </div>
        
        <button id="vault-unlock-btn" style="
          width:100%;
          padding:14px;
          background:linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%);
          border:none;
          border-radius:8px;
          color:#fff;
          font-size:16px;
          font-weight:600;
          cursor:pointer;
          transition:all 0.2s;
          margin-bottom:16px;
        ">Unlock Vault</button>
        
        <div style="border-top:1px solid rgba(139,92,246,0.2);padding-top:16px;margin-top:16px;text-align:center;">
          <button id="vault-create-new-btn" style="
            width:100%;
            padding:10px;
            background:rgba(139,92,246,0.2);
            border:1px solid rgba(139,92,246,0.4);
            border-radius:6px;
            color:#a78bfa;
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
  const passwordInput = container.querySelector('#vault-unlock-password') as HTMLInputElement
  const unlockBtn = container.querySelector('#vault-unlock-btn') as HTMLButtonElement
  const errorDiv = container.querySelector('#vault-unlock-error') as HTMLElement

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
      unlockBtn.textContent = 'Unlock Vault'
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

// Render Vault Dashboard (Main UI)
function renderVaultDashboard(container: HTMLElement) {
  container.innerHTML = `
    <div style="display:flex;height:100%;gap:24px;">
      <!-- Sidebar -->
      <div style="width:260px;background:rgba(0,0,0,0.3);border-radius:12px;padding:20px;border:1px solid rgba(139, 92, 246,0.2);display:flex;flex-direction:column;">
        <h3 style="font-size:14px;font-weight:700;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:1px;margin-bottom:16px;">Categories</h3>
        <div id="vault-categories" style="display:flex;flex-direction:column;gap:4px;flex:1;overflow-y:auto;">
          <div class="vault-category-btn" data-category="all" data-selected="true" style="padding:12px;background:rgba(139, 92, 246,0.2);border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;border:1px solid rgba(139, 92, 246,0.4);transition:all 0.2s;">🗂️ All Items</div>
          
          <!-- Passwords (with tree) -->
          <div class="vault-category-main" data-category="password" style="border-radius:8px;overflow:hidden;">
            <div class="vault-category-btn vault-category-toggle" data-category="password" style="padding:12px;background:rgba(255,255,255,0.05);cursor:pointer;font-size:14px;border:1px solid rgba(255,255,255,0.1);transition:all 0.2s;display:flex;align-items:center;justify-content:space-between;">
              <span>🔑 Passwords</span>
              <span class="toggle-icon" style="font-size:10px;transition:transform 0.2s;">▶</span>
            </div>
            <div class="vault-subcategories" data-parent="password" style="display:none;padding-left:16px;padding-top:4px;padding-bottom:4px;">
              <div class="vault-subcategory-btn" data-action="view-passwords" data-category="password" style="padding:8px 12px;background:rgba(139,92,246,0.1);border-radius:6px;cursor:pointer;font-size:13px;margin-top:4px;border:1px solid rgba(139,92,246,0.2);transition:all 0.2s;">View Passwords</div>
              <div class="vault-subcategory-btn" data-action="add-password" style="padding:8px 12px;background:rgba(139,92,246,0.1);border-radius:6px;cursor:pointer;font-size:13px;margin-top:4px;border:1px solid rgba(139,92,246,0.2);transition:all 0.2s;">+ Add Password</div>
            </div>
          </div>
          
          <!-- Private Data (with tree) -->
          <div class="vault-category-main" data-container="person" style="border-radius:8px;overflow:hidden;">
            <div class="vault-category-btn vault-category-toggle" data-container="person" style="padding:12px;background:rgba(255,255,255,0.05);cursor:pointer;font-size:14px;border:1px solid rgba(255,255,255,0.1);transition:all 0.2s;display:flex;align-items:center;justify-content:space-between;">
              <span>👤 Private Data</span>
              <span class="toggle-icon" style="font-size:10px;transition:transform 0.2s;">▶</span>
            </div>
            <div class="vault-subcategories" data-parent="person" style="display:none;padding-left:16px;padding-top:4px;padding-bottom:4px;">
              <div class="vault-subcategory-btn" data-action="view-identities" data-category="identity" style="padding:8px 12px;background:rgba(139,92,246,0.1);border-radius:6px;cursor:pointer;font-size:13px;margin-top:4px;border:1px solid rgba(139,92,246,0.2);transition:all 0.2s;">View Identities</div>
              <div class="vault-subcategory-btn" data-action="add-identity" style="padding:8px 12px;background:rgba(139,92,246,0.1);border-radius:6px;cursor:pointer;font-size:13px;margin-top:4px;border:1px solid rgba(139,92,246,0.2);transition:all 0.2s;">+ Add Identity</div>
              <div id="person-containers" style="margin-top:4px;"></div>
            </div>
          </div>
          
          <!-- Company Data (with tree) -->
          <div class="vault-category-main" data-container="company" style="border-radius:8px;overflow:hidden;">
            <div class="vault-category-btn vault-category-toggle" data-container="company" style="padding:12px;background:rgba(255,255,255,0.05);cursor:pointer;font-size:14px;border:1px solid rgba(255,255,255,0.1);transition:all 0.2s;display:flex;align-items:center;justify-content:space-between;">
              <span>🏢 Company Data</span>
              <span class="toggle-icon" style="font-size:10px;transition:transform 0.2s;">▶</span>
            </div>
            <div class="vault-subcategories" data-parent="company" style="display:none;padding-left:16px;padding-top:4px;padding-bottom:4px;">
              <div class="vault-subcategory-btn" data-action="view-companies" data-category="company" style="padding:8px 12px;background:rgba(139,92,246,0.1);border-radius:6px;cursor:pointer;font-size:13px;margin-top:4px;border:1px solid rgba(139,92,246,0.2);transition:all 0.2s;">View Companies</div>
              <div class="vault-subcategory-btn" data-action="add-company" style="padding:8px 12px;background:rgba(139,92,246,0.1);border-radius:6px;cursor:pointer;font-size:13px;margin-top:4px;border:1px solid rgba(139,92,246,0.2);transition:all 0.2s;">+ Add Company</div>
              <div id="company-containers" style="margin-top:4px;"></div>
            </div>
          </div>
          
          <!-- Business Data (with tree) -->
          <div class="vault-category-main" data-container="business" style="border-radius:8px;overflow:hidden;">
            <div class="vault-category-btn vault-category-toggle" data-container="business" style="padding:12px;background:rgba(255,255,255,0.05);cursor:pointer;font-size:14px;border:1px solid rgba(255,255,255,0.1);transition:all 0.2s;display:flex;align-items:center;justify-content:space-between;">
              <span>💼 Business Data</span>
              <span class="toggle-icon" style="font-size:10px;transition:transform 0.2s;">▶</span>
            </div>
            <div class="vault-subcategories" data-parent="business" style="display:none;padding-left:16px;padding-top:4px;padding-bottom:4px;">
              <div class="vault-subcategory-btn" data-action="view-businesses" data-category="business" style="padding:8px 12px;background:rgba(139,92,246,0.1);border-radius:6px;cursor:pointer;font-size:13px;margin-top:4px;border:1px solid rgba(139,92,246,0.2);transition:all 0.2s;">View Businesses</div>
              <div class="vault-subcategory-btn" data-action="add-business" style="padding:8px 12px;background:rgba(139,92,246,0.1);border-radius:6px;cursor:pointer;font-size:13px;margin-top:4px;border:1px solid rgba(139,92,246,0.2);transition:all 0.2s;">+ Add Business</div>
              <div id="business-containers" style="margin-top:4px;"></div>
            </div>
          </div>
          
          <!-- Custom Data (with tree) -->
          <div class="vault-category-main" data-category="custom" style="border-radius:8px;overflow:hidden;">
            <div class="vault-category-btn vault-category-toggle" data-category="custom" style="padding:12px;background:rgba(255,255,255,0.05);cursor:pointer;font-size:14px;border:1px solid rgba(255,255,255,0.1);transition:all 0.2s;display:flex;align-items:center;justify-content:space-between;">
              <span>📝 Custom Data</span>
              <span class="toggle-icon" style="font-size:10px;transition:transform 0.2s;">▶</span>
            </div>
            <div class="vault-subcategories" data-parent="custom" style="display:none;padding-left:16px;padding-top:4px;padding-bottom:4px;">
              <div class="vault-subcategory-btn" data-action="view-data" data-category="custom" style="padding:8px 12px;background:rgba(139,92,246,0.1);border-radius:6px;cursor:pointer;font-size:13px;margin-top:4px;border:1px solid rgba(139,92,246,0.2);transition:all 0.2s;">View Data</div>
              <div class="vault-subcategory-btn" data-action="add-custom" style="padding:8px 12px;background:rgba(139,92,246,0.1);border-radius:6px;cursor:pointer;font-size:13px;margin-top:4px;border:1px solid rgba(139,92,246,0.2);transition:all 0.2s;">+ Add Data</div>
              <div id="custom-containers" style="margin-top:4px;"></div>
            </div>
          </div>
        </div>
        
        <div style="margin-top:auto;padding-top:24px;border-top:1px solid rgba(255,255,255,0.1);">
          <button id="vault-settings-btn" style="width:100%;padding:12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:14px;cursor:pointer;margin-bottom:8px;transition:all 0.2s;">⚙️ Settings</button>
          <button id="vault-lock-btn" style="width:100%;padding:12px;background:rgba(255,59,48,0.2);border:1px solid rgba(255,59,48,0.4);border-radius:8px;color:#ff3b30;font-size:14px;font-weight:600;cursor:pointer;transition:all 0.2s;">🔒 Lock Vault</button>
        </div>
      </div>
      
      <!-- Main content -->
      <div style="flex:1;display:flex;flex-direction:column;gap:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <input type="text" id="vault-search" placeholder="🔍 Search vault..." style="
            flex:1;
            padding:12px 16px;
            background:rgba(0,0,0,0.3);
            border:1px solid rgba(139, 92, 246,0.3);
            border-radius:8px;
            color:#fff;
            font-size:14px;
            margin-right:12px;
          "/>
          <button id="vault-add-btn" style="
            padding:12px 24px;
            background:linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%);
            border:none;
            border-radius:8px;
            color:#fff;
            font-size:14px;
            font-weight:600;
            cursor:pointer;
            transition:all 0.2s;
          ">+ Add Data</button>
        </div>
        
        <div id="vault-items-list" style="flex:1;overflow-y:auto;background:rgba(0,0,0,0.2);border:1px solid rgba(139, 92, 246,0.2);border-radius:12px;padding:16px;">
          <div style="text-align:center;padding:40px;color:rgba(255,255,255,0.5);">
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
        this.style.background = 'rgba(139, 92, 246,0.1)'
      }
    })
    ;(btn as HTMLElement).addEventListener('mouseleave', function() {
      const isActive = this.style.border.includes('139, 92, 246,0.4')
      if (!isActive && this.getAttribute('data-category') !== 'all') {
        this.style.background = 'rgba(255,255,255,0.05)'
      }
    })
  })

  // Load items and containers
  loadVaultItems(container, 'all')
  loadContainersIntoTree(container)

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
        }
      }
    })
  })

  // Add Password/Identity/Company/Business/Custom buttons
  container.querySelectorAll('.vault-subcategory-btn[data-action]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const action = (btn as HTMLElement).getAttribute('data-action')
      const category = (btn as HTMLElement).getAttribute('data-category')
      
      if (action === 'view-passwords') {
        loadVaultItems(container, 'password')
      } else if (action === 'view-identities') {
        loadVaultItems(container, 'identity')
      } else if (action === 'view-companies') {
        loadVaultItems(container, 'company')
      } else if (action === 'view-businesses') {
        loadVaultItems(container, 'business')
      } else if (action === 'view-data') {
        loadVaultItems(container, 'custom')
      } else if (action === 'add-password') {
        renderAddDataDialog(container, 'password')
      } else if (action === 'add-identity') {
        renderAddDataDialog(container, 'identity')
      } else if (action === 'add-company') {
        renderAddDataDialog(container, 'company')
      } else if (action === 'add-business') {
        renderAddDataDialog(container, 'business')
      } else if (action === 'add-custom') {
        renderAddDataDialog(container, 'custom')
      }
    })
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
          ;(b as HTMLElement).style.background = 'rgba(255,255,255,0.05)'
          ;(b as HTMLElement).style.border = '1px solid rgba(255,255,255,0.1)'
          ;(b as HTMLElement).removeAttribute('data-selected')
        }
      })
      ;(btn as HTMLElement).style.background = 'rgba(139, 92, 246,0.2)'
      ;(btn as HTMLElement).style.border = '1px solid rgba(139, 92, 246,0.4)'
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

  // Add data button - default to password form
  container.querySelector('#vault-add-btn')?.addEventListener('click', () => {
    renderAddDataDialog(container, 'password')
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
    listDiv.innerHTML = '<div style="text-align:center;padding:40px;color:rgba(255,255,255,0.5);">Loading...</div>'
    // Get containers first, then items for each container
    const containers = await vaultAPI.listContainers()
    const filteredContainers = containers.filter((c: Container) => c.type === containerType)
    
    if (filteredContainers.length === 0) {
      listDiv.innerHTML = `<div style="text-align:center;padding:40px;color:rgba(255,255,255,0.5);">No ${containerType} containers found. Click "+ Add Data" to create your first ${containerType}.</div>`
      return
    }
    
    // Load items for all containers of this type
    const allItems: VaultItem[] = []
    for (const cont of filteredContainers) {
      const items = await vaultAPI.listItems({ container_id: cont.id } as any)
      allItems.push(...items)
    }
    
    if (allItems.length === 0) {
      listDiv.innerHTML = `<div style="text-align:center;padding:40px;color:rgba(255,255,255,0.5);">No data found in ${containerType} containers. Click "+ Add Data" to create your first entry.</div>`
      return
    }
    
    renderContainerData(listDiv, allItems)
  } catch (err: any) {
    console.error('[VAULT UI] Error loading items by container:', err)
    listDiv.innerHTML = `<div style="text-align:center;padding:40px;color:#ff3b30;">Error loading items: ${err.message || err}</div>`
  }
}

// Legacy function - now uses renderContainerData for consistency
function renderItemsList(listDiv: HTMLElement, items: any[]) {
  renderContainerData(listDiv, items)
}

async function loadVaultItems(container: HTMLElement, category: string) {
  const listDiv = container.querySelector('#vault-items-list') as HTMLElement
  if (!listDiv) return

  // Store current category for refresh after save
  listDiv.setAttribute('data-current-category', category)

  try {
    listDiv.innerHTML = '<div style="text-align:center;padding:40px;color:rgba(255,255,255,0.5);">Loading...</div>'
    const filters = category === 'all' ? undefined : { category: category as any }
    const items = await vaultAPI.listItems(filters)
    
    // Ensure items is an array
    if (!Array.isArray(items)) {
      console.error('[VAULT UI] listItems did not return an array:', items)
      listDiv.innerHTML = '<div style="text-align:center;padding:40px;color:#ff3b30;">Error: Invalid response from server</div>'
      return
    }
    
    if (items.length === 0) {
      listDiv.innerHTML = '<div style="text-align:center;padding:40px;color:rgba(255,255,255,0.5);">No items found. Click "+ Add Data" to create your first entry.</div>'
      return
    }

    // Use professional rendering for all items
    renderContainerData(listDiv, items)
  } catch (err: any) {
    console.error('[VAULT] Error loading items:', err)
    listDiv.innerHTML = `<div style="text-align:center;padding:40px;color:#ff3b30;">Error loading items: ${err.message || err}. Please try again.</div>`
  }
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
    
    // Group containers by type
    const personContainers = containers.filter((c: Container) => c.type === 'person')
    const companyContainers = containers.filter((c: Container) => c.type === 'company')
    const businessContainers = containers.filter((c: Container) => c.type === 'business')
    
    // Render person containers
    const personDiv = container.querySelector('#person-containers') as HTMLElement
    if (personDiv) {
      personDiv.innerHTML = personContainers.map((c: Container) => `
        <div class="vault-container-item" data-container-id="${c.id}" style="padding:8px 12px;background:rgba(255,255,255,0.03);border-radius:6px;cursor:pointer;font-size:13px;margin-top:4px;border:1px solid rgba(255,255,255,0.05);transition:all 0.2s;" onmouseenter="this.style.background='rgba(139,92,246,0.1)';this.style.border='1px solid rgba(139,92,246,0.3)'" onmouseleave="this.style.background='rgba(255,255,255,0.03)';this.style.border='1px solid rgba(255,255,255,0.05)'">
          👤 ${escapeHtml(c.name)}
        </div>
      `).join('')
      
      // Add click handlers
      personDiv.querySelectorAll('.vault-container-item').forEach((item) => {
        item.addEventListener('click', () => {
          const containerId = (item as HTMLElement).getAttribute('data-container-id')
          if (containerId) {
            loadContainerItems(container, containerId)
          }
        })
      })
    }
    
    // Render company containers
    const companyDiv = container.querySelector('#company-containers') as HTMLElement
    if (companyDiv) {
      companyDiv.innerHTML = companyContainers.map((c: Container) => `
        <div class="vault-container-item" data-container-id="${c.id}" style="padding:8px 12px;background:rgba(255,255,255,0.03);border-radius:6px;cursor:pointer;font-size:13px;margin-top:4px;border:1px solid rgba(255,255,255,0.05);transition:all 0.2s;" onmouseenter="this.style.background='rgba(139,92,246,0.1)';this.style.border='1px solid rgba(139,92,246,0.3)'" onmouseleave="this.style.background='rgba(255,255,255,0.03)';this.style.border='1px solid rgba(255,255,255,0.05)'">
          🏢 ${escapeHtml(c.name)}
        </div>
      `).join('')
      
      companyDiv.querySelectorAll('.vault-container-item').forEach((item) => {
        item.addEventListener('click', () => {
          const containerId = (item as HTMLElement).getAttribute('data-container-id')
          if (containerId) {
            loadContainerItems(container, containerId)
          }
        })
      })
    }
    
    // Render business containers
    const businessDiv = container.querySelector('#business-containers') as HTMLElement
    if (businessDiv) {
      businessDiv.innerHTML = businessContainers.map((c: Container) => `
        <div class="vault-container-item" data-container-id="${c.id}" style="padding:8px 12px;background:rgba(255,255,255,0.03);border-radius:6px;cursor:pointer;font-size:13px;margin-top:4px;border:1px solid rgba(255,255,255,0.05);transition:all 0.2s;" onmouseenter="this.style.background='rgba(139,92,246,0.1)';this.style.border='1px solid rgba(139,92,246,0.3)'" onmouseleave="this.style.background='rgba(255,255,255,0.03)';this.style.border='1px solid rgba(255,255,255,0.05)'">
          💼 ${escapeHtml(c.name)}
        </div>
      `).join('')
      
      businessDiv.querySelectorAll('.vault-container-item').forEach((item) => {
        item.addEventListener('click', () => {
          const containerId = (item as HTMLElement).getAttribute('data-container-id')
          if (containerId) {
            loadContainerItems(container, containerId)
          }
        })
      })
    }
    
    // Load custom data items (no containers, just items with category='custom')
    const customDiv = container.querySelector('#custom-containers') as HTMLElement
    if (customDiv) {
      try {
        const customItems = await vaultAPI.listItems({ category: 'custom' } as any)
        if (Array.isArray(customItems) && customItems.length > 0) {
          customDiv.innerHTML = customItems.map((item: VaultItem) => `
            <div class="vault-container-item" data-item-id="${item.id}" style="padding:8px 12px;background:rgba(255,255,255,0.03);border-radius:6px;cursor:pointer;font-size:13px;margin-top:4px;border:1px solid rgba(255,255,255,0.05);transition:all 0.2s;" onmouseenter="this.style.background='rgba(139,92,246,0.1)';this.style.border='1px solid rgba(139,92,246,0.3)'" onmouseleave="this.style.background='rgba(255,255,255,0.03)';this.style.border='1px solid rgba(255,255,255,0.05)'">
              📝 ${escapeHtml(item.title)}
            </div>
          `).join('')
          
          customDiv.querySelectorAll('.vault-container-item').forEach((item) => {
            item.addEventListener('click', () => {
              loadVaultItems(container, 'custom')
            })
          })
        }
      } catch (err) {
        console.error('[VAULT UI] Error loading custom items:', err)
      }
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
    listDiv.innerHTML = '<div style="text-align:center;padding:40px;color:rgba(255,255,255,0.5);">Loading...</div>'
    const items = await vaultAPI.listItems({ container_id: containerId } as any)
    
    if (items.length === 0) {
      listDiv.innerHTML = '<div style="text-align:center;padding:40px;color:rgba(255,255,255,0.5);">No data found in this container. Add fields using the form below.</div>'
      return
    }
    
    renderContainerData(listDiv, items)
  } catch (err: any) {
    console.error('[VAULT UI] Error loading container items:', err)
    listDiv.innerHTML = `<div style="text-align:center;padding:40px;color:#ff3b30;">Error loading data: ${err.message || err}</div>`
  }
}

// Render container data professionally - Password Manager Style List View
function renderContainerData(listDiv: HTMLElement, items: VaultItem[]) {
  if (items.length === 0) {
    listDiv.innerHTML = '<div style="text-align:center;padding:60px 20px;color:rgba(255,255,255,0.5);"><div style="font-size:48px;margin-bottom:16px;">📭</div><div style="font-size:16px;margin-bottom:8px;">No entries found</div><div style="font-size:13px;">Click "+ Add" to create your first entry</div></div>'
    return
  }
  
  // Password manager style: Compact list with view/edit buttons
  listDiv.innerHTML = `
    <div style="background:rgba(0,0,0,0.2);border-radius:12px;overflow:hidden;border:1px solid rgba(139,92,246,0.2);">
      <div style="display:grid;grid-template-columns:1fr auto auto;gap:16px;padding:16px;background:rgba(139,92,246,0.1);border-bottom:1px solid rgba(139,92,246,0.2);font-size:12px;font-weight:600;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:0.5px;">
        <div>Entry</div>
        <div style="text-align:center;width:80px;">Actions</div>
        <div style="text-align:center;width:80px;">Options</div>
      </div>
      ${items.map(item => renderListItemRow(item)).join('')}
    </div>
  `
  
  // Add event handlers
  listDiv.querySelectorAll('.vault-list-item').forEach((row) => {
    const itemId = (row as HTMLElement).getAttribute('data-item-id')
    if (!itemId) return
    
    // View button - shows details in a modal
    const viewBtn = row.querySelector('.vault-item-view-btn')
    viewBtn?.addEventListener('click', async () => {
      try {
        const item = await vaultAPI.getItem(itemId)
        renderItemViewModal(item)
      } catch (err: any) {
        alert(`Error loading item: ${err.message || err}`)
      }
    })
    
    // Edit button
    const editBtn = row.querySelector('.vault-item-edit-btn')
    editBtn?.addEventListener('click', async () => {
      try {
        const item = await vaultAPI.getItem(itemId)
        const container = listDiv.closest('#wrvault-container') || document.querySelector('#wrvault-container')
        if (container) {
          renderEditDataDialog(container as HTMLElement, item)
        }
      } catch (err: any) {
        alert(`Error loading item: ${err.message || err}`)
      }
    })
    
    // Delete button
    const deleteBtn = row.querySelector('.vault-item-delete-btn')
    deleteBtn?.addEventListener('click', async () => {
      const title = (row.querySelector('.vault-item-title') as HTMLElement)?.textContent || 'this item'
      if (confirm(`Are you sure you want to delete "${title}"?`)) {
        try {
          await vaultAPI.deleteItem(itemId)
          // Refresh the view
          const containerId = (row as HTMLElement).getAttribute('data-container-id')
          const category = (row as HTMLElement).getAttribute('data-category')
          const container = listDiv.closest('#wrvault-container') as HTMLElement
          
          if (containerId) {
            loadContainerItems(container, containerId)
          } else if (category) {
            loadVaultItems(container, category)
          } else {
            loadVaultItems(container, 'all')
          }
          loadContainersIntoTree(container)
        } catch (err: any) {
          alert(`Error deleting item: ${err.message || err}`)
        }
      }
    })
  })
}

// Render a single list item row (Password Manager Style)
function renderListItemRow(item: VaultItem): string {
  // Get primary field value for preview (username for passwords, first field for others)
  let previewValue = ''
  if (item.category === 'password') {
    const usernameField = item.fields.find(f => f.key === 'username' || f.key === 'email')
    previewValue = usernameField ? (usernameField.encrypted ? '••••••••' : usernameField.value) : ''
  } else if (item.fields.length > 0) {
    const firstField = item.fields[0]
    previewValue = firstField.encrypted ? '••••••••' : (firstField.value || '').substring(0, 30)
  }
  
  const categoryIcon = {
    password: '🔑',
    identity: '👤',
    company: '🏢',
    business: '💼',
    custom: '📝'
  }[item.category] || '📄'
  
  return `
    <div class="vault-list-item" data-item-id="${item.id}" data-container-id="${item.container_id || ''}" data-category="${item.category}" style="
      display:grid;
      grid-template-columns:1fr auto auto;
      gap:16px;
      padding:16px;
      border-bottom:1px solid rgba(139,92,246,0.1);
      transition:all 0.2s;
      cursor:pointer;
    " onmouseenter="this.style.background='rgba(139,92,246,0.08)'" onmouseleave="this.style.background='transparent'">
      <div style="display:flex;align-items:center;gap:12px;min-width:0;">
        <div style="font-size:20px;flex-shrink:0;">${categoryIcon}</div>
        <div style="flex:1;min-width:0;">
          <div class="vault-item-title" style="font-size:15px;font-weight:600;color:#fff;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.title || 'Untitled')}</div>
          ${previewValue ? `<div style="font-size:13px;color:rgba(255,255,255,0.6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(previewValue)}</div>` : ''}
          ${item.domain ? `<div style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:2px;">${escapeHtml(item.domain)}</div>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;width:80px;justify-content:center;">
        <button class="vault-item-view-btn" style="
          background:rgba(139,92,246,0.2);
          border:1px solid rgba(139,92,246,0.4);
          padding:6px 12px;
          border-radius:6px;
          color:#a78bfa;
          font-size:12px;
          cursor:pointer;
          transition:all 0.2s;
          white-space:nowrap;
        " onmouseenter="this.style.background='rgba(139,92,246,0.3)'" onmouseleave="this.style.background='rgba(139,92,246,0.2)'">View</button>
        <button class="vault-item-edit-btn" style="
          background:rgba(139,92,246,0.2);
          border:1px solid rgba(139,92,246,0.4);
          padding:6px 12px;
          border-radius:6px;
          color:#a78bfa;
          font-size:12px;
          cursor:pointer;
          transition:all 0.2s;
          white-space:nowrap;
        " onmouseenter="this.style.background='rgba(139,92,246,0.3)'" onmouseleave="this.style.background='rgba(139,92,246,0.2)'">Edit</button>
      </div>
      <div style="display:flex;align-items:center;justify-content:center;width:80px;">
        <button class="vault-item-delete-btn" style="
          background:rgba(255,59,48,0.1);
          border:1px solid rgba(255,59,48,0.3);
          padding:6px 10px;
          border-radius:6px;
          color:#ff3b30;
          font-size:12px;
          cursor:pointer;
          transition:all 0.2s;
        " onmouseenter="this.style.background='rgba(255,59,48,0.2)'" onmouseleave="this.style.background='rgba(255,59,48,0.1)'" title="Delete">🗑️</button>
      </div>
    </div>
  `
}

// Render item view modal (Password Manager Style)
function renderItemViewModal(item: VaultItem) {
  const overlay = document.createElement('div')
  overlay.style.cssText = `
    position:fixed;
    inset:0;
    background:rgba(0,0,0,0.9);
    z-index:2147483651;
    display:flex;
    align-items:center;
    justify-content:center;
    backdrop-filter:blur(8px);
  `
  
  const fieldsHtml = item.fields.map((field, index) => {
    const value = field.encrypted ? '••••••••' : escapeHtml(field.value || '')
    const actualValue = field.value || ''
    const fieldId = `vault-field-${item.id}-${index}`
    return `
      <div style="margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div style="font-size:11px;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.5px;">
            ${escapeHtml(field.key)}
          </div>
          ${!field.encrypted && actualValue ? `<button class="vault-copy-btn" data-field-id="${fieldId}" data-value="${escapeHtml(actualValue)}" style="
            background:rgba(139,92,246,0.2);
            border:1px solid rgba(139,92,246,0.4);
            padding:4px 10px;
            border-radius:6px;
            color:#a78bfa;
            font-size:11px;
            cursor:pointer;
            transition:all 0.2s;
            white-space:nowrap;
          " onmouseenter="this.style.background='rgba(139,92,246,0.3)'" onmouseleave="this.style.background='rgba(139,92,246,0.2)'">📋 Copy</button>` : ''}
        </div>
        <div id="${fieldId}" style="font-size:15px;color:#fff;word-break:break-word;background:rgba(0,0,0,0.3);padding:12px;border-radius:8px;border:1px solid rgba(139,92,246,0.2);position:relative;">
          ${value}
        </div>
        ${field.explanation ? `<div style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:6px;font-style:italic;">${escapeHtml(field.explanation)}</div>` : ''}
      </div>
    `
  }).join('')
  
  overlay.innerHTML = `
    <div style="
      background:linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%);
      border-radius:16px;
      width:90vw;
      max-width:600px;
      max-height:90vh;
      overflow-y:auto;
      color:white;
      box-shadow:0 25px 50px rgba(139, 92, 246, 0.4);
      border:1px solid rgba(139, 92, 246, 0.4);
    ">
      <div style="padding:32px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
          <h2 style="font-size:24px;font-weight:700;color:#fff;">${escapeHtml(item.title || 'Untitled')}</h2>
          <button id="vault-view-close" style="
            background:rgba(255,255,255,0.1);
            border:1px solid rgba(255,255,255,0.2);
            width:32px;
            height:32px;
            border-radius:8px;
            color:#fff;
            font-size:20px;
            cursor:pointer;
            display:flex;
            align-items:center;
            justify-content:center;
          ">×</button>
        </div>
        ${item.domain ? `<div style="margin-bottom:20px;padding:12px;background:rgba(139,92,246,0.1);border-radius:8px;border:1px solid rgba(139,92,246,0.2);"><div style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:4px;">Domain</div><div style="font-size:14px;color:#fff;">${escapeHtml(item.domain)}</div></div>` : ''}
        <div style="border-top:1px solid rgba(139,92,246,0.2);padding-top:20px;">
          ${fieldsHtml}
        </div>
      </div>
    </div>
  `
  
  document.body.appendChild(overlay)
  
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
            button.style.background = 'rgba(139,92,246,0.2)'
            button.style.borderColor = 'rgba(139,92,246,0.4)'
            button.style.color = '#a78bfa'
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
      <div style="margin-bottom:12px;">
        <div style="font-size:11px;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">
          ${escapeHtml(field.key)}
        </div>
        <div style="font-size:14px;color:#fff;word-break:break-word;">
          ${value}
        </div>
      </div>
    `
  }).join('')
  
  return `
    <div style="
      background:rgba(139, 92, 246,0.08);
      border:1px solid rgba(139, 92, 246,0.2);
      border-radius:10px;
      padding:20px;
      margin-bottom:16px;
      transition:all 0.2s;
    " class="vault-item-card" data-item-id="${item.id}" data-container-id="${item.container_id || ''}" data-category="${item.category}" onmouseenter="this.style.background='rgba(139, 92, 246,0.12)';this.style.border='1px solid rgba(139, 92, 246,0.3)'" onmouseleave="this.style.background='rgba(139, 92, 246,0.08)';this.style.border='1px solid rgba(139, 92, 246,0.2)'">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:16px;">
        <div>
          <div class="vault-item-title" style="font-size:18px;font-weight:600;margin-bottom:4px;color:#fff;">${escapeHtml(item.title || 'Untitled')}</div>
          ${item.domain ? `<div style="font-size:12px;color:rgba(255,255,255,0.6);">${escapeHtml(item.domain)}</div>` : ''}
        </div>
        <div style="display:flex;gap:8px;">
          <button class="vault-item-edit-btn" style="
            background:rgba(139, 92, 246,0.3);
            border:1px solid rgba(139, 92, 246,0.5);
            padding:6px 14px;
            border-radius:6px;
            color:#fff;
            font-size:12px;
            cursor:pointer;
            transition:all 0.2s;
          " onmouseenter="this.style.background='rgba(139, 92, 246,0.5)'" onmouseleave="this.style.background='rgba(139, 92, 246,0.3)'">Edit</button>
          <button class="vault-item-delete-btn" style="
            background:rgba(255,59,48,0.2);
            border:1px solid rgba(255,59,48,0.4);
            padding:6px 14px;
            border-radius:6px;
            color:#ff3b30;
            font-size:12px;
            cursor:pointer;
            transition:all 0.2s;
          " onmouseenter="this.style.background='rgba(255,59,48,0.3)'" onmouseleave="this.style.background='rgba(255,59,48,0.2)'">Delete</button>
        </div>
      </div>
      <div style="border-top:1px solid rgba(139,92,246,0.2);padding-top:16px;">
        ${fieldsHtml}
      </div>
    </div>
  `
}

// Render Add Data Dialog
function renderAddDataDialog(container: HTMLElement, preselectedCategory?: 'password' | 'identity' | 'company' | 'business' | 'custom') {
  const overlay = document.createElement('div')
  overlay.id = 'vault-add-data-overlay'
  overlay.style.cssText = `
    position:fixed;
    inset:0;
    background:rgba(0,0,0,0.9);
    z-index:2147483650;
    display:flex;
    align-items:center;
    justify-content:center;
    backdrop-filter:blur(8px);
  `
  
  const dialog = document.createElement('div')
  dialog.style.cssText = `
    background:linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%);
    border-radius:16px;
    width:90vw;
    max-width:700px;
    max-height:90vh;
    overflow-y:auto;
    color:white;
    box-shadow:0 25px 50px rgba(139, 92, 246, 0.4);
    border:1px solid rgba(139, 92, 246, 0.4);
  `
  
  const categoryOptions = [
    { value: 'password', label: '🔑 Password', icon: '🔑' },
    { value: 'identity', label: '👤 Identity (Private Data)', icon: '👤' },
    { value: 'company', label: '🏢 Company', icon: '🏢' },
    { value: 'business', label: '💼 Business', icon: '💼' },
    { value: 'custom', label: '📝 Custom Data', icon: '📝' },
  ]
  
  dialog.innerHTML = `
    <div style="padding:32px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
        <h2 style="font-size:24px;font-weight:700;color:#fff;">Add Data</h2>
        <button id="vault-add-data-close" style="
          background:rgba(255,255,255,0.1);
          border:1px solid rgba(255,255,255,0.2);
          width:32px;
          height:32px;
          border-radius:8px;
          color:#fff;
          font-size:20px;
          cursor:pointer;
          display:flex;
          align-items:center;
          justify-content:center;
        ">×</button>
      </div>
      
      <div style="margin-bottom:24px;">
        <label style="display:block;font-size:13px;font-weight:600;margin-bottom:8px;color:rgba(255,255,255,0.9);">Select Category *</label>
        <select id="vault-add-category" required style="
          width:100%;
          min-height:44px;
          padding:12px 16px;
          padding-right:40px;
          border:1px solid rgba(139, 92, 246,0.4);
          border-radius:8px;
          background:rgba(0,0,0,0.4);
          color:#fff;
          font-size:14px;
          cursor:pointer;
          box-sizing:border-box;
          display:block;
          visibility:visible;
          opacity:1;
          appearance:none;
          -webkit-appearance:none;
          -moz-appearance:none;
          background-image:url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"12\" height=\"12\" viewBox=\"0 0 12 12\"><path fill=\"white\" d=\"M6 9L1 4h10z\"/></svg>');
          background-repeat:no-repeat;
          background-position:right 12px center;
        ">
          <option value="">Loading categories...</option>
        </select>
      </div>
      
      <div id="vault-add-form-container">
        <!-- Form will be dynamically generated based on category -->
      </div>
      
      <div style="display:flex;gap:12px;margin-top:24px;padding-top:24px;border-top:1px solid rgba(255,255,255,0.1);justify-content:flex-end;">
        <button id="vault-add-data-cancel" style="
          padding:14px 24px;
          background:rgba(255,255,255,0.1);
          border:1px solid rgba(255,255,255,0.2);
          border-radius:8px;
          color:#fff;
          font-size:14px;
          font-weight:600;
          cursor:pointer;
          transition:all 0.2s;
        ">Cancel</button>
        <button id="vault-add-data-save" style="
          padding:14px 24px;
          background:linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%);
          border:none;
          border-radius:8px;
          color:#fff;
          font-size:14px;
          font-weight:600;
          cursor:pointer;
          transition:all 0.2s;
        ">Save Data</button>
      </div>
    </div>
  `
  
  overlay.appendChild(dialog)
  document.body.appendChild(overlay)
  
  // Populate select options programmatically AFTER dialog is in DOM
  const categorySelect = dialog.querySelector('#vault-add-category') as HTMLSelectElement
  const defaultCategory = preselectedCategory || 'password'
  
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
    
    if (category === 'password') {
      standardFields = PASSWORD_STANDARD_FIELDS
      titleLabel = 'Service Name'
    } else if (category === 'identity') {
      standardFields = IDENTITY_STANDARD_FIELDS
      titleLabel = 'Identity Name'
    } else if (category === 'company') {
      standardFields = COMPANY_STANDARD_FIELDS
      titleLabel = 'Company Name'
    } else if (category === 'business') {
      standardFields = BUSINESS_STANDARD_FIELDS
      titleLabel = 'Business Name'
    } else if (category === 'custom') {
      isCustomData = true
      titleLabel = 'Data Group Name'
    }
    
    if (isCustomData) {
      // Custom Data form - multiple field groups
      formContainer.innerHTML = `
        <div style="margin-bottom:20px;">
          <label style="display:block;font-size:13px;font-weight:600;margin-bottom:8px;color:rgba(255,255,255,0.9);">${titleLabel} *</label>
          <input type="text" id="vault-add-title" placeholder="Enter ${titleLabel.toLowerCase()}" style="
            width:100%;
            padding:12px 16px;
            border:1px solid rgba(139, 92, 246,0.4);
            border-radius:8px;
            background:rgba(0,0,0,0.4);
            color:#fff;
            font-size:14px;
            box-sizing:border-box;
          "/>
        </div>
        
        <div style="margin-bottom:20px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <label style="font-size:13px;font-weight:600;color:rgba(255,255,255,0.9);">Data Fields</label>
            <button type="button" id="vault-add-custom-field-group" style="
              padding:6px 12px;
              background:rgba(139,92,246,0.2);
              border:1px solid rgba(139,92,246,0.4);
              border-radius:6px;
              color:#a78bfa;
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
        fieldGroupDiv.style.cssText = 'background:rgba(139,92,246,0.05);border:1px solid rgba(139,92,246,0.2);border-radius:8px;padding:16px;'
        fieldGroupDiv.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <span style="font-size:12px;font-weight:600;color:rgba(255,255,255,0.8);">Field</span>
            <button type="button" class="remove-custom-field-group" style="
              background:rgba(255,59,48,0.2);
              border:1px solid rgba(255,59,48,0.4);
              padding:4px 8px;
              border-radius:4px;
              color:#ff3b30;
              font-size:11px;
              cursor:pointer;
            ">Remove</button>
          </div>
          <div style="display:flex;flex-direction:column;gap:12px;">
            <div>
              <label style="display:block;font-size:11px;font-weight:600;margin-bottom:4px;color:rgba(255,255,255,0.7);">Field Name *</label>
              <input type="text" class="custom-field-name" placeholder="e.g., License Number" style="
                width:100%;
                padding:10px 12px;
                border:1px solid rgba(139, 92, 246,0.3);
                border-radius:6px;
                background:rgba(0,0,0,0.3);
                color:#fff;
                font-size:13px;
                box-sizing:border-box;
              "/>
            </div>
            <div>
              <label style="display:block;font-size:11px;font-weight:600;margin-bottom:4px;color:rgba(255,255,255,0.7);">Field Value *</label>
              <input type="text" class="custom-field-value" placeholder="Enter the value" style="
                width:100%;
                padding:10px 12px;
                border:1px solid rgba(139, 92, 246,0.3);
                border-radius:6px;
                background:rgba(0,0,0,0.3);
                color:#fff;
                font-size:13px;
                box-sizing:border-box;
              "/>
            </div>
            <div>
              <label style="display:block;font-size:11px;font-weight:600;margin-bottom:4px;color:rgba(255,255,255,0.7);">Additional Info</label>
              <div style="font-size:10px;color:rgba(255,255,255,0.5);margin-bottom:4px;font-style:italic;">💡 This information helps AI autofill match this data to forms more accurately</div>
              <textarea class="custom-field-additional-info" placeholder="Additional context or notes..." style="
                width:100%;
                padding:10px 12px;
                border:1px solid rgba(139, 92, 246,0.3);
                border-radius:6px;
                background:rgba(0,0,0,0.3);
                color:#fff;
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
    
    // Standard form for password/identity/company/business
    formContainer.innerHTML = `
      ${category !== 'identity' ? `
      <div style="margin-bottom:20px;">
        <label style="display:block;font-size:13px;font-weight:600;margin-bottom:8px;color:rgba(255,255,255,0.9);">${titleLabel} *</label>
        <input type="text" id="vault-add-title" placeholder="Enter ${titleLabel.toLowerCase()}" style="
          width:100%;
          padding:12px 16px;
          border:1px solid rgba(139, 92, 246,0.4);
          border-radius:8px;
          background:rgba(0,0,0,0.4);
          color:#fff;
          font-size:14px;
          box-sizing:border-box;
        "/>
      </div>
      ` : ''}
      
      <div style="margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <label style="font-size:13px;font-weight:600;color:rgba(255,255,255,0.9);">Standard Fields</label>
        </div>
        <div id="vault-standard-fields" style="display:flex;flex-direction:column;gap:16px;">
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
                    <div style="display:flex;gap:12px;align-items:flex-start;">
                      <div style="flex:1;">
                        <div style="margin-bottom:6px;">
                          <label style="font-size:12px;font-weight:600;color:rgba(255,255,255,0.8);">${escapeHtml(ceoFirstNameField.label)}${ceoFirstNameField.required ? ' *' : ''}</label>
                          ${ceoFirstNameField.explanation ? `<div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(ceoFirstNameField.explanation)}</div>` : '<div style="height:14px;"></div>'}
                        </div>
                        <input type="text" 
                          id="field-${ceoFirstNameField.key}" 
                          placeholder="Enter ${ceoFirstNameField.label.toLowerCase()}" 
                          ${ceoFirstNameField.required ? 'required' : ''}
                          style="
                            width:100%;
                            padding:12px 16px;
                            border:1px solid rgba(139, 92, 246,0.4);
                            border-radius:8px;
                            background:rgba(0,0,0,0.4);
                            color:#fff;
                            font-size:14px;
                            box-sizing:border-box;
                          "/>
                      </div>
                      <div style="flex:1;">
                        <div style="margin-bottom:6px;">
                          <label style="font-size:12px;font-weight:600;color:rgba(255,255,255,0.8);">${escapeHtml(ceoSurnameField.label)}${ceoSurnameField.required ? ' *' : ''}</label>
                          ${ceoSurnameField.explanation ? `<div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(ceoSurnameField.explanation)}</div>` : '<div style="height:14px;"></div>'}
                        </div>
                        <input type="text" 
                          id="field-${ceoSurnameField.key}" 
                          placeholder="Enter ${ceoSurnameField.label.toLowerCase()}" 
                          ${ceoSurnameField.required ? 'required' : ''}
                          style="
                            width:100%;
                            padding:12px 16px;
                            border:1px solid rgba(139, 92, 246,0.4);
                            border-radius:8px;
                            background:rgba(0,0,0,0.4);
                            color:#fff;
                            font-size:14px;
                            box-sizing:border-box;
                          "/>
                      </div>
                    </div>
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
                    <div style="display:flex;gap:12px;align-items:flex-start;">
                      <div style="flex:2;">
                        <div style="margin-bottom:6px;">
                          <label style="font-size:12px;font-weight:600;color:rgba(255,255,255,0.8);">${escapeHtml(streetField.label)}${streetField.required ? ' *' : ''}</label>
                          ${streetField.explanation ? `<div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(streetField.explanation)}</div>` : '<div style="height:14px;"></div>'}
                        </div>
                        <input type="text" 
                          id="field-${streetField.key}" 
                          placeholder="Enter ${streetField.label.toLowerCase()}" 
                          ${streetField.required ? 'required' : ''}
                          style="
                            width:100%;
                            padding:12px 16px;
                            border:1px solid rgba(139, 92, 246,0.4);
                            border-radius:8px;
                            background:rgba(0,0,0,0.4);
                            color:#fff;
                            font-size:14px;
                            box-sizing:border-box;
                          "/>
                      </div>
                      <div style="flex:1;">
                        <div style="margin-bottom:6px;">
                          <label style="font-size:12px;font-weight:600;color:rgba(255,255,255,0.8);">${escapeHtml(numberField.label)}${numberField.required ? ' *' : ''}</label>
                          ${numberField.explanation ? `<div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(numberField.explanation)}</div>` : '<div style="height:14px;"></div>'}
                        </div>
                        <input type="text" 
                          id="field-${numberField.key}" 
                          placeholder="Enter ${numberField.label.toLowerCase()}" 
                          ${numberField.required ? 'required' : ''}
                          style="
                            width:100%;
                            padding:12px 16px;
                            border:1px solid rgba(139, 92, 246,0.4);
                            border-radius:8px;
                            background:rgba(0,0,0,0.4);
                            color:#fff;
                            font-size:14px;
                            box-sizing:border-box;
                          "/>
                      </div>
                    </div>
                  </div>
                `
                i += 2 // Skip both fields
                continue
              }
              
              // Regular field rendering
              fieldsHtml += `
                <div>
                  <div style="margin-bottom:6px;">
                    <label style="font-size:12px;font-weight:600;color:rgba(255,255,255,0.8);">${escapeHtml(field.label)}${field.required ? ' *' : ''}</label>
                    ${field.explanation && field.key !== 'additional_info' ? `<div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(field.explanation)}</div>` : ''}
                  </div>
                  ${field.key === 'additional_info' ? `
                    <div style="font-size:10px;color:rgba(255,255,255,0.5);margin-bottom:4px;font-style:italic;">💡 This information helps AI autofill match this data to forms more accurately</div>
                  ` : ''}
                  ${field.type === 'textarea' ? `
                    <textarea id="field-${field.key}" placeholder="Enter ${field.label.toLowerCase()}" style="
                      width:100%;
                      padding:12px 16px;
                      border:1px solid rgba(139, 92, 246,0.4);
                      border-radius:8px;
                      background:rgba(0,0,0,0.4);
                      color:#fff;
                      font-size:14px;
                      min-height:80px;
                      resize:vertical;
                      font-family:inherit;
                      box-sizing:border-box;
                    "></textarea>
                  ` : `
                    <input type="${field.type === 'password' ? 'password' : field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : 'text'}" 
                      id="field-${field.key}" 
                      placeholder="Enter ${field.label.toLowerCase()}" 
                      ${field.required ? 'required' : ''}
                      style="
                        width:100%;
                        padding:12px 16px;
                        border:1px solid rgba(139, 92, 246,0.4);
                        border-radius:8px;
                        background:rgba(0,0,0,0.4);
                        color:#fff;
                        font-size:14px;
                        box-sizing:border-box;
                      "/>
                  `}
                </div>
              `
              i++
            }
            return fieldsHtml
          })()}
        </div>
      </div>
      
      <div style="margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <label style="font-size:13px;font-weight:600;color:rgba(255,255,255,0.9);">Custom Fields</label>
          <button type="button" id="vault-add-custom-field" style="
            padding:6px 12px;
            background:rgba(139,92,246,0.2);
            border:1px solid rgba(139,92,246,0.4);
            border-radius:6px;
            color:#a78bfa;
            font-size:12px;
            cursor:pointer;
          ">+ Add Custom Field</button>
        </div>
        <div id="vault-custom-fields" style="display:flex;flex-direction:column;gap:16px;">
          <!-- Custom fields will be added here -->
        </div>
      </div>
    `
    
    // Add custom field functionality
    const addCustomFieldBtn = dialog.querySelector('#vault-add-custom-field')
    const customFieldsContainer = dialog.querySelector('#vault-custom-fields') as HTMLElement
    
    addCustomFieldBtn?.addEventListener('click', () => {
      const customFieldDiv = document.createElement('div')
      customFieldDiv.style.cssText = 'background:rgba(139,92,246,0.05);border:1px solid rgba(139,92,246,0.2);border-radius:8px;padding:16px;'
      customFieldDiv.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <span style="font-size:12px;font-weight:600;color:rgba(255,255,255,0.8);">Custom Field</span>
          <button type="button" class="remove-custom-field" style="
            background:rgba(255,59,48,0.2);
            border:1px solid rgba(255,59,48,0.4);
            padding:4px 8px;
            border-radius:4px;
            color:#ff3b30;
            font-size:11px;
            cursor:pointer;
          ">Remove</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <input type="text" class="custom-field-name" placeholder="Field Name" style="
            width:100%;
            padding:10px 12px;
            border:1px solid rgba(139, 92, 246,0.3);
            border-radius:6px;
            background:rgba(0,0,0,0.3);
            color:#fff;
            font-size:13px;
            box-sizing:border-box;
          "/>
          <input type="text" class="custom-field-value" placeholder="Field Value" style="
            width:100%;
            padding:10px 12px;
            border:1px solid rgba(139, 92, 246,0.3);
            border-radius:6px;
            background:rgba(0,0,0,0.3);
            color:#fff;
            font-size:13px;
            box-sizing:border-box;
          "/>
          <div>
            <label style="display:block;font-size:11px;font-weight:600;margin-bottom:4px;color:rgba(255,255,255,0.7);">Additional Info</label>
            <div style="font-size:10px;color:rgba(255,255,255,0.5);margin-bottom:4px;font-style:italic;">💡 This information helps AI autofill match this data to forms more accurately</div>
            <textarea class="custom-field-explanation" placeholder="Additional context or notes..." style="
            width:100%;
            padding:10px 12px;
            border:1px solid rgba(139, 92, 246,0.3);
            border-radius:6px;
            background:rgba(0,0,0,0.3);
            color:#fff;
            font-size:13px;
            min-height:60px;
            resize:vertical;
            font-family:inherit;
            box-sizing:border-box;
          "></textarea>
          </div>
        </div>
      `
      customFieldsContainer.appendChild(customFieldDiv)
      
      customFieldDiv.querySelector('.remove-custom-field')?.addEventListener('click', () => {
        customFieldDiv.remove()
      })
    })
  }
  
  // Generate form - default to password if no preselected category
  generateForm(defaultCategory)
  
  // Update category select to match default
  categorySelect.value = defaultCategory
  
  categorySelect.addEventListener('change', () => {
    const selectedCategory = categorySelect.value
    if (selectedCategory) {
      generateForm(selectedCategory)
    }
  })
  
  // Close handlers
  const closeDialog = () => {
    overlay.remove()
  }
  
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
            password: 'service name',
            identity: 'identity name',
            company: 'company name',
            business: 'business name',
            custom: 'data group name'
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
        if (category === 'password') standardFields = PASSWORD_STANDARD_FIELDS
        else if (category === 'identity') standardFields = IDENTITY_STANDARD_FIELDS
        else if (category === 'company') standardFields = COMPANY_STANDARD_FIELDS
        else if (category === 'business') standardFields = BUSINESS_STANDARD_FIELDS
        
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
      }
      
      if (fields.length === 0) {
        alert('Please fill in at least one field')
        saveBtn.disabled = false
        saveBtn.style.opacity = '1'
        saveBtn.style.cursor = 'pointer'
        saveBtn.textContent = originalBtnText
        return
      }
      
      // For identity/company/business: Create container first, then item with container_id
      // For password/custom: Create item directly without container
      let containerId: string | undefined
      if (category === 'identity' || category === 'company' || category === 'business') {
        const containerType = category === 'identity' ? 'person' : category === 'company' ? 'company' : 'business'
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
      showSuccessNotification(`Successfully saved ${category === 'password' ? 'password' : category === 'identity' ? 'identity' : category === 'company' ? 'company' : category === 'business' ? 'business' : 'data'}!`)
      
      // Store current category view to refresh it
      const listDiv = container.querySelector('#vault-items-list') as HTMLElement
      const currentCategory = listDiv?.getAttribute('data-current-category') || category
      
      // Refresh dashboard and reload containers into tree
      renderVaultDashboard(container)
      
      // Small delay to ensure DOM is ready, then refresh items list
      setTimeout(() => {
        loadContainersIntoTree(container)
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
  
  // Click outside to close
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeDialog()
    }
  })
}

// Render Edit Data Dialog (similar to Add Data Dialog but pre-filled)
function renderEditDataDialog(container: HTMLElement, item: VaultItem) {
  // Reuse the add dialog function but with pre-filled data
  renderAddDataDialog(container, item.category as any)
  
  // Wait for dialog to be rendered, then fill in the data
  setTimeout(() => {
    const overlay = document.querySelector('#vault-add-data-overlay')
    const dialog = overlay?.querySelector('div') as HTMLElement
    if (!dialog) return
    
    // Set category (should already be set, but ensure it)
    const categorySelect = dialog.querySelector('#vault-add-category') as HTMLSelectElement
    if (categorySelect) {
      categorySelect.value = item.category
      categorySelect.dispatchEvent(new Event('change'))
    }
    
    // Fill in title (except for identity which generates from name fields)
    if (item.category !== 'identity') {
      const titleInput = dialog.querySelector('#vault-add-title') as HTMLInputElement
      if (titleInput) {
        titleInput.value = item.title
      }
    }
    
    // Fill in fields
    item.fields.forEach(field => {
      const input = dialog.querySelector(`#field-${field.key}`) as HTMLInputElement | HTMLTextAreaElement
      if (input) {
        input.value = field.value || ''
      }
    })
    
    // Update save button to say "Update" and change handler
    const saveBtn = dialog.querySelector('#vault-add-data-save') as HTMLElement
    if (saveBtn) {
      saveBtn.textContent = 'Update Data'
      
      // Remove old click handler and add new one for update
      const newSaveBtn = saveBtn.cloneNode(true) as HTMLElement
      saveBtn.parentNode?.replaceChild(newSaveBtn, saveBtn)
      
      newSaveBtn.addEventListener('click', async () => {
        const category = categorySelect.value
        
        let title: string
        if (category === 'identity') {
          const firstName = (dialog.querySelector('#field-first_name') as HTMLInputElement)?.value.trim()
          const surname = (dialog.querySelector('#field-surname') as HTMLInputElement)?.value.trim()
          if (!firstName || !surname) {
            alert('Please enter both first name and surname')
            return
          }
          title = `${firstName} ${surname}`
        } else {
          title = (dialog.querySelector('#vault-add-title') as HTMLInputElement)?.value.trim()
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
          else if (category === 'business') standardFields = BUSINESS_STANDARD_FIELDS
          
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
          
          if (fields.length === 0) {
            alert('Please fill in at least one field')
            return
          }
          
          // Update item
          await vaultAPI.updateItem(item.id, {
            title,
            fields,
            domain: category === 'password' ? (dialog.querySelector('#field-url') as HTMLInputElement)?.value.trim() : undefined
          })
          
          // Close dialog and refresh
          overlay?.remove()
          
          // Refresh the view
          if (item.container_id) {
            loadContainerItems(container, item.container_id)
          } else {
            loadVaultItems(container, item.category)
          }
          loadContainersIntoTree(container)
        } catch (err: any) {
          alert(`Error updating data: ${err.message || err}`)
          console.error('[VAULT UI] Error updating data:', err)
        }
      })
    }
  }, 100)
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
    color:#fff;
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
        <button id="settings-back-btn" style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);padding:8px 16px;border-radius:8px;color:#fff;cursor:pointer;">← Back</button>
        <h2 style="font-size:24px;font-weight:700;color:#fff;">Settings</h2>
      </div>

      <div style="background:rgba(139, 92, 246,0.05);border:1px solid rgba(139, 92, 246,0.2);border-radius:12px;padding:24px;margin-bottom:16px;">
        <h3 style="font-size:16px;font-weight:600;margin-bottom:16px;color:#fff;">Autolock Settings</h3>
        <label style="display:block;font-size:13px;color:rgba(255,255,255,0.7);margin-bottom:8px;">Lock vault after inactivity:</label>
        <select id="autolock-select" style="width:100%;min-height:44px;padding:12px 16px;padding-right:40px;background:rgba(0,0,0,0.4);border:1px solid rgba(139, 92, 246,0.4);border-radius:8px;color:#fff;font-size:14px;cursor:pointer;box-sizing:border-box;display:block;visibility:visible;opacity:1;appearance:none;-webkit-appearance:none;-moz-appearance:none;background-image:url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"12\" height=\"12\" viewBox=\"0 0 12 12\"><path fill=\"white\" d=\"M6 9L1 4h10z\"/></svg>');background-repeat:no-repeat;background-position:right 12px center;">
          <option value="0">Loading...</option>
        </select>
      </div>

      <div style="background:rgba(139, 92, 246,0.05);border:1px solid rgba(139, 92, 246,0.2);border-radius:12px;padding:24px;margin-bottom:16px;">
        <h3 style="font-size:16px;font-weight:600;margin-bottom:12px;color:#fff;">Export & Backup</h3>
        <p style="font-size:13px;color:rgba(255,255,255,0.7);margin-bottom:16px;">Export your vault data to a CSV file for backup purposes.</p>
        <button id="export-btn" style="padding:12px 24px;background:rgba(139, 92, 246,0.3);border:1px solid rgba(139, 92, 246,0.5);border-radius:8px;color:#fff;font-size:14px;cursor:pointer;transition:all 0.2s;">📥 Export to CSV</button>
      </div>

      <div style="background:rgba(255,59,48,0.05);border:1px solid rgba(255,59,48,0.2);border-radius:12px;padding:24px;">
        <h3 style="font-size:16px;font-weight:600;margin-bottom:12px;color:#ff3b30;">Danger Zone</h3>
        <p style="font-size:13px;color:rgba(255,255,255,0.7);margin-bottom:16px;">Permanently delete your vault and all stored data. This action cannot be undone.</p>
        <button id="delete-vault-btn" style="padding:12px 24px;background:rgba(255,59,48,0.2);border:1px solid rgba(255,59,48,0.4);border-radius:8px;color:#ff3b30;font-size:14px;font-weight:600;cursor:pointer;transition:all 0.2s;">🗑️ Delete Vault</button>
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

