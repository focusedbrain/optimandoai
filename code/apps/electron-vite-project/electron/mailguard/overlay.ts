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
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      /* Dark transparent overlay covering everything */
      background: rgba(15, 23, 42, 0.85);
      cursor: not-allowed;
    }
    
    /* Scan line effect for cybersecurity feel */
    body::before {
      content: '';
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: repeating-linear-gradient(
        0deg,
        transparent,
        transparent 2px,
        rgba(0, 0, 0, 0.03) 2px,
        rgba(0, 0, 0, 0.03) 4px
      );
      pointer-events: none;
      z-index: 1;
    }
    
    /* Subtle grid pattern */
    body::after {
      content: '';
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-image: 
        linear-gradient(rgba(59, 130, 246, 0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(59, 130, 246, 0.03) 1px, transparent 1px);
      background-size: 50px 50px;
      pointer-events: none;
      z-index: 1;
    }
    
    /* Status badge - premium floating card */
    #status-badge {
      position: fixed;
      top: 20px;
      right: 20px;
      background: linear-gradient(135deg, rgba(15, 23, 42, 0.98) 0%, rgba(30, 41, 59, 0.98) 100%);
      border: 1px solid rgba(34, 197, 94, 0.5);
      border-radius: 16px;
      padding: 14px 24px;
      display: flex;
      align-items: center;
      gap: 14px;
      color: #22c55e;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.5px;
      box-shadow: 
        0 4px 20px rgba(0,0,0,0.4),
        0 0 40px rgba(34, 197, 94, 0.15),
        inset 0 1px 0 rgba(255,255,255,0.05);
      z-index: 9999;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      backdrop-filter: blur(20px);
    }
    #status-badge:hover {
      border-color: rgba(239, 68, 68, 0.7);
      color: #ef4444;
      box-shadow: 
        0 4px 25px rgba(0,0,0,0.5),
        0 0 50px rgba(239, 68, 68, 0.2);
      transform: translateY(-2px);
    }
    #status-badge .icon {
      font-size: 20px;
      filter: drop-shadow(0 0 8px currentColor);
    }
    #status-badge .pulse {
      width: 8px;
      height: 8px;
      background: #22c55e;
      border-radius: 50%;
      animation: pulse 2s ease-in-out infinite;
      box-shadow: 0 0 10px #22c55e;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.2); }
    }
    
    /* Protection message */
    #protection-message {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
      color: rgba(255,255,255,0.6);
      z-index: 100;
      pointer-events: none;
    }
    #protection-message .shield-large {
      font-size: 64px;
      margin-bottom: 20px;
      filter: drop-shadow(0 0 30px rgba(59, 130, 246, 0.5));
      animation: float 3s ease-in-out infinite;
    }
    @keyframes float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-10px); }
    }
    #protection-message h2 {
      font-size: 28px;
      font-weight: 700;
      color: #fff;
      margin-bottom: 12px;
      letter-spacing: -0.5px;
    }
    #protection-message p {
      font-size: 15px;
      color: rgba(255,255,255,0.5);
      max-width: 400px;
      line-height: 1.6;
    }
    #protection-message .hint {
      margin-top: 30px;
      padding: 16px 24px;
      background: rgba(59, 130, 246, 0.1);
      border: 1px solid rgba(59, 130, 246, 0.3);
      border-radius: 12px;
      font-size: 13px;
      color: #3b82f6;
    }
    
    /* Hover button container */
    #hover-buttons {
      position: fixed;
      display: none;
      gap: 10px;
      z-index: 9998;
    }
    #hover-buttons.visible {
      display: flex;
    }
    .hover-btn {
      background: linear-gradient(135deg, rgba(15, 23, 42, 0.98) 0%, rgba(30, 41, 59, 0.98) 100%);
      border: 1px solid rgba(59, 130, 246, 0.5);
      border-radius: 12px;
      padding: 14px 22px;
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 10px;
      box-shadow: 
        0 8px 32px rgba(0,0,0,0.4),
        0 0 40px rgba(59, 130, 246, 0.15);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      white-space: nowrap;
      backdrop-filter: blur(20px);
      letter-spacing: 0.3px;
    }
    .hover-btn:hover {
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      border-color: #3b82f6;
      transform: translateY(-3px) scale(1.02);
      box-shadow: 
        0 12px 40px rgba(59, 130, 246, 0.4),
        0 0 60px rgba(59, 130, 246, 0.3);
    }
    .hover-btn .icon { 
      font-size: 18px;
      filter: drop-shadow(0 0 6px currentColor);
    }
    
    /* Lightbox overlay */
    #lightbox {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.9);
      display: none;
      justify-content: center;
      align-items: center;
      z-index: 10000;
      padding: 40px;
      backdrop-filter: blur(10px);
    }
    #lightbox.visible {
      display: flex;
      animation: fadeIn 0.3s ease;
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    
    .modal {
      background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
      border-radius: 24px;
      max-width: 900px;
      width: 100%;
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      box-shadow: 
        0 25px 100px rgba(0,0,0,0.5),
        0 0 0 1px rgba(255,255,255,0.1);
      overflow: hidden;
      animation: modalSlide 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    }
    @keyframes modalSlide {
      from { opacity: 0; transform: scale(0.95) translateY(20px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    
    .modal-header {
      padding: 24px 28px;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(59, 130, 246, 0.3);
    }
    .modal-title {
      font-size: 18px;
      font-weight: 700;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 14px;
      letter-spacing: -0.3px;
    }
    .modal-title .shield { 
      color: #22c55e; 
      font-size: 26px;
      filter: drop-shadow(0 0 10px rgba(34, 197, 94, 0.5));
    }
    .modal-title .verified {
      background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 20px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .close-btn {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      width: 40px;
      height: 40px;
      border-radius: 12px;
      font-size: 20px;
      cursor: pointer;
      color: rgba(255,255,255,0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }
    .close-btn:hover {
      background: #ef4444;
      border-color: #ef4444;
      color: #fff;
      transform: rotate(90deg);
    }
    
    .modal-body {
      padding: 28px;
      overflow-y: auto;
      flex: 1;
    }
    
    .safe-notice {
      background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
      border: 1px solid rgba(34, 197, 94, 0.3);
      border-radius: 14px;
      padding: 18px 22px;
      margin-bottom: 28px;
      display: flex;
      align-items: center;
      gap: 16px;
      font-size: 14px;
      color: #166534;
      font-weight: 500;
    }
    .safe-notice .icon { 
      font-size: 24px;
      filter: drop-shadow(0 0 8px rgba(34, 197, 94, 0.4));
    }
    
    .email-meta {
      background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
      border-radius: 14px;
      padding: 20px;
      margin-bottom: 24px;
      border: 1px solid #e2e8f0;
    }
    .meta-row {
      display: flex;
      margin-bottom: 12px;
      font-size: 14px;
    }
    .meta-row:last-child { margin-bottom: 0; }
    .meta-label {
      color: #64748b;
      width: 80px;
      flex-shrink: 0;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.5px;
      padding-top: 2px;
    }
    .meta-value {
      color: #1e293b;
      word-break: break-word;
      font-weight: 500;
    }
    
    .subject {
      font-size: 24px;
      font-weight: 700;
      color: #0f172a;
      margin: 24px 0;
      line-height: 1.4;
      letter-spacing: -0.5px;
    }
    
    .email-body {
      font-size: 15px;
      line-height: 1.9;
      color: #374151;
      white-space: pre-wrap;
      word-wrap: break-word;
      padding: 24px;
      background: #fff;
      border-radius: 14px;
      border: 1px solid #e5e7eb;
      min-height: 200px;
      box-shadow: inset 0 2px 4px rgba(0,0,0,0.02);
    }
    
    .attachments {
      margin-top: 28px;
      padding-top: 28px;
      border-top: 1px solid #e5e7eb;
    }
    .attachments-title {
      font-size: 14px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-size: 12px;
    }
    .attachment-list {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    .attachment-item {
      background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 14px 18px;
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      transition: all 0.2s;
      font-size: 13px;
      color: #475569;
      font-weight: 500;
    }
    .attachment-item:hover {
      background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
      border-color: #3b82f6;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
    }
    
    .loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 80px;
      color: #64748b;
      font-size: 15px;
      gap: 24px;
    }
    .spinner {
      width: 56px;
      height: 56px;
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
  <!-- Protection Message in Center -->
  <div id="protection-message">
    <div class="shield-large">🛡️</div>
    <h2>WR MailGuard Active</h2>
    <p>Your inbox is protected. Hover over any email to safely preview its contents without executing scripts or loading tracking pixels.</p>
    <div class="hint">💡 Hover over emails to see the "Open Safe Email" button</div>
  </div>
  
  <!-- Status Badge -->
  <div id="status-badge" title="Click to disable MailGuard">
    <span class="pulse"></span>
    <span class="icon">🛡️</span>
    <span>MAILGUARD PRO</span>
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
    const protectionMessage = document.getElementById('protection-message');
    
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
        hoverButtons.style.left = (found.x + found.width - 200) + 'px';
        hoverButtons.style.top = (found.y + found.height / 2 - 24) + 'px';
        hoverButtons.classList.add('visible');
        // Hide center message when showing buttons
        protectionMessage.style.opacity = '0.3';
      } else {
        // Only hide if not hovering over the buttons themselves
        const btnRect = hoverButtons.getBoundingClientRect();
        if (!(x >= btnRect.left && x <= btnRect.right &&
              y >= btnRect.top && y <= btnRect.bottom)) {
          hoverButtons.classList.remove('visible');
          hoveredRowId = null;
          protectionMessage.style.opacity = '1';
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

