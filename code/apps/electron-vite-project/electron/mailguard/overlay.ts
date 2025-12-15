/**
 * WR MailGuard Overlay - Electron transparent overlay for Gmail protection
 * 
 * Creates a persistent transparent overlay over the browser that:
 * - Blocks direct clicks on emails
 * - Shows hover buttons when mouse is over email rows
 * - Displays sanitized emails in a lightbox
 */

import { BrowserWindow, screen, Display, ipcMain } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

let mailguardOverlay: BrowserWindow | null = null
let isActive = false
let browserWindowOffset = { x: 0, y: 0, chromeHeight: 0 }
let currentTheme: 'default' | 'dark' | 'professional' = 'default'
// Track the sidebar width for mouse passthrough (sidebar is on the left)
let sidebarWidth = 0

// Handle mouse region changes from overlay renderer
// When mouse is in sidebar, enable passthrough; otherwise block
ipcMain.on('mailguard-mouse-region', (event, region: string) => {
  if (!mailguardOverlay) return
  
  if (region === 'sidebar') {
    // Enable mouse passthrough for sidebar interaction
    mailguardOverlay.setIgnoreMouseEvents(true, { forward: true })
  } else {
    // Block mouse events in protected area (email list + content)
    mailguardOverlay.setIgnoreMouseEvents(false)
  }
})

/**
 * Bounds for the protected email list area (used to determine sidebar passthrough zone)
 */
export interface ProtectedAreaBounds {
  x: number  // Left edge of email list (= sidebar width in viewport coords)
  y: number
  width: number
  height: number
  screenX: number  // Browser window screenX
  screenY: number  // Browser window screenY
}

// Theme color configurations - matching sidebar colors exactly
const themeColors = {
  default: {
    // Matching sidebar gradient: #c084fc -> #a855f7 -> #9333ea
    primary: '#c084fc',
    primaryDark: '#a855f7',
    primaryDarker: '#9333ea',
    bgDark: 'rgba(118,75,162,0.35)',
    bgLight: '#faf5ff',
    textDark: '#7c3aed',
    textMedium: '#9333ea'
  },
  professional: {
    // Light theme with dark slate accents
    primary: '#0f172a',
    primaryDark: '#1e293b',
    primaryDarker: '#334155',
    bgDark: '#e2e8f0',
    bgLight: '#f8fafc',
    textDark: '#0f172a',
    textMedium: '#1e293b'
  },
  dark: {
    primary: '#64748b',
    primaryDark: '#475569',
    primaryDarker: '#334155',
    bgDark: '#1e293b',
    bgLight: '#f1f5f9',
    textDark: '#334155',
    textMedium: '#475569'
  }
}

