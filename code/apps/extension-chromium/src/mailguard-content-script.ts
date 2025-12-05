/**
 * WR MailGuard - Content Script for Gmail
 * 
 * This content script:
 * 1. Detects when user is on Gmail
 * 2. Shows activation banner
 * 3. Communicates with Electron via the background script to:
 *    - Activate/deactivate the Electron overlay
 *    - Send email row positions for hover detection
 *    - Extract and sanitize email content when requested
 */

// =============================================================================
// Types
// =============================================================================

interface EmailRowRect {
  id: string
  x: number
  y: number
  width: number
  height: number
}

interface SanitizedEmail {
  from: string
  to: string
  subject: string
  date: string
  body: string
  attachments: { name: string; type: string }[]
}

// =============================================================================
// State
// =============================================================================

let isMailGuardActive = false
let banner: HTMLElement | null = null
let rowUpdateInterval: ReturnType<typeof setInterval> | null = null
let emailRowElements: Map<string, Element> = new Map()

// =============================================================================
// Communication with Background Script
// =============================================================================

function sendToBackground(message: any): Promise<any> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        resolve(response)
      })
    } catch (err) {
      console.error('[MailGuard] Error sending to background:', err)
      resolve(null)
    }
  })
}

// =============================================================================
// UI Components
// =============================================================================

function showActivationBanner(): void {
  if (banner) return
  
  banner = document.createElement('div')
  banner.id = 'wr-mailguard-banner'
  
  const shadow = banner.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      .banner {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 2147483647;
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        border-bottom: 2px solid #3b82f6;
        padding: 14px 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 24px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        animation: slideDown 0.3s ease;
      }
      @keyframes slideDown {
        from { transform: translateY(-100%); }
        to { transform: translateY(0); }
      }
      .content {
        display: flex;
        align-items: center;
        gap: 14px;
        color: #fff;
      }
      .icon { font-size: 28px; }
      .text { font-size: 14px; }
      .title {
        font-weight: 600;
        color: #3b82f6;
        margin-bottom: 2px;
      }
      .desc {
        color: rgba(255,255,255,0.75);
        font-size: 12px;
      }
      .buttons {
        display: flex;
        gap: 12px;
      }
      .btn {
        padding: 10px 20px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
        border: none;
      }
      .btn-primary {
        background: #3b82f6;
        color: #fff;
      }
      .btn-primary:hover {
        background: #2563eb;
        transform: translateY(-1px);
      }
      .btn-secondary {
        background: transparent;
        border: 1px solid rgba(255,255,255,0.3);
        color: rgba(255,255,255,0.7);
      }
      .btn-secondary:hover {
        border-color: rgba(255,255,255,0.5);
        color: #fff;
      }
    </style>
    <div class="banner">
      <div class="content">
        <span class="icon">🛡️</span>
        <div class="text">
          <div class="title">Enable WR MailGuard Protection?</div>
          <div class="desc">View emails safely - scripts, tracking, and active content will be blocked</div>
        </div>
      </div>
      <div class="buttons">
        <button class="btn btn-secondary" id="dismiss">Not now</button>
        <button class="btn btn-primary" id="enable">Enable Protection</button>
      </div>
    </div>
  `
  
  shadow.getElementById('enable')?.addEventListener('click', activateMailGuard)
  shadow.getElementById('dismiss')?.addEventListener('click', dismissBanner)
  
  document.body.appendChild(banner)
}

function dismissBanner(): void {
  banner?.remove()
  banner = null
}

function showStatusMarker(): void {
  const existing = document.getElementById('wr-mailguard-status-marker')
  if (existing) existing.remove()
  
  const marker = document.createElement('div')
  marker.id = 'wr-mailguard-status-marker'
  marker.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 20px;
    z-index: 2147483647;
    background: linear-gradient(135deg, #166534 0%, #14532d 100%);
    color: #22c55e;
    padding: 10px 16px;
    border-radius: 10px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    box-shadow: 0 4px 15px rgba(0,0,0,0.3);
    border: 1px solid #22c55e;
  `
  marker.innerHTML = '<span style="font-size:16px">🛡️</span> MailGuard Active - Electron Overlay Running'
  document.body.appendChild(marker)
  
  setTimeout(() => marker.remove(), 4000)
}

