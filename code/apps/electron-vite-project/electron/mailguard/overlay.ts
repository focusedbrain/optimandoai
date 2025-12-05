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
  
  // Capture ALL mouse events - users cannot click through to Gmail
  mailguardOverlay.setIgnoreMouseEvents(false)

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
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      /* Light transparent overlay - can see through clearly */
      background: rgba(15, 23, 42, 0.15);
      cursor: default;
    }
    
    /* Status badge - compact */
    #status-badge {
      position: fixed;
      top: 12px;
      right: 12px;
      background: rgba(15, 23, 42, 0.95);
      border: 1px solid #22c55e;
      border-radius: 10px;
      padding: 10px 16px;
      display: flex;
      align-items: center;
      gap: 10px;
      color: #22c55e;
      font-size: 12px;
      font-weight: 600;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 9999;
      cursor: pointer;
    }
    #status-badge:hover {
      border-color: #ef4444;
      color: #ef4444;
    }
    #status-badge .icon { font-size: 16px; }
    #status-badge .pulse {
      width: 6px;
      height: 6px;
      background: #22c55e;
      border-radius: 50%;
    }
    
    /* Hover button container */
    #hover-buttons {
      position: fixed;
      display: none;
      gap: 8px;
      z-index: 9998;
    }
    #hover-buttons.visible {
      display: flex;
    }
    .hover-btn {
      background: rgba(15, 23, 42, 0.95);
      border: 1px solid #3b82f6;
      border-radius: 8px;
      padding: 12px 18px;
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.3);
      white-space: nowrap;
    }
    .hover-btn:hover {
      background: #3b82f6;
    }
    .hover-btn .icon { font-size: 16px; }
    
    /* Lightbox overlay */
    #lightbox {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.85);
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
      box-shadow: 0 25px 80px rgba(0,0,0,0.5);
      overflow: hidden;
    }
    
    .modal-header {
      padding: 20px 24px;
      background: #0f172a;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #3b82f6;
    }
    .modal-title {
      font-size: 16px;
      font-weight: 600;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .modal-title .shield { 
      color: #22c55e; 
      font-size: 22px;
    }
    .modal-title .verified {
      background: #22c55e;
      color: #fff;
      font-size: 10px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 12px;
      text-transform: uppercase;
    }
    .close-btn {
      background: rgba(255,255,255,0.1);
      border: none;
      width: 36px;
      height: 36px;
      border-radius: 8px;
      font-size: 20px;
      cursor: pointer;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .close-btn:hover {
      background: #ef4444;
    }
    
    .modal-body {
      padding: 24px;
      overflow-y: auto;
      flex: 1;
    }
    
    .safe-notice {
      background: #f0fdf4;
      border: 1px solid #22c55e;
      border-radius: 10px;
      padding: 14px 18px;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 13px;
      color: #166534;
    }
    .safe-notice .icon { font-size: 20px; }
    
    .email-meta {
      background: #f8fafc;
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 20px;
    }
    .meta-row {
      display: flex;
      margin-bottom: 8px;
      font-size: 14px;
    }
    .meta-row:last-child { margin-bottom: 0; }
    .meta-label {
      color: #64748b;
      width: 70px;
      flex-shrink: 0;
      font-weight: 500;
    }
    .meta-value {
      color: #1e293b;
      word-break: break-word;
    }
    
    .subject {
      font-size: 20px;
      font-weight: 600;
      color: #0f172a;
      margin: 16px 0;
      line-height: 1.4;
    }
    
    .email-body {
      font-size: 14px;
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
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
    }
    .attachments-title {
      font-size: 14px;
      font-weight: 600;
      color: #0f172a;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .attachment-list {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .attachment-item {
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
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
      padding: 60px;
      color: #64748b;
      font-size: 14px;
      gap: 16px;
    }
    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid #e2e8f0;
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
  <div id="status-badge" title="Click to disable (or press Escape)">
    <span class="pulse"></span>
    <span class="icon">🛡️</span>
    <span>MailGuard</span>
  </div>
  
  <!-- Hover Buttons -->
  <div id="hover-buttons">
    <button class="hover-btn" id="btn-safe-email">
      <span class="icon">🔒</span>
      Open Safe Email
    </button>
  </div>
  
  <!-- Lightbox -->
  <div id="lightbox">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">
          <span class="shield">🛡️</span>
          <span>Secure Email Viewer</span>
          <span class="verified">Verified Safe</span>
        </div>
        <button class="close-btn" id="close-lightbox">×</button>
      </div>
      <div class="modal-body" id="email-content">
        <div class="loading">
          <div class="spinner"></div>
          <span>Scanning and sanitizing email...</span>
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
        emailContent.innerHTML = '<div class="loading"><div class="spinner"></div><span>Scanning and sanitizing email content...</span></div>';
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
      if (e.key === 'Escape') {
        if (lightbox.classList.contains('visible')) {
          lightbox.classList.remove('visible');
          ipcRenderer.send('mailguard-lightbox-closed');
        } else {
          // Escape also disables MailGuard
          ipcRenderer.send('mailguard-disable');
        }
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
        // Position buttons at the center-right of the row
        hoverButtons.style.left = (found.x + found.width - 180) + 'px';
        hoverButtons.style.top = (found.y + found.height / 2 - 22) + 'px';
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