export interface EmailRowRect {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface WindowInfo {
  screenX: number
  screenY: number
  innerWidth: number
  innerHeight: number
  outerWidth: number
  outerHeight: number
}

export interface SanitizedEmail {
  from: string
  to: string
  subject: string
  date: string
  body: string
  attachments: { name: string; type: string }[]
  isFromApi?: boolean  // Flag to indicate if email was fetched via API
}

/**
 * Activate MailGuard overlay on the specified display (or primary if not specified)
 * The overlay covers the full browser content area, with mouse passthrough enabled
 * for the sidebar region (determined by email list bounds).
 */
export function activateMailGuard(targetDisplay?: Display, windowInfo?: WindowInfo, theme?: string): void {
  if (mailguardOverlay) {
    console.log('[MAILGUARD] Already active, closing existing overlay first')
    mailguardOverlay.close()
    mailguardOverlay = null
  }

  // Set current theme
  currentTheme = (theme as 'default' | 'dark' | 'professional') || 'default'
  console.log('[MAILGUARD] Using theme:', currentTheme)

  const display = targetDisplay || screen.getPrimaryDisplay()
  console.log('[MAILGUARD] Activating overlay on display:', display.id, 'bounds:', display.bounds)
  console.log('[MAILGUARD] Window info:', windowInfo)
  const { x, y, width, height } = display.bounds
  
  // Calculate browser window offset relative to display
  if (windowInfo) {
    const chromeHeight = windowInfo.outerHeight - windowInfo.innerHeight
    browserWindowOffset = {
      x: windowInfo.screenX - x,
      y: windowInfo.screenY - y + chromeHeight,
      chromeHeight
    }
    console.log('[MAILGUARD] Browser window offset:', browserWindowOffset)
  } else {
    browserWindowOffset = { x: 0, y: 0, chromeHeight: 0 }
  }
  
  // Reset sidebar width
  sidebarWidth = 0

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
  
  // Block ALL mouse events - solid protection against accidental email clicks
  // Scroll events are forwarded manually via IPC
  mailguardOverlay.setIgnoreMouseEvents(false)

  // Write overlay HTML to temp file for proper node integration
  const htmlContent = getOverlayHtml()
  const tempDir = os.tmpdir()
  const overlayPath = path.join(tempDir, 'mailguard-overlay.html')
  fs.writeFileSync(overlayPath, htmlContent, 'utf-8')
  mailguardOverlay.loadFile(overlayPath)

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
  sidebarWidth = 0
}

/**
 * Update the sidebar passthrough zone based on email list bounds
 * The sidebar is the area to the LEFT of the email list (bounds.x = sidebar width)
 */
export function updateProtectedArea(bounds: ProtectedAreaBounds): void {
  if (!mailguardOverlay) {
    console.log('[MAILGUARD] Cannot update protected area - overlay not active')
    return
  }
  
  // The email list's x position tells us where the sidebar ends
  // Store this so we can send it to the overlay for mouse passthrough
  const newSidebarWidth = Math.round(bounds.x)
  
  if (newSidebarWidth !== sidebarWidth) {
    sidebarWidth = newSidebarWidth
    console.log('[MAILGUARD] Sidebar passthrough zone updated:', sidebarWidth, 'px')
    
    // Send sidebar width to overlay for mouse passthrough handling
    mailguardOverlay.webContents.send('mailguard-sidebar-width', sidebarWidth)
  }
}

/**
 * Update email row positions (called from content script via WebSocket)
 */
export function updateEmailRows(rows: EmailRowRect[], provider: string = 'gmail'): void {
  if (mailguardOverlay) {
    // Apply browser window offset to convert viewport coords to screen coords
    const adjustedRows = rows.map(row => ({
      ...row,
      x: row.x + browserWindowOffset.x,
      y: row.y + browserWindowOffset.y
    }))
    mailguardOverlay.webContents.send('mailguard-rows', { rows: adjustedRows, provider })
  }
}

/**
 * Display sanitized email in the overlay lightbox
 */
export function showSanitizedEmail(email: SanitizedEmail): void {
  if (mailguardOverlay) {
    mailguardOverlay.webContents.send('mailguard-show-email', email)
    // Mouse events are always captured (setIgnoreMouseEvents(false) on creation)
  }
}

/**
 * Close the email lightbox
 */
export function closeLightbox(): void {
  if (mailguardOverlay) {
    mailguardOverlay.webContents.send('mailguard-close-lightbox')
    // IMPORTANT: Keep blocking mouse events - never allow passthrough
    // The overlay must ALWAYS block direct Gmail interaction
  }
}

export function isMailGuardActive(): boolean {
  return isActive
}

/**
 * Generate the overlay HTML with embedded styles and scripts
 */
function getOverlayHtml(): string {
  const colors = themeColors[currentTheme]
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      /* Light protective tint - reduced opacity for better visibility */
      background: rgba(10, 20, 40, 0.08);
      cursor: default;
      pointer-events: auto;
    }
    