// =============================================================================
// Email Row Detection and Position Reporting
// =============================================================================

function getEmailRowPositions(): EmailRowRect[] {
  const rows: EmailRowRect[] = []
  emailRowElements.clear()
  
  // Find Gmail inbox rows - try different selectors
  const rowElements = document.querySelectorAll('tr.zA, tr[role="row"], div[role="row"]')
  
  rowElements.forEach((row, index) => {
    const rect = row.getBoundingClientRect()
    
    // Only include visible rows in viewport
    if (rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight) {
      const id = `row-${index}`
      
      // Use viewport coordinates - the overlay script will handle screen positioning
      rows.push({
        id,
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      })
      emailRowElements.set(id, row)
    }
  })
  
  return rows
}

function startRowPositionUpdates(): void {
  if (rowUpdateInterval) return
  
  // Update row positions every 1000ms
  rowUpdateInterval = setInterval(() => {
    if (!isMailGuardActive) return
    
    // Check if we're still on a supported email site
    if (!isOnSupportedEmailSite()) {
      console.log('[MailGuard] No longer on supported email site, deactivating...')
      deactivateMailGuard()
      return
    }
    
    const rows = getEmailRowPositions()
    sendToBackground({ type: 'MAILGUARD_UPDATE_ROWS', rows })
  }, 1000)
  
  // Throttled scroll handler
  let scrollTimeout: ReturnType<typeof setTimeout> | null = null
  window.addEventListener('scroll', () => {
    if (!isMailGuardActive) return
    if (scrollTimeout) return
    
    scrollTimeout = setTimeout(() => {
      scrollTimeout = null
      const rows = getEmailRowPositions()
      sendToBackground({ type: 'MAILGUARD_UPDATE_ROWS', rows })
    }, 200)
  }, { passive: true })
  
  // CRITICAL: Deactivate when page is about to unload (navigation away)
  window.addEventListener('beforeunload', () => {
    if (isMailGuardActive) {
      console.log('[MailGuard] Page unloading, deactivating...')
      sendToBackground({ type: 'MAILGUARD_DEACTIVATE' })
    }
  })
  
  // Deactivate when tab visibility changes (user switches tabs)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && isMailGuardActive) {
      console.log('[MailGuard] Tab hidden, deactivating...')
      deactivateMailGuard()
    }
  })
  
  // Watch for URL changes within the SPA
  let lastUrl = window.location.href
  setInterval(() => {
    if (!isMailGuardActive) return
    
    const currentUrl = window.location.href
    if (currentUrl !== lastUrl) {
      console.log('[MailGuard] URL changed from', lastUrl, 'to', currentUrl)
      lastUrl = currentUrl
      
      // If we're no longer on a supported site, deactivate
      if (!isOnSupportedEmailSite()) {
        console.log('[MailGuard] Navigated away from email site, deactivating...')
        deactivateMailGuard()
      }
    }
  }, 300)
}

// List of supported email sites where MailGuard can be active
const SUPPORTED_EMAIL_SITES = [
  'mail.google.com'
  // Future: 'outlook.live.com', 'outlook.office.com', etc.
]

function isOnSupportedEmailSite(): boolean {
  const hostname = window.location.hostname
  return SUPPORTED_EMAIL_SITES.some(site => hostname.includes(site))
}

function stopRowPositionUpdates(): void {
  if (rowUpdateInterval) {
    clearInterval(rowUpdateInterval)
    rowUpdateInterval = null
  }
}

// =============================================================================
// Email Content Extraction
// =============================================================================

