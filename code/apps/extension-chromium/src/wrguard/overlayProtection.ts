/**
 * WRGuard Overlay Protection
 * 
 * Content script utility for enforcing overlay protection on protected sites.
 * Blocks links, attachments, media, and automation triggers.
 * 
 * @version 1.0.0
 */

import type { SiteProtectionSettings, OverlayBlockEvent } from './types'
import { DEFAULT_PROTECTION_SETTINGS } from './types'

// =============================================================================
// Protection State
// =============================================================================

interface ProtectionState {
  isProtected: boolean
  domain: string
  settings: SiteProtectionSettings
  blockedCount: number
}

let protectionState: ProtectionState = {
  isProtected: false,
  domain: '',
  settings: DEFAULT_PROTECTION_SETTINGS,
  blockedCount: 0
}

// =============================================================================
// Overlay UI
// =============================================================================

function createBlockOverlay(
  element: HTMLElement,
  type: 'link' | 'attachment' | 'media' | 'automation',
  details: string
): HTMLElement {
  const overlay = document.createElement('div')
  overlay.className = 'wrguard-block-overlay'
  overlay.setAttribute('data-wrguard', 'true')
  overlay.setAttribute('data-block-type', type)
  
  const icon = type === 'link' ? '🔗' 
    : type === 'attachment' ? '📎'
    : type === 'media' ? '🖼️'
    : '⚡'
  
  overlay.innerHTML = `
    <div style="
      position: absolute;
      inset: 0;
      background: rgba(239, 68, 68, 0.15);
      backdrop-filter: blur(2px);
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px dashed rgba(239, 68, 68, 0.5);
      border-radius: 4px;
      cursor: not-allowed;
      z-index: 999999;
    ">
      <div style="
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 11px;
        font-family: system-ui, -apple-system, sans-serif;
        text-align: center;
        max-width: 200px;
      ">
        <div style="font-size: 16px; margin-bottom: 4px;">${icon} 🛡️</div>
        <div style="font-weight: 600; margin-bottom: 2px;">WRGuard Protected</div>
        <div style="opacity: 0.8;">${details}</div>
        ${protectionState.settings.allowBypassWithConfirmation ? `
          <button 
            class="wrguard-bypass-btn" 
            style="
              margin-top: 8px;
              background: rgba(255,255,255,0.2);
              border: 1px solid rgba(255,255,255,0.3);
              color: white;
              padding: 4px 10px;
              border-radius: 4px;
              font-size: 10px;
              cursor: pointer;
            "
          >
            Bypass with confirmation
          </button>
        ` : ''}
      </div>
    </div>
  `
  
  // Position the overlay
  const rect = element.getBoundingClientRect()
  if (rect.width > 0 && rect.height > 0) {
    overlay.style.cssText = `
      position: absolute;
      top: ${element.offsetTop}px;
      left: ${element.offsetLeft}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      pointer-events: auto;
    `
  }
  
  // Add bypass handler
  const bypassBtn = overlay.querySelector('.wrguard-bypass-btn')
  if (bypassBtn) {
    bypassBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      if (confirm('Are you sure you want to bypass WRGuard protection?\n\nThis action will be logged.')) {
        overlay.remove()
        logBypassEvent(type, details)
      }
    })
  }
  
  return overlay
}

function logBypassEvent(type: string, details: string): void {
  console.log('[WRGuard] Bypass event:', { type, details, timestamp: Date.now() })
  
  // Send to background script for logging
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.sendMessage({
      type: 'WRGUARD_BYPASS_EVENT',
      payload: {
        site: protectionState.domain,
        blockedType: type,
        details,
        timestamp: Date.now()
      }
    })
  }
}

// =============================================================================
// Link Protection
// =============================================================================