    /* Professional status badge */
    #status-badge {
      position: fixed;
      top: 16px;
      right: 16px;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      border: 1px solid ${colors.primary}99;
      border-radius: 8px;
      padding: 12px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      color: ${colors.primary};
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.3px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05) inset;
      z-index: 9999;
      cursor: pointer;
    }
    #status-badge:hover {
      border-color: rgba(239, 68, 68, 0.8);
    }
    #status-badge:hover .toggle-track {
      background: #7f1d1d;
      border-color: #dc2626;
    }
    #status-badge .icon { font-size: 18px; }
    #status-badge .label {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    #status-badge .brand {
      font-size: 10px;
      color: rgba(255,255,255,0.5);
      font-weight: 500;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
    #status-badge .status {
      color: ${colors.primary};
    }
    
    /* Toggle switch */
    .toggle-track {
      width: 44px;
      height: 24px;
      background: ${colors.bgDark};
      border: 1px solid ${colors.primary};
      border-radius: 12px;
      position: relative;
      transition: all 0.2s ease;
    }
    .toggle-thumb {
      width: 18px;
      height: 18px;
      background: ${colors.primary};
      border-radius: 50%;
      position: absolute;
      top: 2px;
      right: 3px;
      transition: all 0.2s ease;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    }
    #status-badge:hover .toggle-thumb {
      background: #ef4444;
      right: auto;
      left: 3px;
    }
    .toggle-label {
      font-size: 10px;
      color: rgba(255,255,255,0.7);
      margin-left: 4px;
    }
    
    /* Hover button container */
    #hover-buttons {
      position: fixed;
      display: none;
      gap: 6px;
      z-index: 9998;
    }
    #hover-buttons.visible {
      display: flex;
    }
    .hover-btn {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      border: 1px solid rgba(59, 130, 246, 0.7);
      border-radius: 6px;
      padding: 8px 14px;
      color: #fff;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      box-shadow: 0 3px 12px rgba(0,0,0,0.4);
      white-space: nowrap;
    }
    .hover-btn:hover {
      background: linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%);
      border-color: #3b82f6;
    }
    .hover-btn .icon { font-size: 14px; }
    
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
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #3b82f6;
    }
    .modal-title {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .modal-title .shield { 
      color: ${colors.primary}; 
      font-size: 24px;
    }
    .modal-title .title-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .modal-title .brand {
      font-size: 10px;
      color: rgba(255,255,255,0.5);
      font-weight: 500;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
    .modal-title .main-title {
      font-size: 16px;
      font-weight: 600;
      color: #fff;
    }
    .modal-title .verified {
      background: linear-gradient(135deg, ${colors.primary} 0%, ${colors.primaryDark} 100%);
      color: #fff;
      font-size: 9px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-left: 8px;
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
      background: ${colors.bgLight};
      border: 1px solid ${colors.primary};
      border-radius: 10px;
      padding: 14px 18px;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 13px;
      color: ${colors.textMedium};
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
    
    /* Link reveal buttons */
    .link-reveal-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      margin: 0 2px;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
      color: white;
      border: none;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      vertical-align: middle;
      transition: all 0.2s ease;
    }
    .link-reveal-btn:hover {
      transform: scale(1.05);
      box-shadow: 0 2px 8px rgba(99, 102, 241, 0.4);
    }
    .link-reveal-btn .icon {
      font-size: 10px;
    }
    
    .link-url-revealed {
      display: inline-block;
      margin: 4px 0;
      padding: 6px 10px;
      background: #fef3c7;
      border: 1px solid #f59e0b;
      border-radius: 6px;
      font-family: monospace;
      font-size: 12px;
      color: #92400e;
      word-break: break-all;
      max-width: 100%;
    }
    .link-url-revealed .label {
      font-size: 10px;
      color: #b45309;
      font-family: sans-serif;
      display: block;
      margin-bottom: 2px;
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
    
    /* Info box for Gmail API setup */
    .api-info-box {
      background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
      border: 1px solid #3b82f6;
      border-radius: 12px;
      padding: 18px 20px;
      margin-top: 20px;
    }
    .api-info-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
    }
    .api-info-header .icon {
      font-size: 20px;
    }
    .api-info-header .title {
      font-size: 14px;
      font-weight: 600;
      color: #1e40af;
    }
    .api-info-text {
      font-size: 13px;
      color: #1e3a8a;
      line-height: 1.6;
      margin-bottom: 14px;
    }
    .api-setup-btn {
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 10px 18px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 2px 8px rgba(37, 99, 235, 0.3);
      transition: all 0.2s ease;
    }
    .api-setup-btn:hover {
      background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4);
    }
    .api-setup-btn .icon { font-size: 14px; }
    
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
    
    /* Scroll controls - positioned for Outlook email list */
    #scroll-controls {
      position: fixed;
      left: 580px; /* Approximately where Outlook email list ends */
      top: 45%;
      transform: translateY(-50%);
      display: flex;
      flex-direction: column;
      gap: 6px;
      z-index: 9999;
      background: rgba(15, 23, 42, 0.95);
      padding: 10px 8px;
      border-radius: 28px;
      border: 2px solid rgba(139, 92, 246, 0.5);
      box-shadow: 0 4px 25px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255,255,255,0.1);
    }
    .scroll-btn {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
      border: none;
      color: white;
      font-size: 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(99, 102, 241, 0.4);
      transition: all 0.15s ease;
    }
    .scroll-btn:hover {
      transform: scale(1.1);
      background: linear-gradient(135deg, #818cf8 0%, #a78bfa 100%);
    }
    .scroll-btn:active {
      transform: scale(0.9);
    }
    .scroll-label {
      text-align: center;
      font-size: 9px;
      color: rgba(255,255,255,0.7);
      padding: 2px 0;
    }
  </style>
</head>
<body>
  <!-- Scroll Controls -->
  <div id="scroll-controls">
    <button class="scroll-btn" id="scroll-up" title="Scroll Up">▲</button>
    <span class="scroll-label">Scroll</span>
    <button class="scroll-btn" id="scroll-down" title="Scroll Down">▼</button>
  </div>
  
  <!-- Status Badge with Toggle -->
  <div id="status-badge" title="Click to turn OFF protection">
    <span class="icon">🛡️</span>
    <div class="label">
      <span class="brand">WR MailGuard</span>
      <span class="status">Protection Active</span>
    </div>
    <div class="toggle-track">
      <div class="toggle-thumb"></div>
    </div>
    <span class="toggle-label">ON</span>
  </div>
  
  <!-- Hover Buttons -->
  <div id="hover-buttons">
    <button class="hover-btn" id="btn-safe-email">
      <span class="icon">🛡️</span>
      View Sanitized Email
    </button>
  </div>
  
  <!-- Lightbox -->
  <div id="lightbox">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">
          <span class="shield">🛡️</span>
          <div class="title-text">
            <span class="brand">WR MailGuard</span>
            <span class="main-title">Secure Email Viewer</span>
          </div>
          <span class="verified">Sanitized</span>
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
    
    // Theme colors injected from Electron
    const themeColors = {
      primary: '${colors.primary}',
      primaryDark: '${colors.primaryDark}',
      bgLight: '${colors.bgLight}',
      textDark: '${colors.textDark}',
      textMedium: '${colors.textMedium}'
    };
    
    let currentRows = [];
    let currentProvider = 'gmail';
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
    
    // Scroll controls
    const scrollUpBtn = document.getElementById('scroll-up');
    const scrollDownBtn = document.getElementById('scroll-down');
    const scrollControlsEl2 = document.getElementById('scroll-controls');
    let scrollInterval = null;
    let isScrolling = false;
    let lockedPosition = null;
    let lockTimeout = null;
    
    function startScrolling(direction) {
      isScrolling = true;
      // Clear any pending unlock timeout
      if (lockTimeout) {
        clearTimeout(lockTimeout);
        lockTimeout = null;
      }
      // Lock position when scrolling starts
      if (scrollControlsEl2 && !lockedPosition) {
        lockedPosition = {
          left: scrollControlsEl2.style.left,
          top: scrollControlsEl2.style.top
        };
      }
      // Scroll immediately
      ipcRenderer.send('mailguard-scroll', { deltaX: 0, deltaY: direction * 200, x: 0, y: 0 });
      // Then continue scrolling while held
      scrollInterval = setInterval(() => {
        ipcRenderer.send('mailguard-scroll', { deltaX: 0, deltaY: direction * 200, x: 0, y: 0 });
      }, 80);
    }
    
    function stopScrolling() {
      if (scrollInterval) {
        clearInterval(scrollInterval);
        scrollInterval = null;
      }
      // Clear any pending unlock timeout and set new one
      if (lockTimeout) {
        clearTimeout(lockTimeout);
      }
      // Keep position locked for 10 seconds after LAST scroll action
      lockTimeout = setTimeout(() => {
        isScrolling = false;
        lockedPosition = null;
        lockTimeout = null;
      }, 10000);
    }
    
    if (scrollUpBtn) {
      scrollUpBtn.addEventListener('mousedown', (e) => { e.preventDefault(); startScrolling(-1); });
      scrollUpBtn.addEventListener('mouseup', stopScrolling);
      scrollUpBtn.addEventListener('mouseleave', stopScrolling);
    }
    
    if (scrollDownBtn) {
      scrollDownBtn.addEventListener('mousedown', (e) => { e.preventDefault(); startScrolling(1); });
      scrollDownBtn.addEventListener('mouseup', stopScrolling);
      scrollDownBtn.addEventListener('mouseleave', stopScrolling);
    }
    
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
    
    // Throttle utility - limit function calls to max once per interval (16ms = ~60fps)
    let lastMouseMoveTime = 0;
    const MOUSE_MOVE_THROTTLE = 16; // ~60fps
    
    // Track mouse position and show/hide hover buttons (throttled for performance)
    document.addEventListener('mousemove', (e) => {
      const now = Date.now();
      if (now - lastMouseMoveTime < MOUSE_MOVE_THROTTLE) return;
      lastMouseMoveTime = now;
      
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
        // Position buttons based on email provider
        if (currentProvider === 'outlook') {
          // Outlook: Position button on the left side of the row (reading pane is on right)
          // Also account for Outlook's narrower row width
          hoverButtons.style.left = (found.x + 20) + 'px';
          hoverButtons.style.top = (found.y + found.height / 2 - 22) + 'px';
        } else {
          // Gmail: Position buttons at the center-right of the row
          hoverButtons.style.left = (found.x + found.width - 180) + 'px';
          hoverButtons.style.top = (found.y + found.height / 2 - 22) + 'px';
        }
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
    ipcRenderer.on('mailguard-rows', (event, data) => {
      // data is now { rows, provider } object
      currentRows = data.rows || data;
      currentProvider = data.provider || 'gmail';
      
      // Position scroll controls based on email list position
      // But DON'T update position while user is scrolling
      const scrollControlsEl = document.getElementById('scroll-controls');
      if (scrollControlsEl && currentRows.length > 0 && !isScrolling) {
        const firstRow = currentRows[0];
        const lastRow = currentRows[currentRows.length - 1];
        // Position at the right edge of the email list
        const listRight = firstRow.x + firstRow.width + 10;
        const listCenterY = (firstRow.y + lastRow.y + lastRow.height) / 2;
        scrollControlsEl.style.left = listRight + 'px';
        scrollControlsEl.style.top = listCenterY + 'px';
        scrollControlsEl.style.transform = 'translateY(-50%)';
      }
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
      
      // Info box - shows different content based on whether this is preview or full email
      // Check for explicit flag or specific markers that indicate API-fetched content
      const isFullEmail = email.isFromApi === true || (email.body && (email.body.includes('--- Full email content fetched via') || email.body.length > 500))
      
      const apiInfoBox = isFullEmail 
        ? '<div class="api-info-box" style="border-color: ' + themeColors.primary + '; background: linear-gradient(135deg, ' + themeColors.bgLight + ' 0%, ' + themeColors.bgLight + ' 100%);">' +
            '<div class="api-info-header">' +
              '<span class="icon">✅</span>' +
              '<span class="title" style="color: ' + themeColors.textMedium + ';">Full Email via Secure API</span>' +
            '</div>' +
            '<div class="api-info-text" style="color: ' + themeColors.textDark + ';">' +
              'This email was fetched securely via the Email API. No tracking pixels, scripts, or active content were executed.' +
            '</div>' +
          '</div>'
        : '<div class="api-info-box">' +
            '<div class="api-info-header">' +
              '<span class="icon">ℹ️</span>' +
              '<span class="title">Preview Mode</span>' +
            '</div>' +
            '<div class="api-info-text">' +
              'For your protection, only the email preview is shown. The full email content was never loaded or rendered.<br><br>' +
              'To view full email content securely, connect your email account in the WR Chat sidebar.' +
            '</div>' +
            '<button class="api-setup-btn" id="btn-api-setup">' +
              '<span class="icon">⚙️</span>' +
              '<span>Connect Email Account</span>' +
            '</button>' +
          '</div>';
      
      // Process body text - convert link markers to buttons
      let bodyHtml = escapeHtml(email.body || '(no preview available)');
      
      // Replace {{LINK_BUTTON:url}} markers with reveal buttons
      let linkCounter = 0;
      bodyHtml = bodyHtml.replace(/\{\{LINK_BUTTON:([^}]+)\}\}/g, (match, url) => {
        linkCounter++;
        const safeUrl = escapeHtml(url);
        return '<button class="link-reveal-btn" data-link-id="link-' + linkCounter + '" data-url="' + safeUrl + '">' +
               '<span class="icon">🔗</span><span>Show Link</span></button>' +
               '<span id="link-' + linkCounter + '" class="link-url-revealed" style="display: none;">' +
               '<span class="label">Link URL (not clickable for security):</span>' + safeUrl + '</span>';
      });
      
      emailContent.innerHTML = 
        '<div class="safe-notice"><span class="icon">🛡️</span><span>This is a secure preview. The email was never opened or rendered.</span></div>' +
        '<div class="email-meta">' +
          '<div class="meta-row"><span class="meta-label">From:</span><span class="meta-value">' + escapeHtml(email.from || '(unknown)') + '</span></div>' +
          (email.to ? '<div class="meta-row"><span class="meta-label">To:</span><span class="meta-value">' + escapeHtml(email.to) + '</span></div>' : '') +
          '<div class="meta-row"><span class="meta-label">Date:</span><span class="meta-value">' + escapeHtml(email.date || '(unknown)') + '</span></div>' +
        '</div>' +
        '<div class="subject">' + escapeHtml(email.subject || '(no subject)') + '</div>' +
        '<div class="email-body">' + bodyHtml + '</div>' +
        attachmentsHtml +
        apiInfoBox;
      
      // Handle link reveal button clicks
      document.querySelectorAll('.link-reveal-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const linkId = btn.getAttribute('data-link-id');
          const urlSpan = document.getElementById(linkId);
          if (urlSpan) {
            if (urlSpan.style.display === 'none') {
              urlSpan.style.display = 'inline-block';
              btn.innerHTML = '<span class="icon">🔗</span><span>Hide Link</span>';
            } else {
              urlSpan.style.display = 'none';
              btn.innerHTML = '<span class="icon">🔗</span><span>Show Link</span>';
            }
          }
        });
      });
      
      // Handle API setup button click
      const apiSetupBtn = document.getElementById('btn-api-setup');
      if (apiSetupBtn) {
        apiSetupBtn.addEventListener('click', () => {
          ipcRenderer.send('mailguard-api-setup');
        });
      }
    });
    
    // Close lightbox command
    ipcRenderer.on('mailguard-close-lightbox', () => {
      lightbox.classList.remove('visible');
    });
    
    // Sidebar passthrough handling
    let sidebarWidth = 0;
    let isInSidebar = false;
    
    ipcRenderer.on('mailguard-sidebar-width', (event, width) => {
      sidebarWidth = width;
      console.log('[OVERLAY] Sidebar passthrough width set to:', sidebarWidth);
    });
    
    // Track mouse position to enable passthrough in sidebar area
    document.addEventListener('mousemove', (e) => {
      if (sidebarWidth <= 0) return; // No sidebar info yet
      
      // Mouse is in sidebar if x position is less than sidebar width
      // (accounting for browser window offset which is already applied)
      const inSidebar = e.clientX < sidebarWidth;
      
      if (inSidebar !== isInSidebar) {
        isInSidebar = inSidebar;
        // Notify main process to toggle mouse event handling
        ipcRenderer.send('mailguard-mouse-region', inSidebar ? 'sidebar' : 'protected');
      }
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