async function extractEmailContent(rowId: string): Promise<SanitizedEmail | null> {
  const row = emailRowElements.get(rowId)
  if (!row) {
    console.error('[MailGuard] Row not found:', rowId)
    return null
  }
  
  try {
    // Click the email row to open and load full content
    // The Electron overlay blocks the view, so user won't see the opened email
    const clickTarget = row.querySelector('td.xY, .a4W') || row
    ;(clickTarget as HTMLElement).click()
    
    // Wait for email to fully load
    await new Promise(resolve => setTimeout(resolve, 1500))
    
    // Extract full email content
    const from = extractSender()
    const to = extractRecipients()
    const subject = extractSubject()
    const date = extractDate()
    const bodyHtml = extractBodyHtml()
    const body = sanitizeHtmlToText(bodyHtml)
    const attachments = extractAttachments()
    
    // Navigate back to inbox immediately
    // The overlay is still blocking, so user never sees the opened email
    goBackToInbox()
    
    return { from, to, subject, date, body, attachments }
  } catch (err) {
    console.error('[MailGuard] Error extracting email:', err)
    goBackToInbox()
    return null
  }
}

function extractSender(): string {
  const senderEl = document.querySelector('.gD, [email], h3.iw span[email]')
  return senderEl?.getAttribute('email') || 
         senderEl?.getAttribute('name') || 
         senderEl?.textContent?.trim() || 
         '(Unknown sender)'
}

function extractRecipients(): string {
  const toEls = document.querySelectorAll('.g2 span[email], .hb span[email]')
  if (toEls.length === 0) return '(Recipients not available)'
  return Array.from(toEls).map(el => el.getAttribute('email') || el.textContent?.trim()).join(', ')
}

function extractSubject(): string {
  const subjectEl = document.querySelector('h2.hP, .ha h2, [data-thread-perm-id] h2')
  return subjectEl?.textContent?.trim() || '(No subject)'
}

function extractDate(): string {
  const dateEl = document.querySelector('.g3, .gH .g3, span.g3')
  return dateEl?.getAttribute('title') || dateEl?.textContent?.trim() || ''
}

function extractBodyHtml(): string {
  // Try multiple selectors for email body
  const bodyEl = document.querySelector('.a3s.aiL, .a3s, div[data-message-id] .a3s, .ii.gt')
  return bodyEl?.innerHTML || ''
}

function extractAttachments(): { name: string; type: string }[] {
  const attachments: { name: string; type: string }[] = []
  const attachmentEls = document.querySelectorAll('.aQH .aV3, .aZo, [download]')
  attachmentEls.forEach(el => {
    const name = el.getAttribute('download') || el.textContent?.trim() || 'Attachment'
    const type = name.split('.').pop() || 'unknown'
    attachments.push({ name, type })
  })
  return attachments
}

function goBackToInbox(): void {
  // Navigate back to inbox using multiple methods
  const backBtn = document.querySelector('[aria-label*="Back"], [aria-label*="Zurück"], .lS')
  if (backBtn) {
    (backBtn as HTMLElement).click()
  } else {
    // Fallback: use browser back or navigate to inbox
    const currentUrl = window.location.href
    const inboxUrl = currentUrl.split('#')[0] + '#inbox'
    window.location.href = inboxUrl
  }
}

// Email extraction functions moved above with extractEmailContent

// =============================================================================
// HTML Sanitization
// =============================================================================

function sanitizeHtmlToText(html: string): string {
  const temp = document.createElement('div')
  temp.innerHTML = html
  
  // Remove dangerous elements
  const dangerous = temp.querySelectorAll('script, style, iframe, object, embed, form, input, button, head, meta, link')
  dangerous.forEach(el => el.remove())
  
  // Also remove hidden elements
  const hidden = temp.querySelectorAll('[style*="display:none"], [style*="display: none"], [hidden]')
  hidden.forEach(el => el.remove())
  
  let text = processNodeToText(temp)
  
  // Aggressive whitespace cleanup
  text = text
    .replace(/\r\n/g, '\n')           // Normalize line endings
    .replace(/\n{3,}/g, '\n\n')       // Max 2 consecutive newlines
    .replace(/[ \t]+/g, ' ')          // Collapse horizontal whitespace
    .replace(/\n +/g, '\n')           // Remove leading spaces after newlines
    .replace(/ +\n/g, '\n')           // Remove trailing spaces before newlines
    .replace(/^\n+/, '')              // Remove leading newlines
    .replace(/\n+$/, '')              // Remove trailing newlines
    .trim()
  
  return text
}

