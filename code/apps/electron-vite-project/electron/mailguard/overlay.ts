/**
 * WR MailGuard Overlay - Electron transparent overlay for Gmail protection
 * 
 * Creates a persistent transparent overlay over the browser that:
 * - Blocks direct clicks on emails
 * - Shows hover buttons when mouse is over email rows
 * - Displays sanitized emails in a lightbox
 */

import { BrowserWindow, screen, Display } from 'electron'

let mailguardOverlay: BrowserWindow | null = null
let isActive = false

export interface EmailRowRect {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface SanitizedEmail {
  from: string
  to: string
  subject: string
  date: string
  body: string
  attachments: { name: string; type: string }[]
}

/**
 * Activate MailGuard overlay on the specified display (or primary if not specified)
 */
export function activateMailGuard(targetDisplay?: Display): void {
  if (mailguardOverlay) {
    console.log('[MAILGUARD] Already active, closing existing overlay first')
    mailguardOverlay.close()
    mailguardOverlay = null
  }

  const display = targetDisplay || screen.getPrimaryDisplay()
  console.log('[MAILGUARD] Activating overlay on display:', display.id, 'bounds:', display.bounds)
  const { x, y, width, height } = display.bounds

  mailguardOverlay = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false, // Don't steal focus from browser
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  })

  mailguardOverlay.setAlwaysOnTop(true, 'screen-saver')
  mailguardOverlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  
  // Allow mouse events to pass through except on our UI elements
  mailguardOverlay.setIgnoreMouseEvents(true, { forward: true })

  const htmlContent = getOverlayHtml()
  mailguardOverlay.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent))

  mailguardOverlay.once('ready-to-show', () => {
    mailguardOverlay?.show()
    console.log('[MAILGUARD] Overlay shown')
  })

  mailguardOverlay.on('closed', () => {
    mailguardOverlay = null
    isActive = false
  })

  isActive = true
  console.log('[MAILGUARD] Overlay activated')
}

/**
 * Deactivate MailGuard overlay
 */
export function deactivateMailGuard(): void {
  if (mailguardOverlay) {
    console.log('[MAILGUARD] Deactivating overlay...')
    mailguardOverlay.close()
    mailguardOverlay = null
  }
  isActive = false
}

/**
 * Update email row positions (called from content script via WebSocket)
 */
export function updateEmailRows(rows: EmailRowRect[]): void {
  if (mailguardOverlay) {
    mailguardOverlay.webContents.send('mailguard-rows', rows)
  }
}

/**
 * Display sanitized email in the overlay lightbox
 */
export function showSanitizedEmail(email: SanitizedEmail): void {
  if (mailguardOverlay) {
    mailguardOverlay.webContents.send('mailguard-show-email', email)
    // Enable mouse events on overlay when lightbox is open
    mailguardOverlay.setIgnoreMouseEvents(false)
  }
}

/**
 * Close the email lightbox
 */
export function closeLightbox(): void {
  if (mailguardOverlay) {
    mailguardOverlay.webContents.send('mailguard-close-lightbox')
    // Re-enable mouse passthrough
    mailguardOverlay.setIgnoreMouseEvents(true, { forward: true })
  }
}

export function isMailGuardActive(): boolean {
  return isActive
}

/**
 * Generate the overlay HTML with embedded styles and scripts
 */
function getOverlayHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%;
      height: 100%;
      background: transparent;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    
    /* Status badge */
    #status-badge {
      position: fixed;
      top: 10px;
      right: 10px;
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      border: 1px solid #22c55e;
      border-radius: 20px;
      padding: 8px 16px;
      display: flex;
      align-items: center;
      gap: 8px;
      color: #22c55e;
      font-size: 12px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.4);
      z-index: 9999;
      pointer-events: auto;
      cursor: pointer;
    }
    #status-badge:hover {
      border-color: #ef4444;
      color: #ef4444;
    }
    
    /* Hover button container */
    #hover-buttons {
      position: fixed;
      display: none;
      gap: 8px;
      z-index: 9998;
      pointer-events: auto;
    }
    #hover-buttons.visible {
      display: flex;
    }
    .hover-btn {
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      border: 1px solid #3b82f6;
      border-radius: 8px;
      padding: 10px 16px;
      color: #fff;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      transition: all 0.15s;
      white-space: nowrap;
    }
    .hover-btn:hover {
      background: #3b82f6;
      transform: translateY(-2px);
      box-shadow: 0 6px 25px rgba(59,130,246,0.5);
    }
    .hover-btn .icon { font-size: 16px; }
    
    /* Lightbox overlay */
    #lightbox {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.8);
      display: none;
      justify-content: center;
      align-items: center;
      z-index: 10000;
      padding: 40px;
    }
    #lightbox.visible {
      display: flex;
    }
    
    .modal {
      background: #fff;
      border-radius: 16px;
      max-width: 900px;
      width: 100%;
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 25px 100px rgba(0,0,0,0.6);
      overflow: hidden;
    }
    
    .modal-header {
      padding: 20px 24px;
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #3b82f6;
    }
    .modal-title {
      font-size: 18px;
      font-weight: 600;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .modal-title .shield { color: #22c55e; font-size: 24px; }
    .close-btn {
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.2);
      width: 36px;
      height: 36px;
      border-radius: 50%;
      font-size: 20px;
      cursor: pointer;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }
    .close-btn:hover {
      background: #ef4444;
      border-color: #ef4444;
    }
    
    .modal-body {
      padding: 24px;
      overflow-y: auto;
      flex: 1;
    }
    
    .safe-notice {
      background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
      border: 1px solid #22c55e;
      border-radius: 10px;
      padding: 14px 18px;
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      gap: 14px;
      font-size: 13px;
      color: #166534;
    }
    .safe-notice .icon { font-size: 20px; }
    
    .email-meta {
      background: #f8fafc;
      border-radius: 10px;
      padding: 18px;
      margin-bottom: 20px;
    }
    .meta-row {
      display: flex;
      margin-bottom: 10px;
      font-size: 14px;
    }
    .meta-row:last-child { margin-bottom: 0; }
    .meta-label {
      color: #64748b;
      width: 80px;
      flex-shrink: 0;
      font-weight: 500;
    }
    .meta-value {
      color: #1e293b;
      word-break: break-word;
    }
    
    .subject {
      font-size: 22px;
      font-weight: 600;
      color: #1e293b;
      margin: 20px 0;
      line-height: 1.4;
    }
    
    .email-body {
      font-size: 15px;
      line-height: 1.8;
      color: #374151;
      white-space: pre-wrap;
      word-wrap: break-word;
      padding: 20px;
      background: #fafafa;
      border-radius: 10px;
      border: 1px solid #e5e7eb;
      min-height: 200px;
    }
    
    .attachments {
      margin-top: 24px;
      padding-top: 24px;
      border-top: 1px solid #e5e7eb;
    }
    .attachments-title {
      font-size: 15px;
      font-weight: 600;
      color: #1e293b;
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .attachment-list {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    .attachment-item {
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      transition: all 0.15s;
      font-size: 13px;
      color: #475569;
    }
    .attachment-item:hover {
      background: #e2e8f0;
      border-color: #3b82f6;
    }
    
    .loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 80px;
      color: #64748b;
      font-size: 15px;
      gap: 20px;
    }
    .spinner {
      width: 48px;
      height: 48px;
      border: 4px solid #e2e8f0;
      border-top-color: #3b82f6;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <!-- Status Badge -->
  <div id="status-badge" title="Click to disable MailGuard">
    <span>🛡️</span>
    <span>MailGuard Active</span>
  </div>
  
  <!-- Hover Buttons -->
  <div id="hover-buttons">
    <button class="hover-btn" id="btn-safe-email">
      <span class="icon">🛡️</span>
      Open Safe Email
    </button>
    <button class="hover-btn" id="btn-safe-pdf" style="display:none">
      <span class="icon">📄</span>
      View Safe PDF
    </button>
  </div>
  
  <!-- Lightbox -->
  <div id="lightbox">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">
          <span class="shield">🛡️</span>
          Safe Email View
        </div>
        <button class="close-btn" id="close-lightbox">×</button>
      </div>
      <div class="modal-body" id="email-content">
        <div class="loading">
          <div class="spinner"></div>
          <span>Loading email safely...</span>
        </div>
      </div>
    </div>
  </div>
  
  <script>
    const { ipcRenderer } = require('electron');
    
    let currentRows = [];
    let hoveredRowId = null;
    
    const badge = document.getElementById('status-badge');
    const hoverButtons = document.getElementById('hover-buttons');
    const btnSafeEmail = document.getElementById('btn-safe-email');
    const lightbox = document.getElementById('lightbox');
    const emailContent = document.getElementById('email-content');
    const closeBtn = document.getElementById('close-lightbox');
    
    // Handle badge click - disable MailGuard
    badge.addEventListener('click', () => {
      ipcRenderer.send('mailguard-disable');
    });
    
    // Handle safe email button click
    btnSafeEmail.addEventListener('click', () => {
      if (hoveredRowId) {
        lightbox.classList.add('visible');
        emailContent.innerHTML = '<div class="loading"><div class="spinner"></div><span>Loading email safely...</span></div>';
        ipcRenderer.send('mailguard-open-email', hoveredRowId);
      }
    });
    
    // Handle lightbox close
    closeBtn.addEventListener('click', () => {
      lightbox.classList.remove('visible');
      ipcRenderer.send('mailguard-lightbox-closed');
    });
    
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) {
        lightbox.classList.remove('visible');
        ipcRenderer.send('mailguard-lightbox-closed');
      }
    });
    
    // Escape to close lightbox
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && lightbox.classList.contains('visible')) {
        lightbox.classList.remove('visible');
        ipcRenderer.send('mailguard-lightbox-closed');
      }
    });
    
    // Track mouse position and show/hide hover buttons
    document.addEventListener('mousemove', (e) => {
      if (lightbox.classList.contains('visible')) return;
      
      const x = e.clientX;
      const y = e.clientY;
      
      // Find if we're hovering over any email row
      let found = null;
      for (const row of currentRows) {
        if (x >= row.x && x <= row.x + row.width &&
            y >= row.y && y <= row.y + row.height) {
          found = row;
          break;
        }
      }
      
      if (found) {
        hoveredRowId = found.id;
        // Position buttons at the right side of the row
        hoverButtons.style.left = (found.x + found.width - 180) + 'px';
        hoverButtons.style.top = (found.y + found.height / 2 - 20) + 'px';
        hoverButtons.classList.add('visible');
      } else {
        // Only hide if not hovering over the buttons themselves
        const btnRect = hoverButtons.getBoundingClientRect();
        if (!(x >= btnRect.left && x <= btnRect.right &&
              y >= btnRect.top && y <= btnRect.bottom)) {
          hoverButtons.classList.remove('visible');
          hoveredRowId = null;
        }
      }
    });
    
    // Receive email row positions from content script
    ipcRenderer.on('mailguard-rows', (event, rows) => {
      currentRows = rows;
    });
    
    // Receive sanitized email to display
    ipcRenderer.on('mailguard-show-email', (event, email) => {
      let attachmentsHtml = '';
      if (email.attachments && email.attachments.length > 0) {
        const items = email.attachments.map(att => 
          '<div class="attachment-item"><span>📎</span><span>' + escapeHtml(att.name) + '</span></div>'
        ).join('');
        attachmentsHtml = '<div class="attachments"><div class="attachments-title"><span>📎</span>Attachments</div><div class="attachment-list">' + items + '</div></div>';
      }
      
      emailContent.innerHTML = 
        '<div class="safe-notice"><span class="icon">🛡️</span><span>This is a sanitized view. Scripts, tracking, and active content have been removed.</span></div>' +
        '<div class="email-meta">' +
          '<div class="meta-row"><span class="meta-label">From:</span><span class="meta-value">' + escapeHtml(email.from || '(unknown)') + '</span></div>' +
          '<div class="meta-row"><span class="meta-label">To:</span><span class="meta-value">' + escapeHtml(email.to || '(unknown)') + '</span></div>' +
          '<div class="meta-row"><span class="meta-label">Date:</span><span class="meta-value">' + escapeHtml(email.date || '(unknown)') + '</span></div>' +
        '</div>' +
        '<div class="subject">' + escapeHtml(email.subject || '(no subject)') + '</div>' +
        '<div class="email-body">' + escapeHtml(email.body || '(no content)') + '</div>' +
        attachmentsHtml;
    });
    
    // Close lightbox command
    ipcRenderer.on('mailguard-close-lightbox', () => {
      lightbox.classList.remove('visible');
    });
    
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  </script>
</body>
</html>`
}

