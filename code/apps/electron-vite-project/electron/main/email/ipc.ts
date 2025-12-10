/**
 * Email Gateway IPC Handlers
 * 
 * Electron IPC interface for the email gateway.
 * These handlers expose email operations to the renderer process.
 */

import { ipcMain, BrowserWindow } from 'electron'
import { emailGateway } from './gateway'
import { saveOAuthConfig } from './providers/gmail'
import { saveOutlookOAuthConfig } from './providers/outlook'
import {
  MessageSearchOptions,
  SendEmailPayload,
  IMAP_PRESETS
} from './types'

/**
 * Register all email-related IPC handlers
 */
export function registerEmailHandlers(): void {
  console.log('[Email IPC] Registering handlers...')
  
  // =================================================================
  // Account Management
  // =================================================================
  
  /**
   * List all email accounts
   */
  ipcMain.handle('email:listAccounts', async () => {
    try {
      const accounts = await emailGateway.listAccounts()
      return { ok: true, data: accounts }
    } catch (error: any) {
      console.error('[Email IPC] listAccounts error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Get a single account
   */
  ipcMain.handle('email:getAccount', async (_e, accountId: string) => {
    try {
      const account = await emailGateway.getAccount(accountId)
      return { ok: true, data: account }
    } catch (error: any) {
      console.error('[Email IPC] getAccount error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Delete an account
   */
  ipcMain.handle('email:deleteAccount', async (_e, accountId: string) => {
    try {
      await emailGateway.deleteAccount(accountId)
      return { ok: true }
    } catch (error: any) {
      console.error('[Email IPC] deleteAccount error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Test account connection
   */
  ipcMain.handle('email:testConnection', async (_e, accountId: string) => {
    try {
      const result = await emailGateway.testConnection(accountId)
      return { ok: true, data: result }
    } catch (error: any) {
      console.error('[Email IPC] testConnection error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  // =================================================================
  // OAuth/Setup Flows
  // =================================================================
  
  /**
   * Get available IMAP presets
   */
  ipcMain.handle('email:getImapPresets', async () => {
    return { ok: true, data: IMAP_PRESETS }
  })
  
  /**
   * Set Gmail OAuth credentials
   */
  ipcMain.handle('email:setGmailCredentials', async (_e, clientId: string, clientSecret: string) => {
    try {
      saveOAuthConfig(clientId, clientSecret)
      return { ok: true }
    } catch (error: any) {
      console.error('[Email IPC] setGmailCredentials error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Start Gmail OAuth flow
   */
  ipcMain.handle('email:connectGmail', async (_e, displayName?: string) => {
    try {
      const account = await emailGateway.connectGmailAccount(displayName)
      return { ok: true, data: account }
    } catch (error: any) {
      console.error('[Email IPC] connectGmail error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Show Gmail credentials setup dialog
   */
  ipcMain.handle('email:showGmailSetup', async () => {
    try {
      const result = await showGmailSetupDialog()
      return { ok: true, data: result }
    } catch (error: any) {
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Set Outlook OAuth credentials
   */
  ipcMain.handle('email:setOutlookCredentials', async (_e, clientId: string, clientSecret: string) => {
    try {
      saveOutlookOAuthConfig(clientId, clientSecret)
      return { ok: true }
    } catch (error: any) {
      console.error('[Email IPC] setOutlookCredentials error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Start Outlook OAuth flow
   */
  ipcMain.handle('email:connectOutlook', async (_e, displayName?: string) => {
    try {
      const account = await emailGateway.connectOutlookAccount(displayName)
      return { ok: true, data: account }
    } catch (error: any) {
      console.error('[Email IPC] connectOutlook error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Show Outlook credentials setup dialog
   */
  ipcMain.handle('email:showOutlookSetup', async () => {
    try {
      const result = await showOutlookSetupDialog()
      return { ok: true, data: result }
    } catch (error: any) {
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Connect IMAP account
   */
  ipcMain.handle('email:connectImap', async (_e, config: {
    displayName: string
    email: string
    host: string
    port: number
    username: string
    password: string
    security: 'ssl' | 'starttls' | 'none'
  }) => {
    try {
      const account = await emailGateway.connectImapAccount(config)
      return { ok: true, data: account }
    } catch (error: any) {
      console.error('[Email IPC] connectImap error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  // =================================================================
  // Message Operations
  // =================================================================
  
  /**
   * List messages from an account
   */
  ipcMain.handle('email:listMessages', async (
    _e, 
    accountId: string, 
    options?: MessageSearchOptions
  ) => {
    try {
      const messages = await emailGateway.listMessages(accountId, options)
      return { ok: true, data: messages }
    } catch (error: any) {
      console.error('[Email IPC] listMessages error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Get a single message with full body
   */
  ipcMain.handle('email:getMessage', async (_e, accountId: string, messageId: string) => {
    try {
      const message = await emailGateway.getMessage(accountId, messageId)
      return { ok: true, data: message }
    } catch (error: any) {
      console.error('[Email IPC] getMessage error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Mark message as read
   */
  ipcMain.handle('email:markAsRead', async (_e, accountId: string, messageId: string) => {
    try {
      await emailGateway.markAsRead(accountId, messageId)
      return { ok: true }
    } catch (error: any) {
      console.error('[Email IPC] markAsRead error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Mark message as unread
   */
  ipcMain.handle('email:markAsUnread', async (_e, accountId: string, messageId: string) => {
    try {
      await emailGateway.markAsUnread(accountId, messageId)
      return { ok: true }
    } catch (error: any) {
      console.error('[Email IPC] markAsUnread error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Flag/unflag message
   */
  ipcMain.handle('email:flagMessage', async (
    _e, 
    accountId: string, 
    messageId: string, 
    flagged: boolean
  ) => {
    try {
      await emailGateway.flagMessage(accountId, messageId, flagged)
      return { ok: true }
    } catch (error: any) {
      console.error('[Email IPC] flagMessage error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  // =================================================================
  // Attachment Operations
  // =================================================================
  
  /**
   * List attachments for a message
   */
  ipcMain.handle('email:listAttachments', async (
    _e, 
    accountId: string, 
    messageId: string
  ) => {
    try {
      const attachments = await emailGateway.listAttachments(accountId, messageId)
      return { ok: true, data: attachments }
    } catch (error: any) {
      console.error('[Email IPC] listAttachments error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Extract text from PDF attachment
   */
  ipcMain.handle('email:extractAttachmentText', async (
    _e,
    accountId: string,
    messageId: string,
    attachmentId: string
  ) => {
    try {
      const result = await emailGateway.extractAttachmentText(accountId, messageId, attachmentId)
      return { ok: true, data: result }
    } catch (error: any) {
      console.error('[Email IPC] extractAttachmentText error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  // =================================================================
  // Send Operations
  // =================================================================
  
  /**
   * Send a reply
   */
  ipcMain.handle('email:sendReply', async (
    _e,
    accountId: string,
    messageId: string,
    payload: Omit<SendEmailPayload, 'inReplyTo' | 'references'>
  ) => {
    try {
      const result = await emailGateway.sendReply(accountId, messageId, payload)
      return { ok: true, data: result }
    } catch (error: any) {
      console.error('[Email IPC] sendReply error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Send a new email
   */
  ipcMain.handle('email:sendEmail', async (
    _e,
    accountId: string,
    payload: SendEmailPayload
  ) => {
    try {
      const result = await emailGateway.sendEmail(accountId, payload)
      return { ok: true, data: result }
    } catch (error: any) {
      console.error('[Email IPC] sendEmail error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  // =================================================================
  // Sync Operations
  // =================================================================
  
  /**
   * Sync an account
   */
  ipcMain.handle('email:syncAccount', async (_e, accountId: string) => {
    try {
      const status = await emailGateway.syncAccount(accountId)
      return { ok: true, data: status }
    } catch (error: any) {
      console.error('[Email IPC] syncAccount error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Get sync status
   */
  ipcMain.handle('email:getSyncStatus', async (_e, accountId: string) => {
    try {
      const status = await emailGateway.getSyncStatus(accountId)
      return { ok: true, data: status }
    } catch (error: any) {
      console.error('[Email IPC] getSyncStatus error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  console.log('[Email IPC] Handlers registered')
}

/**
 * Show Gmail OAuth credentials setup dialog
 */
export async function showGmailSetupDialog(): Promise<{ success: boolean }> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 550,
      height: 520,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      },
      title: 'Connect Gmail Account',
      resizable: false,
      alwaysOnTop: true,
      show: true,
      center: true,
      skipTaskbar: false
    })
    
    // Ensure window is visible and focused
    win.show()
    win.focus()
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 32px;
            background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
            min-height: 100vh;
          }
          h2 { 
            color: #0f172a; 
            margin-bottom: 8px; 
            font-size: 22px;
            display: flex;
            align-items: center;
            gap: 10px;
          }
          .subtitle {
            color: #64748b;
            font-size: 14px;
            margin-bottom: 24px;
            line-height: 1.5;
          }
          .step {
            background: white;
            border-radius: 12px;
            padding: 16px;
            margin-bottom: 16px;
            border: 1px solid #e2e8f0;
          }
          .step-header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 10px;
          }
          .step-num {
            background: #3b82f6;
            color: white;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 13px;
            font-weight: 600;
          }
          .step-title { font-weight: 600; color: #1e293b; font-size: 14px; }
          .step-desc { color: #64748b; font-size: 13px; line-height: 1.5; }
          .link {
            color: #3b82f6;
            text-decoration: none;
            cursor: pointer;
          }
          .link:hover { text-decoration: underline; }
          label { 
            display: block; 
            color: #374151; 
            font-size: 13px; 
            font-weight: 500; 
            margin-bottom: 6px;
            margin-top: 16px;
          }
          input { 
            width: 100%; 
            padding: 10px 12px; 
            border: 1px solid #d1d5db; 
            border-radius: 8px; 
            font-size: 14px;
            background: white;
          }
          input:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
          .buttons { 
            display: flex; 
            gap: 12px; 
            margin-top: 24px;
            justify-content: flex-end;
          }
          button {
            padding: 10px 20px;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s;
          }
          .primary { 
            background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
            color: white;
            box-shadow: 0 2px 8px rgba(59,130,246,0.3);
          }
          .primary:hover { 
            background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
            transform: translateY(-1px);
          }
          .primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
          }
          .secondary { 
            background: white;
            border: 1px solid #d1d5db;
            color: #374151;
          }
          .secondary:hover { background: #f8fafc; }
          .error {
            color: #dc2626;
            font-size: 13px;
            margin-top: 8px;
            display: none;
          }
        </style>
      </head>
      <body>
        <h2>📧 Connect Gmail</h2>
        <p class="subtitle">
          To read your emails securely, you need to set up Gmail API access.
          This is a one-time setup that takes about 2 minutes.
        </p>
        
        <div class="step">
          <div class="step-header">
            <span class="step-num">1</span>
            <span class="step-title">Create Google Cloud Project</span>
          </div>
          <p class="step-desc">
            Go to <a class="link" id="openConsole">Google Cloud Console</a> and create a new project 
            (or use an existing one).
          </p>
        </div>
        
        <div class="step">
          <div class="step-header">
            <span class="step-num">2</span>
            <span class="step-title">Enable Gmail API</span>
          </div>
          <p class="step-desc">
            In your project, go to "APIs & Services" → "Enable APIs" → search for "Gmail API" → Enable it.
          </p>
        </div>
        
        <div class="step">
          <div class="step-header">
            <span class="step-num">3</span>
            <span class="step-title">Create OAuth Credentials</span>
          </div>
          <p class="step-desc">
            Go to "Credentials" → "Create Credentials" → "OAuth client ID" → Choose "Desktop app".
            Copy the Client ID and Client Secret below.
          </p>
          
          <label>Client ID</label>
          <input type="text" id="clientId" placeholder="xxxxx.apps.googleusercontent.com">
          
          <label>Client Secret</label>
          <input type="password" id="clientSecret" placeholder="GOCSPX-xxxxx">
          
          <p class="error" id="error"></p>
        </div>
        
        <div class="buttons">
          <button class="secondary" onclick="window.close()">Cancel</button>
          <button class="primary" id="connectBtn" onclick="connect()">Connect Gmail</button>
        </div>
        
        <script>
          const { ipcRenderer, shell } = require('electron');
          
          document.getElementById('openConsole').onclick = (e) => {
            e.preventDefault();
            shell.openExternal('https://console.cloud.google.com/apis/credentials');
          };
          
          async function connect() {
            const clientId = document.getElementById('clientId').value.trim();
            const clientSecret = document.getElementById('clientSecret').value.trim();
            const error = document.getElementById('error');
            const btn = document.getElementById('connectBtn');
            
            if (!clientId || !clientSecret) {
              error.textContent = 'Please enter both Client ID and Client Secret';
              error.style.display = 'block';
              return;
            }
            
            error.style.display = 'none';
            btn.disabled = true;
            btn.textContent = 'Connecting...';
            
            try {
              // Save credentials
              await ipcRenderer.invoke('email:setGmailCredentials', clientId, clientSecret);
              
              // Start OAuth flow
              const result = await ipcRenderer.invoke('email:connectGmail', 'Gmail');
              
              if (result.ok) {
                ipcRenderer.send('gmail-setup-complete', { success: true });
                window.close();
              } else {
                error.textContent = result.error || 'Failed to connect';
                error.style.display = 'block';
                btn.disabled = false;
                btn.textContent = 'Connect Gmail';
              }
            } catch (err) {
              error.textContent = err.message || 'An error occurred';
              error.style.display = 'block';
              btn.disabled = false;
              btn.textContent = 'Connect Gmail';
            }
          }
        </script>
      </body>
      </html>
    `
    
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    
    let resolved = false
    
    const handleComplete = (_e: any, result: any) => {
      if (resolved) return
      resolved = true
      ipcMain.removeListener('gmail-setup-complete', handleComplete)
      resolve(result)
    }
    
    ipcMain.once('gmail-setup-complete', handleComplete)
    
    win.on('closed', () => {
      if (resolved) return
      resolved = true
      ipcMain.removeListener('gmail-setup-complete', handleComplete)
      resolve({ success: false })
    })
  })
}

/**
 * Show Outlook OAuth credentials setup dialog
 */
export async function showOutlookSetupDialog(): Promise<{ success: boolean }> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 550,
      height: 560,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      },
      title: 'Connect Microsoft 365 / Outlook',
      resizable: false,
      alwaysOnTop: true,
      show: true,
      center: true,
      skipTaskbar: false
    })
    
    // Ensure window is visible and focused
    win.show()
    win.focus()
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 32px;
            background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
            min-height: 100vh;
          }
          h2 { 
            color: #0f172a; 
            margin-bottom: 8px; 
            font-size: 22px;
            display: flex;
            align-items: center;
            gap: 10px;
          }
          .subtitle {
            color: #64748b;
            font-size: 14px;
            margin-bottom: 24px;
            line-height: 1.5;
          }
          .step {
            background: white;
            border-radius: 12px;
            padding: 16px;
            margin-bottom: 16px;
            border: 1px solid #e2e8f0;
          }
          .step-header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 10px;
          }
          .step-num {
            background: #0078d4;
            color: white;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 13px;
            font-weight: 600;
          }
          .step-title { font-weight: 600; color: #1e293b; font-size: 14px; }
          .step-desc { color: #64748b; font-size: 13px; line-height: 1.5; }
          .link {
            color: #0078d4;
            text-decoration: none;
            cursor: pointer;
          }
          .link:hover { text-decoration: underline; }
          label { 
            display: block; 
            color: #374151; 
            font-size: 13px; 
            font-weight: 500; 
            margin-bottom: 6px;
            margin-top: 16px;
          }
          input { 
            width: 100%; 
            padding: 10px 12px; 
            border: 1px solid #d1d5db; 
            border-radius: 8px; 
            font-size: 14px;
            background: white;
          }
          input:focus { outline: none; border-color: #0078d4; box-shadow: 0 0 0 3px rgba(0,120,212,0.1); }
          .buttons { 
            display: flex; 
            gap: 12px; 
            margin-top: 24px;
            justify-content: flex-end;
          }
          button {
            padding: 10px 20px;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s;
          }
          .primary { 
            background: linear-gradient(135deg, #0078d4 0%, #106ebe 100%);
            color: white;
            box-shadow: 0 2px 8px rgba(0,120,212,0.3);
          }
          .primary:hover { 
            background: linear-gradient(135deg, #106ebe 0%, #005a9e 100%);
            transform: translateY(-1px);
          }
          .primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
          }
          .secondary { 
            background: white;
            border: 1px solid #d1d5db;
            color: #374151;
          }
          .secondary:hover { background: #f8fafc; }
          .error {
            color: #dc2626;
            font-size: 13px;
            margin-top: 8px;
            display: none;
          }
        </style>
      </head>
      <body>
        <h2>📨 Connect Microsoft 365</h2>
        <p class="subtitle">
          To read your emails securely, you need to set up Azure AD app access.
          This is a one-time setup that takes about 3 minutes.
        </p>
        
        <div class="step">
          <div class="step-header">
            <span class="step-num">1</span>
            <span class="step-title">Register Azure AD App</span>
          </div>
          <p class="step-desc">
            Go to <a class="link" id="openAzure">Azure Portal</a> → Azure Active Directory → 
            App registrations → New registration. Set redirect URI to: <code>http://localhost:51249/callback</code>
          </p>
        </div>
        
        <div class="step">
          <div class="step-header">
            <span class="step-num">2</span>
            <span class="step-title">Add API Permissions</span>
          </div>
          <p class="step-desc">
            In your app, go to "API permissions" → Add: Mail.Read, Mail.ReadWrite, Mail.Send, User.Read (delegated).
          </p>
        </div>
        
        <div class="step">
          <div class="step-header">
            <span class="step-num">3</span>
            <span class="step-title">Create Client Secret</span>
          </div>
          <p class="step-desc">
            Go to "Certificates & secrets" → New client secret. Copy the Application (client) ID 
            and the secret value below.
          </p>
          
          <label>Application (Client) ID</label>
          <input type="text" id="clientId" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx">
          
          <label>Client Secret</label>
          <input type="password" id="clientSecret" placeholder="Your client secret value">
          
          <p class="error" id="error"></p>
        </div>
        
        <div class="buttons">
          <button class="secondary" onclick="window.close()">Cancel</button>
          <button class="primary" id="connectBtn" onclick="connect()">Connect Outlook</button>
        </div>
        
        <script>
          const { ipcRenderer, shell } = require('electron');
          
          document.getElementById('openAzure').onclick = (e) => {
            e.preventDefault();
            shell.openExternal('https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade');
          };
          
          async function connect() {
            const clientId = document.getElementById('clientId').value.trim();
            const clientSecret = document.getElementById('clientSecret').value.trim();
            const error = document.getElementById('error');
            const btn = document.getElementById('connectBtn');
            
            if (!clientId || !clientSecret) {
              error.textContent = 'Please enter both Client ID and Client Secret';
              error.style.display = 'block';
              return;
            }
            
            error.style.display = 'none';
            btn.disabled = true;
            btn.textContent = 'Connecting...';
            
            try {
              // Save credentials
              await ipcRenderer.invoke('email:setOutlookCredentials', clientId, clientSecret);
              
              // Start OAuth flow
              const result = await ipcRenderer.invoke('email:connectOutlook', 'Outlook');
              
              if (result.ok) {
                ipcRenderer.send('outlook-setup-complete', { success: true });
                window.close();
              } else {
                error.textContent = result.error || 'Failed to connect';
                error.style.display = 'block';
                btn.disabled = false;
                btn.textContent = 'Connect Outlook';
              }
            } catch (err) {
              error.textContent = err.message || 'An error occurred';
              error.style.display = 'block';
              btn.disabled = false;
              btn.textContent = 'Connect Outlook';
            }
          }
        </script>
      </body>
      </html>
    `
    
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    
    let resolved = false
    
    const handleComplete = (_e: any, result: any) => {
      if (resolved) return
      resolved = true
      ipcMain.removeListener('outlook-setup-complete', handleComplete)
      resolve(result)
    }
    
    ipcMain.once('outlook-setup-complete', handleComplete)
    
    win.on('closed', () => {
      if (resolved) return
      resolved = true
      ipcMain.removeListener('outlook-setup-complete', handleComplete)
      resolve({ success: false })
    })
  })
}