function processNodeToText(node: Node): string {
  let result = ''
  
  node.childNodes.forEach(child => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent || ''
      // Collapse whitespace in text nodes
      result += text.replace(/\s+/g, ' ')
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element
      const tagName = el.tagName.toLowerCase()
      
      // Skip certain elements entirely
      if (['script', 'style', 'head', 'meta', 'link', 'noscript'].includes(tagName)) {
        return
      }
      
      // Skip hidden elements
      try {
        const style = window.getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden') return
      } catch {}
      
      // Handle specific tags
      if (tagName === 'br') {
        result += '\n'
      } else if (tagName === 'hr') {
        result += '\n---\n'
      } else if (tagName === 'a') {
        const href = el.getAttribute('href') || ''
        const linkText = el.textContent?.trim() || ''
        if (href && linkText && !href.startsWith('mailto:') && href !== linkText) {
          result += `${linkText}`
        } else {
          result += linkText || href
        }
      } else if (tagName === 'img') {
        const alt = el.getAttribute('alt')
        if (alt) result += `[Image: ${alt}]`
      } else if (tagName === 'li') {
        result += '\n• ' + processNodeToText(child).trim()
      } else if (['p', 'div', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote'].includes(tagName)) {
        // Block elements get single newline before/after
        const content = processNodeToText(child).trim()
        if (content) {
          result += '\n' + content + '\n'
        }
      } else if (['ul', 'ol'].includes(tagName)) {
        result += '\n' + processNodeToText(child)
      } else if (tagName === 'table') {
        result += '\n' + processNodeToText(child) + '\n'
      } else if (tagName === 'td' || tagName === 'th') {
        result += processNodeToText(child).trim() + ' '
      } else {
        result += processNodeToText(child)
      }
    }
  })
  
  return result
}

// =============================================================================
// MailGuard Activation/Deactivation
// =============================================================================

async function activateMailGuard(): Promise<void> {
  console.log('[MailGuard] Activating...')
  dismissBanner()
  
  // Show "connecting" status
  const statusDiv = document.createElement('div')
  statusDiv.id = 'mailguard-connecting'
  statusDiv.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483647;
    background: #3b82f6;
    color: #fff;
    padding: 12px 24px;
    border-radius: 8px;
    font-family: sans-serif;
    font-size: 14px;
    box-shadow: 0 4px 15px rgba(0,0,0,0.3);
    display: flex;
    align-items: center;
    gap: 10px;
  `
  statusDiv.innerHTML = '<span style="animation: spin 1s linear infinite; display: inline-block;">⏳</span> Connecting to OpenGiraffe...'
  document.body.appendChild(statusDiv)
  
  // Add spin animation
  const style = document.createElement('style')
  style.textContent = '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }'
  document.head.appendChild(style)
  
  try {
    // Get window position to determine which display to use
    const windowInfo = {
      screenX: window.screenX,
      screenY: window.screenY,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight
    }
    console.log('[MailGuard] Window position:', windowInfo)
    console.log('[MailGuard] Sending MAILGUARD_ACTIVATE to background...')
    const response = await sendToBackground({ type: 'MAILGUARD_ACTIVATE', windowInfo })
    console.log('[MailGuard] Response from background:', response)
    
    statusDiv.remove()
    
    if (response?.success) {
      isMailGuardActive = true
      showStatusMarker()
      startRowPositionUpdates()
      
      // Send initial row positions
      const rows = getEmailRowPositions()
      console.log('[MailGuard] Sending', rows.length, 'email rows to Electron')
      sendToBackground({ type: 'MAILGUARD_UPDATE_ROWS', rows })
    } else {
      console.error('[MailGuard] Failed to activate:', response)
      showActivationError(response?.error || 'Unknown error - check if OpenGiraffe is running')
    }
  } catch (err) {
    console.error('[MailGuard] Exception during activation:', err)
    statusDiv.remove()
    showActivationError('Exception: ' + String(err))
  }
}

function showActivationError(message: string): void {
  const errorDiv = document.createElement('div')
  errorDiv.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483647;
    background: #ef4444;
    color: #fff;
    padding: 16px 24px;
    border-radius: 8px;
    font-family: sans-serif;
    font-size: 14px;
    box-shadow: 0 4px 15px rgba(0,0,0,0.3);
    max-width: 500px;
    text-align: center;
  `
  errorDiv.innerHTML = `
    <div style="font-weight: 600; margin-bottom: 8px;">⚠️ MailGuard Activation Failed</div>
    <div style="font-size: 12px; opacity: 0.9;">${message}</div>
    <div style="font-size: 11px; margin-top: 10px; opacity: 0.7;">
      Make sure OpenGiraffe (Electron app) is running and try reloading the extension.
    </div>
  `
  document.body.appendChild(errorDiv)
  setTimeout(() => {
    errorDiv.remove()
    showActivationBanner() // Show banner again so user can retry
  }, 8000)
}

