/**
 * WR MailGuard - Content Script for Email Protection
 * 
 * This content script:
 * 1. Detects when user is on Gmail or Outlook
 * 2. Shows activation banner
 * 3. Communicates with Electron via the background script to:
 *    - Activate/deactivate the Electron overlay
 *    - Send email row positions for hover detection
 *    - Extract and sanitize email content when requested
 * 
 * Supported email providers:
 * - Gmail (mail.google.com)
 * - Outlook.com (outlook.live.com)
 * - Microsoft 365 (outlook.office.com, outlook.office365.com)
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
  // Preview data for Gmail API matching
  from?: string
  subject?: string
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
let urlCheckInterval: ReturnType<typeof setInterval> | null = null
let emailRowElements: Map<string, Element> = new Map()
let currentTheme: 'default' | 'dark' | 'professional' = 'default'
let listenersInitialized = false

// Theme color configurations - matching sidebar colors exactly
const themeColors = {
  default: {
    // Matching sidebar gradient: #c084fc -> #a855f7 -> #9333ea
    primary: '#c084fc',
    primaryDark: '#a855f7',
    primaryDarker: '#9333ea',
    bgDark: 'rgba(118,75,162,0.35)',
    bgLight: 'rgba(118,75,162,0.25)',
    shadowColor: 'rgba(192, 132, 252, 0.2)',
    shadowColorMedium: 'rgba(168, 85, 247, 0.35)',
    shadowColorStrong: 'rgba(147, 51, 234, 0.45)'
  },
  professional: {
    // Light theme with dark slate accents
    primary: '#0f172a',
    primaryDark: '#1e293b',
    primaryDarker: '#334155',
    bgDark: '#e2e8f0',
    bgLight: '#f1f5f9',
    shadowColor: 'rgba(15, 23, 42, 0.1)',
    shadowColorMedium: 'rgba(15, 23, 42, 0.15)',
    shadowColorStrong: 'rgba(15, 23, 42, 0.2)'
  },
  dark: {
    primary: '#64748b',
    primaryDark: '#475569',
    primaryDarker: '#334155',
    bgDark: '#1e293b',
    bgLight: '#334155',
    shadowColor: 'rgba(100, 116, 139, 0.15)',
    shadowColorMedium: 'rgba(100, 116, 139, 0.3)',
    shadowColorStrong: 'rgba(100, 116, 139, 0.4)'
  }
}

// Load theme from storage
async function loadTheme(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(['optimando-ui-theme'])
    currentTheme = (result['optimando-ui-theme'] as 'default' | 'dark' | 'professional') || 'default'
    console.log('[MailGuard] Theme loaded:', currentTheme)
  } catch (err) {
    console.log('[MailGuard] Could not load theme, using default')
    currentTheme = 'default'
  }
}

// Listen for theme changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes['optimando-ui-theme']) {
    currentTheme = changes['optimando-ui-theme'].newValue || 'default'
    console.log('[MailGuard] Theme changed to:', currentTheme)
    // Refresh banner if visible (use re-enable banner since auto-enable is now default)
    if (banner) {
      banner.remove()
      banner = null
      if (userManuallyDisabled) {
        showReEnableBanner()
      }
    }
  }
})

// =============================================================================
// Communication with Background Script
// =============================================================================

function sendToBackground(message: any): Promise<any> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[MailGuard] Runtime error:', chrome.runtime.lastError.message)
          resolve(null)
          return
        }
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
  
  const colors = themeColors[currentTheme]
  
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
        background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
        border-bottom: 2px solid ${colors.primary};
        padding: 14px 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 24px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4), 0 0 40px ${colors.shadowColor};
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
      .brand {
        font-size: 10px;
        color: rgba(255,255,255,0.5);
        font-weight: 500;
        letter-spacing: 1px;
        text-transform: uppercase;
      }
      .title {
        font-weight: 600;
        color: ${colors.primary};
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
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s;
        border: none;
      }
      .btn-primary {
        background: linear-gradient(135deg, ${colors.primary} 0%, ${colors.primaryDark} 100%);
        color: #fff;
        box-shadow: 0 2px 10px ${colors.shadowColorMedium};
      }
      .btn-primary:hover {
        background: linear-gradient(135deg, ${colors.primaryDark} 0%, ${colors.primaryDarker} 100%);
        transform: translateY(-1px);
        box-shadow: 0 4px 15px ${colors.shadowColorStrong};
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
          <div class="brand">WR MAILGUARD</div>
          <div class="title">Enable Email Protection?</div>
          <div class="desc">View emails safely - scripts, tracking, and active content will be blocked</div>
        </div>
      </div>
      <div class="buttons">
        <button class="btn btn-secondary" id="dismiss">Not now</button>
        <button class="btn btn-primary" id="enable">Enable Protection</button>
      </div>
    </div>
  `
  
  shadow.getElementById('enable')?.addEventListener('click', () => activateMailGuard())
  shadow.getElementById('dismiss')?.addEventListener('click', dismissBanner)
  
  document.body.appendChild(banner)
}

function dismissBanner(): void {
  banner?.remove()
  banner = null
}

function showReEnableBanner(): void {
  if (banner) return
  
  const colors = themeColors[currentTheme]
  
  banner = document.createElement('div')
  banner.id = 'wr-mailguard-reenable-banner'
  
  const shadow = banner.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      .reenable-banner {
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: linear-gradient(135deg, ${colors.primary} 0%, ${colors.primaryDark} 100%);
        color: white;
        padding: 12px 18px;
        border-radius: 12px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 10px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.25);
        cursor: pointer;
        z-index: 2147483647;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }
      .reenable-banner:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 24px rgba(0,0,0,0.3);
      }
      .icon { font-size: 16px; }
    </style>
    <div class="reenable-banner" id="reenable">
      <span class="icon">🛡️</span>
      <span>Re-enable MailGuard Protection</span>
    </div>
  `
  
  shadow.getElementById('reenable')?.addEventListener('click', () => {
    userManuallyDisabled = false
    dismissBanner()
    activateMailGuard()
  })
  
  document.body.appendChild(banner)
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
    background: linear-gradient(135deg, ${themeColors[currentTheme].bgLight} 0%, ${themeColors[currentTheme].bgDark} 100%);
    color: ${themeColors[currentTheme].primary};
    padding: 10px 16px;
    border-radius: 10px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    box-shadow: 0 4px 15px rgba(0,0,0,0.3);
    border: 1px solid ${themeColors[currentTheme].primary};
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
  
  const provider = getCurrentEmailProvider()
  if (provider === 'unknown') return rows
  
  // Get site-specific row selector
  const rowSelector = EMAIL_ROW_SELECTORS[provider]
  const selectors = EMAIL_SELECTORS[provider]
  
  const rowElements = document.querySelectorAll(rowSelector)
  
  // Debug: log how many elements found
  if (rowElements.length === 0) {
    console.log(`[MailGuard] No email rows found with selector: ${rowSelector}`)
  }
  
  rowElements.forEach((row, index) => {
    const rect = row.getBoundingClientRect()
    
    // Only include visible rows in viewport
    if (rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight) {
      const id = `row-${index}`
      
      // Extract preview data using site-specific selectors
      const senderEl = row.querySelector(selectors.sender)
      const from = senderEl?.getAttribute('email') || 
                   senderEl?.getAttribute('title') || 
                   senderEl?.textContent?.trim() || ''
      
      const subjectEl = row.querySelector(selectors.subject)
      const subject = subjectEl?.textContent?.trim() || ''
      
      // Use viewport coordinates - the overlay script will handle screen positioning
      rows.push({
        id,
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        from,
        subject
      })
      emailRowElements.set(id, row)
    }
  })
  
  return rows
}

// Initialize event listeners once (they check isMailGuardActive internally)
function initializeListeners(): void {
  if (listenersInitialized) return
  listenersInitialized = true
  
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
  
  console.log('[MailGuard] Event listeners initialized')
}

function startRowPositionUpdates(): void {
  // Initialize listeners once
  initializeListeners()
  
  // Don't start if already running
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
    const provider = getCurrentEmailProvider()
    sendToBackground({ type: 'MAILGUARD_UPDATE_ROWS', rows, provider })
  }, 1000)
  
  // Watch for URL changes within the SPA
  if (!urlCheckInterval) {
    let lastUrl = window.location.href
    urlCheckInterval = setInterval(() => {
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
}

// List of supported email sites where MailGuard can be active
const SUPPORTED_EMAIL_SITES = [
  'mail.google.com',
  'outlook.live.com',
  'outlook.office.com',
  'outlook.office365.com'
]

type EmailProvider = 'gmail' | 'outlook' | 'unknown'

function getCurrentEmailProvider(): EmailProvider {
  const hostname = window.location.hostname
  if (hostname.includes('mail.google.com')) return 'gmail'
  if (hostname.includes('outlook.live.com') || 
      hostname.includes('outlook.office.com') || 
      hostname.includes('outlook.office365.com')) return 'outlook'
  return 'unknown'
}

function isOnSupportedEmailSite(): boolean {
  const hostname = window.location.hostname
  return SUPPORTED_EMAIL_SITES.some(site => hostname.includes(site))
}

// Site-specific selectors for email rows
// Outlook uses different layouts - message list items are typically in a virtualized list
const EMAIL_ROW_SELECTORS = {
  gmail: 'tr.zA, tr[role="row"], div[role="row"]',
  outlook: '[data-convid], div[role="option"][aria-selected], div[role="listitem"], div[data-item-index], [aria-label*="message" i][role="option"], .customScrollBar div[tabindex="0"][role="option"]'
}

// Site-specific selectors for email content extraction
const EMAIL_SELECTORS = {
  gmail: {
    sender: '[email], .yP, .zF, .bA4 span[email], span[name], .yW span',
    subject: '.bog, .bqe, .y6 span:first-child, .xT .y6',
    snippet: '.y2, .Zt, .xT .y2',
    date: '.xW span[title], .apt span[title], td.xW span, .xW.xY span',
    attachment: '.brd[data-tooltip*="Attachment"], .aZo .aZs, [data-tooltip*="attachment" i], .bqX .yf img[alt*="Attachment" i]'
  },
  outlook: {
    // Outlook sender - look for name elements with email attribute or title
    sender: '[title*="@"], span[title*="@"], [data-testid*="sender"], [data-testid*="name"], .OZZZK, .XbIp4',
    // Outlook subject - various class names used
    subject: '[data-testid*="subject"], .JHrmG, .lvHighlightSubjectClass, span[id*="subject"]',
    // Outlook snippet/preview
    snippet: '[data-testid*="preview"], .LgbsSe, .Jzv0o, .yaDWK',
    // Outlook date - time elements or spans with date
    date: 'time, span[aria-label*="received"], [data-testid*="date"], .l8Tnu',
    // Outlook attachment indicator
    attachment: '[data-testid*="attachment"], [aria-label*="attachment" i], svg[aria-label*="attachment" i], .FTOXx'
  }
}

function stopRowPositionUpdates(): void {
  if (rowUpdateInterval) {
    clearInterval(rowUpdateInterval)
    rowUpdateInterval = null
  }
  // Note: We don't clear urlCheckInterval as it's harmless when inactive
  // and we don't remove event listeners - they just check isMailGuardActive
}

// =============================================================================
// Email Content Extraction (Preview-Only Mode)
// =============================================================================

// IMPORTANT: This extracts ONLY preview info from inbox rows.
// The email is NEVER opened/rendered for security.
// Full content requires Gmail API setup (future feature).

async function extractEmailContent(rowId: string): Promise<SanitizedEmail | null> {
  const row = emailRowElements.get(rowId)
  if (!row) {
    console.error('[MailGuard] Row not found:', rowId)
    return null
  }
  
  const provider = getCurrentEmailProvider()
  console.log('[MailGuard] Extracting content for provider:', provider, 'rowId:', rowId)
  
  if (provider === 'unknown') return null
  
  const selectors = EMAIL_SELECTORS[provider]
  
  try {
    let from = ''
    let subject = ''
    let snippet = ''
    let date = ''
    
    if (provider === 'outlook') {
      // Outlook-specific extraction with fallbacks
      // Try to find sender - look for any element with email-like title or specific classes
      const senderEl = row.querySelector(selectors.sender) || 
                       row.querySelector('[title*="@"]') ||
                       row.querySelector('span[class*="sender"]') ||
                       row.querySelector('span[class*="from"]')
      from = senderEl?.getAttribute('title') || 
             senderEl?.textContent?.trim() || 
             '(Unknown sender)'
      
      // Try to find subject - usually the largest/boldest text
      const subjectEl = row.querySelector(selectors.subject) ||
                        row.querySelector('[class*="subject"]') ||
                        row.querySelector('[class*="Subject"]')
      subject = subjectEl?.textContent?.trim() || ''
      
      // If no subject found, try to get it from the row's text content
      if (!subject) {
        // Get all text spans and find likely subject (usually second line)
        const allSpans = Array.from(row.querySelectorAll('span'))
        for (const span of allSpans) {
          const text = span.textContent?.trim() || ''
          // Skip if it looks like an email address or date
          if (text.length > 10 && !text.includes('@') && !/^\d/.test(text)) {
            subject = text
            break
          }
        }
      }
      
      // Try to find snippet/preview
      const snippetEl = row.querySelector(selectors.snippet) ||
                        row.querySelector('[class*="preview"]') ||
                        row.querySelector('[class*="snippet"]')
      snippet = snippetEl?.textContent?.trim() || ''
      
      // Try to find date
      const dateEl = row.querySelector(selectors.date) ||
                     row.querySelector('time') ||
                     row.querySelector('[datetime]')
      date = dateEl?.getAttribute('datetime') || 
             dateEl?.getAttribute('title') ||
             dateEl?.textContent?.trim() || ''
      
      // Fallback: extract all text from the row if we don't have good data
      if (!subject && !snippet) {
        const allText = row.textContent?.trim() || ''
        // Split by newlines and try to parse
        const lines = allText.split(/\n/).map(l => l.trim()).filter(l => l.length > 0)
        if (lines.length >= 2) {
          from = from || lines[0]
          subject = lines[1] || '(No subject)'
          snippet = lines.slice(2).join(' ')
        }
      }
      
      console.log('[MailGuard] Outlook extraction result:', { from, subject: subject.substring(0, 50), snippet: snippet.substring(0, 50), date })
    } else {
      // Gmail extraction (original logic)
      const senderEl = row.querySelector(selectors.sender)
      from = senderEl?.getAttribute('email') || 
             senderEl?.getAttribute('name') ||
             senderEl?.getAttribute('title') || 
             senderEl?.textContent?.trim() || 
             '(Unknown sender)'
      
      const subjectEl = row.querySelector(selectors.subject)
      subject = subjectEl?.textContent?.trim() || '(No subject)'
      
      const snippetEl = row.querySelector(selectors.snippet)
      snippet = snippetEl?.textContent?.trim() || ''
      
      const dateEl = row.querySelector(selectors.date)
      date = dateEl?.getAttribute('title') || 
             dateEl?.getAttribute('datetime') ||
             dateEl?.textContent?.trim() || ''
    }
    
    // Check for attachment indicator using site-specific selectors
    const attachmentIcon = row.querySelector(selectors.attachment)
    const hasAttachment = attachmentIcon !== null
    
    // Only include attachments array if there are actual attachments
    const attachments: { name: string; type: string }[] = []
    
    // Return preview data - email is never opened
    const result = { 
      from, 
      to: '', // Not available in preview
      subject: subject || '(No subject)', 
      date, 
      body: snippet || '(Preview not available - connect email API for full content)', 
      attachments
    }
    
    console.log('[MailGuard] Email extraction complete:', result.subject.substring(0, 50))
    return result
  } catch (err) {
    console.error('[MailGuard] Error extracting preview:', err)
    return null
  }
}

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
  
  // If already active, just dismiss banner and show status
  if (isMailGuardActive) {
    console.log('[MailGuard] Already active')
    dismissBanner()
    showStatusMarker()
    return
  }
  
  dismissBanner()
  
  const colors = themeColors[currentTheme]
  
  // Show "connecting" status
  const statusDiv = document.createElement('div')
  statusDiv.id = 'mailguard-connecting'
  statusDiv.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483647;
    background: linear-gradient(135deg, ${colors.primaryDark} 0%, ${colors.primaryDarker} 100%);
    color: #fff;
    padding: 12px 24px;
    border-radius: 8px;
    font-family: sans-serif;
    font-size: 14px;
    box-shadow: 0 4px 15px ${colors.shadowColorMedium};
    display: flex;
    align-items: center;
    gap: 10px;
  `
  statusDiv.innerHTML = '<span style="animation: spin 1s linear infinite; display: inline-block;">⏳</span> Connecting to OpenGiraffe...'
  document.body.appendChild(statusDiv)
  
  // Add spin animation
  const style = document.createElement('style')
  style.id = 'mailguard-spin-style'
  style.textContent = '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }'
  if (!document.getElementById('mailguard-spin-style')) {
    document.head.appendChild(style)
  }
  
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
  console.log('[MailGuard] Sending MAILGUARD_ACTIVATE to background with theme:', currentTheme)
  
  // More aggressive retry logic - try up to 5 times
  const maxRetries = 5
  let lastError = ''
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        statusDiv.innerHTML = `<span style="animation: spin 1s linear infinite; display: inline-block;">⏳</span> Connecting... (attempt ${attempt}/${maxRetries})`
        // Progressive delay: 300ms, 600ms, 900ms, 1200ms
        await new Promise(r => setTimeout(r, attempt * 300))
      }
      
      // The background script now handles connection retries internally
      const response = await sendToBackground({ type: 'MAILGUARD_ACTIVATE', windowInfo, theme: currentTheme })
      console.log('[MailGuard] Response from background (attempt', attempt, '):', response)
      
      if (response?.success) {
        statusDiv.innerHTML = '<span style="color: #4ade80;">✓</span> Connected!'
        await new Promise(r => setTimeout(r, 500))
        statusDiv.remove()
        
        isMailGuardActive = true
        showStatusMarker()
        startRowPositionUpdates()
        
        // Send initial row positions
        const rows = getEmailRowPositions()
        console.log('[MailGuard] Sending', rows.length, 'email rows to Electron')
        sendToBackground({ type: 'MAILGUARD_UPDATE_ROWS', rows })
        return // Success!
      } else {
        lastError = response?.error || 'Unknown error'
        console.log('[MailGuard] Attempt', attempt, 'failed:', lastError)
        
        // If it's a connection error, the background is already retrying
        // Wait a bit longer for it to succeed
        if (lastError.includes('connect') || lastError.includes('OpenGiraffe')) {
          await new Promise(r => setTimeout(r, 500))
        }
      }
    } catch (err) {
      lastError = String(err)
      console.error('[MailGuard] Attempt', attempt, 'exception:', err)
    }
  }
  
  // All retries failed
  statusDiv.remove()
  showActivationError(lastError || 'Connection failed. Please ensure the OpenGiraffe app is running and try again.')
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
    showReEnableBanner() // Show re-enable option so user can retry
  }, 8000)
}

let userManuallyDisabled = false

function deactivateMailGuard(): void {
  console.log('[MailGuard] Deactivating...')
  isMailGuardActive = false
  userManuallyDisabled = true // User explicitly disabled - don't auto-re-enable
  stopRowPositionUpdates()
  sendToBackground({ type: 'MAILGUARD_DEACTIVATE' })
  showReEnableBanner()
}

// =============================================================================
// Message Handling from Background Script
// =============================================================================

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'MAILGUARD_ACTIVATED') {
    console.log('[MailGuard] Activation confirmed by Electron')
    isMailGuardActive = true
    dismissBanner() // Make sure banner is removed when activated
    showStatusMarker()
    startRowPositionUpdates()
  } else if (msg.type === 'MAILGUARD_DEACTIVATED') {
    console.log('[MailGuard] Deactivation confirmed')
    isMailGuardActive = false
    userManuallyDisabled = true
    stopRowPositionUpdates()
    showReEnableBanner()
  } else if (msg.type === 'MAILGUARD_SCROLL') {
    // Perform scroll on the email list - forwarded from overlay
    console.log('[MailGuard] Scroll request received, deltaY:', msg.deltaY)
    
    // For Outlook, we need to find the scrollable container
    // Outlook uses virtualized lists, so we need to find the right element
    const scrollAmount = msg.deltaY
    
    // Try to find scrollable elements by checking actual scrollability
    const allElements = document.querySelectorAll('*')
    let scrolled = false
    
    // First try known Outlook/Gmail selectors
    const prioritySelectors = [
      // Outlook selectors
      '[data-app-section="MessageList"] > div',
      '[data-app-section="MessageList"]',
      'div[role="list"]',
      'div[aria-label*="message" i]',
      'div[aria-label*="Message" i]',
      // Gmail selectors
      '.aeN',
      '.bkK',
      'div[role="main"]'
    ]
    
    for (const selector of prioritySelectors) {
      const elements = document.querySelectorAll(selector)
      for (const el of elements) {
        const htmlEl = el as HTMLElement
        if (htmlEl.scrollHeight > htmlEl.clientHeight + 10) {
          console.log('[MailGuard] Scrolling via selector:', selector, 'scrollHeight:', htmlEl.scrollHeight, 'clientHeight:', htmlEl.clientHeight)
          htmlEl.scrollTop += scrollAmount
          scrolled = true
          break
        }
      }
      if (scrolled) break
    }
    
    // If still not scrolled, try to find any scrollable div
    if (!scrolled) {
      for (const el of allElements) {
        const htmlEl = el as HTMLElement
        const style = window.getComputedStyle(htmlEl)
        const isScrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll') && 
                            htmlEl.scrollHeight > htmlEl.clientHeight + 50
        if (isScrollable && htmlEl.offsetWidth > 200) {
          console.log('[MailGuard] Found scrollable element:', htmlEl.className || htmlEl.tagName)
          htmlEl.scrollTop += scrollAmount
          scrolled = true
          break
        }
      }
    }
    
    // Ultimate fallback
    if (!scrolled) {
      console.log('[MailGuard] Fallback: scrolling window')
      window.scrollBy(0, scrollAmount)
    }
  } else if (msg.type === 'MAILGUARD_EXTRACT_EMAIL') {
    console.log('[MailGuard] Email extraction requested for row:', msg.rowId)
    extractEmailContent(msg.rowId).then(email => {
      if (email) {
        console.log('[MailGuard] Sending extracted email content')
        sendToBackground({ type: 'MAILGUARD_EMAIL_CONTENT', email })
      } else {
        // Send a fallback response so the overlay doesn't hang
        console.log('[MailGuard] Extraction failed, sending fallback')
        sendToBackground({ 
          type: 'MAILGUARD_EMAIL_CONTENT', 
          email: {
            from: '(Could not extract)',
            to: '',
            subject: '(Preview not available)',
            date: '',
            body: 'Could not extract email preview. Try connecting your email provider API for full content.',
            attachments: []
          }
        })
      }
    }).catch(err => {
      console.error('[MailGuard] Extraction error:', err)
      sendToBackground({ 
        type: 'MAILGUARD_EMAIL_CONTENT', 
        email: {
          from: '(Error)',
          to: '',
          subject: '(Extraction error)',
          date: '',
          body: 'An error occurred while extracting email preview: ' + (err?.message || 'Unknown error'),
          attachments: []
        }
      })
    })
  } else if (msg.type === 'MAILGUARD_STATUS_RESPONSE') {
    console.log('[MailGuard] Status response:', msg.active)
    if (msg.active) {
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
  const provider = getCurrentEmailProvider()
  console.log('[MailGuard] Initializing on:', window.location.hostname, '- Provider:', provider)
  
  // Only run on supported email sites
  if (provider === 'unknown') {
    console.log('[MailGuard] Not on a supported email site, exiting')
    return
  }
  
  // Load theme first
  await loadTheme()
  
  // Wait for email UI to be ready
  await waitForEmailUIReady(provider)
  
  // Check if MailGuard is already active in Electron
  await sendToBackground({ type: 'MAILGUARD_STATUS' })
  
  // Auto-enable MailGuard protection when on email page
  // Users can disable via Escape key or clicking the status badge
  setTimeout(() => {
    if (!isMailGuardActive && !userManuallyDisabled) {
      console.log('[MailGuard] Auto-enabling protection on email page')
      activateMailGuard()
    } else if (userManuallyDisabled) {
      console.log('[MailGuard] User previously disabled protection, showing re-enable option')
      showReEnableBanner()
    }
  }, 1500) // Slightly longer delay to ensure email UI is fully ready
}

async function waitForEmailUIReady(provider: EmailProvider): Promise<void> {
  console.log(`[MailGuard] Waiting for ${provider} UI...`)
  
  // Provider-specific container and row selectors for readiness detection
  const readinessSelectors = {
    gmail: {
      container: 'div[role="main"], div.aeN, div.nH',
      rows: 'tr.zA, div[role="row"]'
    },
    outlook: {
      // Outlook uses various selectors depending on version
      container: '[data-app-section="MessageList"], div[role="main"], [role="complementary"], div[data-app-section="ConversationContainer"], #MainModule',
      rows: '[data-convid], div[role="option"], div[role="listitem"], [aria-label*="message" i]'
    }
  }
  
  const selectors = (provider !== 'unknown' ? readinessSelectors[provider] : null) || readinessSelectors.gmail
  
  for (let i = 0; i < 30; i++) {
    const container = document.querySelector(selectors.container)
    const rows = document.querySelectorAll(selectors.rows)
    
    console.log(`[MailGuard] ${provider} UI check ${i+1}/30: container=${!!container}, rows=${rows.length}`)
    
    if (container || rows.length > 0) {
      console.log(`[MailGuard] ${provider} UI ready - found ${rows.length} potential email rows`)
      return
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  
  console.log(`[MailGuard] ${provider} UI detection timeout, proceeding anyway`)
}

// Start initialization
console.log('[MailGuard] Content script loaded on:', window.location.hostname)
init().catch(err => console.error('[MailGuard] Init error:', err))