function protectLinks(): void {
  if (!protectionState.settings.blockLinks) return
  
  const links = document.querySelectorAll('a[href]:not([data-wrguard-processed])')
  
  links.forEach((link) => {
    const anchor = link as HTMLAnchorElement
    anchor.setAttribute('data-wrguard-processed', 'true')
    
    // Check if it's an external link
    const href = anchor.href
    if (!href) return
    
    try {
      const url = new URL(href)
      const isExternal = url.hostname !== window.location.hostname
      const isSuspicious = url.protocol !== 'https:' && url.protocol !== 'http:'
      
      if (isExternal || isSuspicious) {
        // Make link position relative for overlay positioning
        const computed = window.getComputedStyle(anchor)
        if (computed.position === 'static') {
          anchor.style.position = 'relative'
        }
        
        const overlay = createBlockOverlay(
          anchor,
          'link',
          `External link to ${url.hostname}`
        )
        anchor.appendChild(overlay)
        protectionState.blockedCount++
        
        // Prevent click
        anchor.addEventListener('click', (e) => {
          if (!anchor.querySelector('.wrguard-block-overlay')) return
          e.preventDefault()
          e.stopPropagation()
        }, { capture: true })
      }
    } catch {
      // Invalid URL, skip
    }
  })
}

// =============================================================================
// Attachment Protection
// =============================================================================

function protectAttachments(): void {
  if (!protectionState.settings.blockAttachments) return
  
  // Find download links and attachment elements
  const attachmentSelectors = [
    'a[download]',
    'a[href*=".pdf"]',
    'a[href*=".doc"]',
    'a[href*=".xls"]',
    'a[href*=".zip"]',
    '[data-attachment]',
    '.attachment',
    '.file-attachment'
  ]
  
  const attachments = document.querySelectorAll(
    attachmentSelectors.map(s => `${s}:not([data-wrguard-processed])`).join(',')
  )
  
  attachments.forEach((attachment) => {
    const el = attachment as HTMLElement
    el.setAttribute('data-wrguard-processed', 'true')
    
    const computed = window.getComputedStyle(el)
    if (computed.position === 'static') {
      el.style.position = 'relative'
    }
    
    const filename = el.getAttribute('download') || el.textContent?.trim() || 'attachment'
    const overlay = createBlockOverlay(
      el,
      'attachment',
      `Attachment: ${filename.slice(0, 30)}`
    )
    el.appendChild(overlay)
    protectionState.blockedCount++
    
    el.addEventListener('click', (e) => {
      if (!el.querySelector('.wrguard-block-overlay')) return
      e.preventDefault()
      e.stopPropagation()
    }, { capture: true })
  })
}

// =============================================================================
// Media Protection
// =============================================================================

function protectMedia(): void {
  if (!protectionState.settings.blockMedia) return
  
  const mediaElements = document.querySelectorAll(
    'img:not([data-wrguard-processed]), video:not([data-wrguard-processed]), audio:not([data-wrguard-processed])'
  )
  
  mediaElements.forEach((media) => {
    const el = media as HTMLElement
    
    // Only block external media
    const src = el.getAttribute('src') || ''
    if (!src) return
    
    try {
      const url = new URL(src, window.location.href)
      const isExternal = url.hostname !== window.location.hostname
      
      if (isExternal) {
        el.setAttribute('data-wrguard-processed', 'true')
        
        const computed = window.getComputedStyle(el)
        if (computed.position === 'static') {
          el.style.position = 'relative'
        }
        
        const parent = el.parentElement
        if (parent) {
          const overlay = createBlockOverlay(
            el,
            'media',
            `External media from ${url.hostname}`
          )
          parent.style.position = 'relative'
          parent.appendChild(overlay)
          protectionState.blockedCount++
        }
      }
    } catch {
      // Invalid URL, skip
    }
  })
}

// =============================================================================
// Automation Protection
// =============================================================================