function deactivateMailGuard(): void {
  console.log('[MailGuard] Deactivating...')
  isMailGuardActive = false
  stopRowPositionUpdates()
  sendToBackground({ type: 'MAILGUARD_DEACTIVATE' })
  showActivationBanner()
}

// =============================================================================
// Message Handling from Background Script
// =============================================================================

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'MAILGUARD_ACTIVATED') {
    console.log('[MailGuard] Activation confirmed by Electron')
    isMailGuardActive = true
    showStatusMarker()
    startRowPositionUpdates()
  } else if (msg.type === 'MAILGUARD_DEACTIVATED') {
    console.log('[MailGuard] Deactivation confirmed')
    isMailGuardActive = false
    stopRowPositionUpdates()
    showActivationBanner()
  } else if (msg.type === 'MAILGUARD_EXTRACT_EMAIL') {
    console.log('[MailGuard] Email extraction requested for row:', msg.rowId)
    extractEmailContent(msg.rowId).then(email => {
      if (email) {
        sendToBackground({ type: 'MAILGUARD_EMAIL_CONTENT', email })
      }
    })
  } else if (msg.type === 'MAILGUARD_STATUS_RESPONSE') {
    if (msg.active && !isMailGuardActive) {
      isMailGuardActive = true
      dismissBanner()
      showStatusMarker()
      startRowPositionUpdates()
    }
  }
  
  sendResponse({ received: true })
  return true
})

// =============================================================================
// Initialization
// =============================================================================

async function init(): Promise<void> {
  console.log('[MailGuard] Initializing on:', window.location.hostname)
  
  // Only run on Gmail
  if (!window.location.hostname.includes('mail.google.com')) {
    console.log('[MailGuard] Not on Gmail, exiting')
    return
  }
  
  // Wait for Gmail to be ready
  await waitForGmailReady()
  
  // Check if MailGuard is already active in Electron
  await sendToBackground({ type: 'MAILGUARD_STATUS' })
  
  // If not active, show activation banner
  setTimeout(() => {
    if (!isMailGuardActive) {
      showActivationBanner()
    }
  }, 1000)
}

async function waitForGmailReady(): Promise<void> {
  console.log('[MailGuard] Waiting for Gmail UI...')
  
  for (let i = 0; i < 30; i++) {
    const container = document.querySelector('div[role="main"], div.aeN, div.nH')
    const rows = document.querySelectorAll('tr.zA, div[role="row"]')
    
    if (container || rows.length > 0) {
      console.log('[MailGuard] Gmail UI ready')
      return
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  
  console.log('[MailGuard] Gmail UI detection timeout, proceeding anyway')
}

// Start initialization
console.log('[MailGuard] Content script loaded')
init().catch(err => console.error('[MailGuard] Init error:', err))