function protectAutomationTriggers(): void {
  if (!protectionState.settings.blockAutomationTriggers) return
  
  // Look for common automation triggers
  const triggerSelectors = [
    '[onclick*="submit"]',
    '[onclick*="send"]',
    'form[action*="api"]',
    '[data-automation]',
    '.automation-trigger'
  ]
  
  const triggers = document.querySelectorAll(
    triggerSelectors.map(s => `${s}:not([data-wrguard-processed])`).join(',')
  )
  
  triggers.forEach((trigger) => {
    const el = trigger as HTMLElement
    el.setAttribute('data-wrguard-processed', 'true')
    
    const computed = window.getComputedStyle(el)
    if (computed.position === 'static') {
      el.style.position = 'relative'
    }
    
    const overlay = createBlockOverlay(
      el,
      'automation',
      'Automation trigger blocked'
    )
    el.appendChild(overlay)
    protectionState.blockedCount++
  })
}

// =============================================================================
// Main Protection Function
// =============================================================================

/**
 * Initialize overlay protection for the current page
 */
export function initializeOverlayProtection(
  domain: string,
  settings: SiteProtectionSettings
): void {
  protectionState = {
    isProtected: true,
    domain,
    settings,
    blockedCount: 0
  }
  
  console.log('[WRGuard] Initializing overlay protection for:', domain)
  
  // Run initial protection
  runProtection()
  
  // Observe DOM changes for dynamic content
  const observer = new MutationObserver((mutations) => {
    let hasNewContent = false
    mutations.forEach((mutation) => {
      if (mutation.addedNodes.length > 0) {
        hasNewContent = true
      }
    })
    if (hasNewContent) {
      runProtection()
    }
  })
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  })
  
  // Show protection indicator
  showProtectionIndicator()
}

function runProtection(): void {
  protectLinks()
  protectAttachments()
  protectMedia()
  protectAutomationTriggers()
}

function showProtectionIndicator(): void {
  // Create a small indicator in the corner
  const indicator = document.createElement('div')
  indicator.id = 'wrguard-indicator'
  indicator.innerHTML = `
    <div style="
      position: fixed;
      bottom: 16px;
      right: 16px;
      background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
      color: white;
      padding: 8px 14px;
      border-radius: 20px;
      font-size: 12px;
      font-family: system-ui, -apple-system, sans-serif;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      z-index: 999998;
      cursor: pointer;
    ">
      <span>🛡️</span>
      <span>WRGuard Active</span>
    </div>
  `
  
  indicator.addEventListener('click', () => {
    alert(`WRGuard Protection Active\n\nDomain: ${protectionState.domain}\nBlocked items: ${protectionState.blockedCount}\n\nProtection:\n• Links: ${protectionState.settings.blockLinks ? '✓' : '✗'}\n• Attachments: ${protectionState.settings.blockAttachments ? '✓' : '✗'}\n• Media: ${protectionState.settings.blockMedia ? '✓' : '✗'}\n• Automation: ${protectionState.settings.blockAutomationTriggers ? '✓' : '✗'}`)
  })
  
  document.body.appendChild(indicator)
}

/**
 * Check if current page should be protected
 */
export async function checkAndApplyProtection(): Promise<void> {
  const currentDomain = window.location.hostname
  
  // Request protected sites from background
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'WRGUARD_CHECK_SITE',
        payload: { domain: currentDomain }
      })
      
      if (response?.isProtected && response?.settings) {
        initializeOverlayProtection(currentDomain, response.settings)
      }
    } catch (error) {
      console.log('[WRGuard] Not in extension context')
    }
  }
}

/**
 * Disable protection (for testing)
 */
export function disableProtection(): void {
  protectionState.isProtected = false
  
  // Remove all overlays
  document.querySelectorAll('.wrguard-block-overlay').forEach(el => el.remove())
  
  // Remove indicator
  document.getElementById('wrguard-indicator')?.remove()
  
  // Remove processed markers
  document.querySelectorAll('[data-wrguard-processed]').forEach(el => {
    el.removeAttribute('data-wrguard-processed')
  })
}



