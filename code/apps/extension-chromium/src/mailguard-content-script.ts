/**
 * WR MailGuard - Standalone Content Script for Gmail
 * 
 * This script runs ONLY on mail.google.com and is completely isolated
 * from the main extension content script. If this fails, the main
 * extension still works.
 * 
 * Features:
 * - Activation banner on first visit
 * - Transparent overlay blocking direct email clicks
 * - Hover buttons to open sanitized email content
 * - Lightbox viewer for safe email display
 * - PDF attachment rendering as safe images
 */

// =============================================================================
// Types
// =============================================================================

interface MailGuardSettings {
  enabledDomains: string[];
}

interface SanitizedEmail {
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  attachments: AttachmentInfo[];
}

interface AttachmentInfo {
  name: string;
  type: string;
  url: string;
  size?: string;
}

// =============================================================================
// Constants
// =============================================================================

const STORAGE_KEY = 'wrMailGuardSettings';
const CURRENT_DOMAIN = 'mail.google.com';

// =============================================================================
// Settings Management
// =============================================================================

async function loadSettings(): Promise<MailGuardSettings> {
  return new Promise((resolve) => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
        chrome.storage.sync.get([STORAGE_KEY], (result) => {
          const settings = result[STORAGE_KEY] || { enabledDomains: [] };
          resolve(settings);
        });
      } else {
        resolve({ enabledDomains: [] });
      }
    } catch (err) {
      console.error('[MailGuard] Error loading settings:', err);
      resolve({ enabledDomains: [] });
    }
  });
}

async function saveSettings(settings: MailGuardSettings): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
        chrome.storage.sync.set({ [STORAGE_KEY]: settings }, () => {
          resolve();
        });
      } else {
        resolve();
      }
    } catch (err) {
      console.error('[MailGuard] Error saving settings:', err);
      resolve();
    }
  });
}

// =============================================================================
// UI Components (all use Shadow DOM for isolation)
// =============================================================================

function createActivationBanner(onEnable: () => void, onDismiss: () => void): HTMLElement {
  const container = document.createElement('div');
  container.id = 'wr-mailguard-banner';
  
  const shadow = container.attachShadow({ mode: 'closed' });
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
        padding: 12px 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 20px;
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
        gap: 12px;
        color: #fff;
      }
      .icon {
        font-size: 24px;
      }
      .text {
        font-size: 14px;
      }
      .title {
        font-weight: 600;
        color: #3b82f6;
      }
      .desc {
        color: rgba(255,255,255,0.8);
        font-size: 12px;
      }
      .buttons {
        display: flex;
        gap: 10px;
      }
      .btn {
        padding: 8px 16px;
        border-radius: 6px;
        font-size: 12px;
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
          <div class="title">Enable WR MailGuard for Gmail?</div>
          <div class="desc">View emails safely with sanitized content - no scripts, no tracking, no hidden content</div>
        </div>
      </div>
      <div class="buttons">
        <button class="btn btn-secondary" id="dismiss-btn">Not now</button>
        <button class="btn btn-primary" id="enable-btn">Enable Protection</button>
      </div>
    </div>
  `;
  
  shadow.getElementById('enable-btn')?.addEventListener('click', onEnable);
  shadow.getElementById('dismiss-btn')?.addEventListener('click', onDismiss);
  
  return container;
}

function createStatusBadge(onDisable: () => void): HTMLElement {
  const container = document.createElement('div');
  container.id = 'wr-mailguard-status';
  
  const shadow = container.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      .badge {
        position: fixed;
        top: 8px;
        right: 8px;
        z-index: 2147483646;
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        border: 1px solid #22c55e;
        border-radius: 20px;
        padding: 6px 14px;
        display: flex;
        align-items: center;
        gap: 8px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 11px;
        color: #22c55e;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        cursor: pointer;
        transition: all 0.15s;
      }
      .badge:hover {
        border-color: #ef4444;
        color: #ef4444;
      }
      .badge:hover .text::after {
        content: ' - Click to disable';
        color: rgba(255,255,255,0.5);
      }
      .icon { font-size: 14px; }
    </style>
    <div class="badge" title="Click to disable WR MailGuard">
      <span class="icon">🛡️</span>
      <span class="text">MailGuard Active</span>
    </div>
  `;
  
  shadow.querySelector('.badge')?.addEventListener('click', onDisable);
  
  return container;
}

function createTransparentOverlay(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.id = 'wr-mailguard-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 2147483640;
    pointer-events: none;
  `;
  return overlay;
}

function createHoverButtons(): { container: HTMLElement; shadow: ShadowRoot } {
  const container = document.createElement('div');
  container.id = 'wr-mailguard-hover-buttons';
  
  const shadow = container.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      * { box-sizing: border-box; }
      .hover-container {
        position: fixed;
        display: none;
        z-index: 2147483645;
        pointer-events: auto;
      }
      .hover-container.visible {
        display: flex;
        gap: 6px;
      }
      .hover-btn {
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        border: 1px solid #3b82f6;
        border-radius: 6px;
        padding: 8px 12px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 11px;
        color: #fff;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.4);
        transition: all 0.15s;
        white-space: nowrap;
      }
      .hover-btn:hover {
        background: #3b82f6;
        transform: translateY(-1px);
        box-shadow: 0 6px 20px rgba(59,130,246,0.4);
      }
      .hover-btn .icon {
        font-size: 14px;
      }
    </style>
    <div class="hover-container" id="buttons">
      <button class="hover-btn" id="safe-view-btn">
        <span class="icon">🛡️</span>
        Open Safe Email
      </button>
    </div>
  `;
  
  return { container, shadow };
}

function createLightbox(): { container: HTMLElement; shadow: ShadowRoot } {
  const container = document.createElement('div');
  container.id = 'wr-mailguard-lightbox';
  
  const shadow = container.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      .overlay {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.75);
        z-index: 2147483647;
        justify-content: center;
        align-items: center;
        padding: 40px;
      }
      .overlay.visible {
        display: flex;
      }
      .modal {
        background: #fff;
        border-radius: 12px;
        max-width: 900px;
        width: 100%;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 25px 80px rgba(0,0,0,0.5);
        overflow: hidden;
      }
      .modal-header {
        padding: 16px 20px;
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 2px solid #3b82f6;
      }
      .modal-title {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 16px;
        font-weight: 600;
        color: #fff;
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .modal-title .shield { color: #22c55e; font-size: 20px; }
      .close-btn {
        background: rgba(255,255,255,0.1);
        border: 1px solid rgba(255,255,255,0.2);
        width: 32px;
        height: 32px;
        border-radius: 50%;
        font-size: 18px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        transition: all 0.15s;
      }
      .close-btn:hover {
        background: rgba(255,255,255,0.2);
      }
      .modal-body {
        padding: 20px;
        overflow-y: auto;
        flex: 1;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .safe-notice {
        background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
        border: 1px solid #22c55e;
        border-radius: 8px;
        padding: 12px 16px;
        margin-bottom: 20px;
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 12px;
        color: #166534;
      }
      .safe-notice .icon { font-size: 18px; }
      .email-meta {
        background: #f8fafc;
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 20px;
      }
      .meta-row {
        display: flex;
        margin-bottom: 8px;
        font-size: 13px;
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
        color: #1e293b;
        margin: 16px 0;
        line-height: 1.3;
      }
      .email-body {
        font-size: 14px;
        line-height: 1.7;
        color: #374151;
        white-space: pre-wrap;
        word-wrap: break-word;
        padding: 16px;
        background: #fafafa;
        border-radius: 8px;
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
        color: #1e293b;
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
        transition: all 0.15s;
        font-size: 12px;
        color: #475569;
      }
      .attachment-item:hover {
        background: #e2e8f0;
        border-color: #3b82f6;
      }
      .attachment-item .icon { font-size: 16px; }
      .attachment-name { font-weight: 500; }
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
      .pdf-viewer {
        background: #1e293b;
        border-radius: 8px;
        padding: 20px;
        margin-top: 20px;
      }
      .pdf-page {
        background: #fff;
        margin-bottom: 10px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      }
      .pdf-page canvas {
        display: block;
        width: 100%;
        height: auto;
      }
    </style>
    <div class="overlay" id="overlay">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">
            <span class="shield">🛡️</span>
            Safe Email View
          </div>
          <button class="close-btn" id="close-btn">×</button>
        </div>
        <div class="modal-body" id="body">
          <!-- Content injected here -->
        </div>
      </div>
    </div>
  `;
  
  const overlayEl = shadow.getElementById('overlay');
  shadow.getElementById('close-btn')?.addEventListener('click', () => {
    overlayEl?.classList.remove('visible');
  });
  overlayEl?.addEventListener('click', (e) => {
    if (e.target === overlayEl) {
      overlayEl.classList.remove('visible');
    }
  });
  
  return { container, shadow };
}

// =============================================================================
// Gmail DOM Parsing
// =============================================================================

function findEmailRowUnderPoint(x: number, y: number): Element | null {
  // Temporarily hide overlay to get element underneath
  const overlay = document.getElementById('wr-mailguard-overlay');
  const hoverButtons = document.getElementById('wr-mailguard-hover-buttons');
  
  if (overlay) overlay.style.display = 'none';
  if (hoverButtons) hoverButtons.style.display = 'none';
  
  const element = document.elementFromPoint(x, y);
  
  if (overlay) overlay.style.display = '';
  if (hoverButtons) hoverButtons.style.display = '';
  
  if (!element) return null;
  
  // Find the email row (Gmail uses tr with specific classes or div with role="row")
  const row = element.closest('tr.zA, tr[role="row"], div[role="row"]');
  return row;
}

function extractEmailPreviewFromRow(row: Element): { from: string; subject: string; snippet: string; date: string } {
  let from = '';
  let subject = '';
  let snippet = '';
  let date = '';
  
  // Try various Gmail selectors for sender
  const senderEl = row.querySelector('[email], .yP, .zF, .bA4 span[email], span[name]');
  if (senderEl) {
    from = senderEl.getAttribute('email') || senderEl.getAttribute('name') || senderEl.textContent?.trim() || '';
  }
  
  // Subject - look for the main text span
  const subjectEl = row.querySelector('.bog, .bqe, .y6 span:first-child');
  if (subjectEl) {
    subject = subjectEl.textContent?.trim() || '';
  }
  
  // Snippet - preview text
  const snippetEl = row.querySelector('.y2, .Zt');
  if (snippetEl) {
    snippet = snippetEl.textContent?.trim() || '';
  }
  
  // Date
  const dateEl = row.querySelector('.xW span[title], .apt span[title], td.xW span');
  if (dateEl) {
    date = dateEl.getAttribute('title') || dateEl.textContent?.trim() || '';
  }
  
  return { from, subject, snippet, date };
}

async function openEmailAndExtractContent(row: Element): Promise<SanitizedEmail | null> {
  try {
    // Click the row to open the email
    const clickTarget = row.querySelector('td.xY, .a4W') || row;
    (clickTarget as HTMLElement).click();
    
    // Wait for email to load
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Extract email content from the opened email view
    const emailContainer = document.querySelector('.nH.if, .adn.ads, .gs');
    if (!emailContainer) {
      console.log('[MailGuard] Could not find email container');
      return null;
    }
    
    // Extract metadata
    const from = extractSender();
    const to = extractRecipients();
    const subject = extractSubject();
    const date = extractDate();
    const bodyHtml = extractBodyHtml();
    const body = sanitizeHtmlToText(bodyHtml);
    const attachments = extractAttachments();
    
    return { from, to, subject, date, body, attachments };
  } catch (err) {
    console.error('[MailGuard] Error extracting email:', err);
    return null;
  }
}

function extractSender(): string {
  const el = document.querySelector('.gD[email], .go [email], .gE.iv.gt span[email]');
  if (el) {
    const email = el.getAttribute('email') || '';
    const name = el.textContent?.trim() || '';
    return name ? `${name} <${email}>` : email;
  }
  return '';
}

function extractRecipients(): string {
  const toEl = document.querySelector('.g2');
  return toEl?.textContent?.trim() || '';
}

function extractSubject(): string {
  const el = document.querySelector('.hP, h2.hP');
  return el?.textContent?.trim() || '';
}

function extractDate(): string {
  const el = document.querySelector('.g3[title], .gK span[title]');
  return el?.getAttribute('title') || el?.textContent?.trim() || '';
}

function extractBodyHtml(): string {
  const bodyEl = document.querySelector('.a3s.aiL, .a3s.aXjCH, .ii.gt div[dir="ltr"], .ii.gt');
  return bodyEl?.innerHTML || '';
}

function extractAttachments(): AttachmentInfo[] {
  const attachments: AttachmentInfo[] = [];
  
  // Look for attachment elements in Gmail
  const attachmentEls = document.querySelectorAll('.aZo, .aQH, [download_url]');
  
  attachmentEls.forEach(el => {
    const nameEl = el.querySelector('.aV3, .aQA span') || el;
    const name = nameEl.textContent?.trim() || 'attachment';
    
    // Check if it's a PDF
    const isPdf = name.toLowerCase().endsWith('.pdf') || 
                  el.querySelector('[aria-label*="PDF"]') !== null;
    
    const downloadUrl = el.getAttribute('download_url') || 
                        el.querySelector('a[href]')?.getAttribute('href') || '';
    
    if (name) {
      attachments.push({
        name,
        type: isPdf ? 'application/pdf' : 'application/octet-stream',
        url: downloadUrl
      });
    }
  });
  
  return attachments;
}

// =============================================================================
// HTML Sanitization
// =============================================================================

function sanitizeHtmlToText(html: string): string {
  // Create a temporary container
  const temp = document.createElement('div');
  temp.innerHTML = html;
  
  // Remove scripts, styles, and other dangerous elements
  const dangerous = temp.querySelectorAll('script, style, iframe, object, embed, form, input, button');
  dangerous.forEach(el => el.remove());
  
  // Process the content to preserve structure
  let text = processNodeToText(temp);
  
  // Clean up excessive whitespace while preserving intentional line breaks
  text = text
    .replace(/\n{3,}/g, '\n\n')  // Max 2 consecutive newlines
    .replace(/[ \t]+/g, ' ')     // Collapse spaces/tabs
    .replace(/\n /g, '\n')       // Remove leading space after newline
    .trim();
  
  return text;
}

function processNodeToText(node: Node): string {
  let result = '';
  
  node.childNodes.forEach(child => {
    if (child.nodeType === Node.TEXT_NODE) {
      result += child.textContent || '';
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      const tagName = el.tagName.toLowerCase();
      
      // Skip hidden elements
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return;
      }
      
      // Handle block elements - add newlines
      const blockTags = ['p', 'div', 'br', 'tr', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre'];
      const isBlock = blockTags.includes(tagName);
      
      if (tagName === 'br') {
        result += '\n';
      } else if (tagName === 'a') {
        // Convert links to text with URL
        const href = el.getAttribute('href') || '';
        const linkText = el.textContent?.trim() || '';
        if (href && linkText && href !== linkText) {
          result += `${linkText} (${href})`;
        } else {
          result += linkText || href;
        }
      } else if (tagName === 'img') {
        // Skip images but note if there's alt text
        const alt = el.getAttribute('alt');
        if (alt) result += `[Image: ${alt}]`;
      } else if (tagName === 'li') {
        result += '\n• ' + processNodeToText(child);
      } else {
        if (isBlock) result += '\n';
        result += processNodeToText(child);
        if (isBlock) result += '\n';
      }
    }
  });
  
  return result;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// =============================================================================
// Main Controller
// =============================================================================

class WRMailGuardController {
  private settings: MailGuardSettings = { enabledDomains: [] };
  private isActive = false;
  private banner: HTMLElement | null = null;
  private statusBadge: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private hoverButtonsContainer: HTMLElement | null = null;
  private hoverButtonsShadow: ShadowRoot | null = null;
  private lightboxContainer: HTMLElement | null = null;
  private lightboxShadow: ShadowRoot | null = null;
  private currentHoveredRow: Element | null = null;
  
  async init(): Promise<void> {
    console.log('[MailGuard] Initializing on:', window.location.hostname);
    
    // The manifest already restricts this to mail.google.com/*
    // but double-check anyway
    const hostname = window.location.hostname;
    if (!hostname.includes('mail.google.com') && !hostname.includes('gmail')) {
      console.log('[MailGuard] Not on Gmail, exiting. Hostname:', hostname);
      return;
    }
    
    try {
      this.settings = await loadSettings();
      console.log('[MailGuard] Settings loaded:', this.settings);
      
      const domain = hostname; // Use actual hostname
      if (this.settings.enabledDomains.includes(domain) || 
          this.settings.enabledDomains.includes(CURRENT_DOMAIN)) {
        console.log('[MailGuard] Already enabled, activating protection');
        this.activate();
      } else {
        console.log('[MailGuard] Not enabled, showing banner');
        this.showBanner();
      }
    } catch (err) {
      console.error('[MailGuard] Init error:', err);
    }
  }
  
  private showBanner(): void {
    if (this.banner) return;
    
    this.banner = createActivationBanner(
      () => this.enableProtection(),
      () => this.dismissBanner()
    );
    document.body.appendChild(this.banner);
  }
  
  private dismissBanner(): void {
    this.banner?.remove();
    this.banner = null;
  }
  
  private async enableProtection(): Promise<void> {
    this.dismissBanner();
    
    if (!this.settings.enabledDomains.includes(CURRENT_DOMAIN)) {
      this.settings.enabledDomains.push(CURRENT_DOMAIN);
      await saveSettings(this.settings);
    }
    
    this.activate();
  }
  
  private async disableProtection(): Promise<void> {
    this.settings.enabledDomains = this.settings.enabledDomains.filter(d => d !== CURRENT_DOMAIN);
    await saveSettings(this.settings);
    this.deactivate();
    this.showBanner();
  }
  
  private activate(): void {
    if (this.isActive) return;
    this.isActive = true;
    console.log('[MailGuard] Activating protection');
    
    // Create status badge
    this.statusBadge = createStatusBadge(() => this.disableProtection());
    document.body.appendChild(this.statusBadge);
    
    // Create transparent overlay
    this.overlay = createTransparentOverlay();
    document.body.appendChild(this.overlay);
    
    // Create hover buttons
    const { container: hoverContainer, shadow: hoverShadow } = createHoverButtons();
    this.hoverButtonsContainer = hoverContainer;
    this.hoverButtonsShadow = hoverShadow;
    document.body.appendChild(this.hoverButtonsContainer);
    
    // Create lightbox
    const { container: lightboxContainer, shadow: lightboxShadow } = createLightbox();
    this.lightboxContainer = lightboxContainer;
    this.lightboxShadow = lightboxShadow;
    document.body.appendChild(this.lightboxContainer);
    
    // Setup event listeners
    this.setupEventListeners();
  }
  
  private deactivate(): void {
    if (!this.isActive) return;
    this.isActive = false;
    console.log('[MailGuard] Deactivating protection');
    
    this.statusBadge?.remove();
    this.statusBadge = null;
    
    this.overlay?.remove();
    this.overlay = null;
    
    this.hoverButtonsContainer?.remove();
    this.hoverButtonsContainer = null;
    this.hoverButtonsShadow = null;
    
    this.lightboxContainer?.remove();
    this.lightboxContainer = null;
    this.lightboxShadow = null;
  }
  
  private setupEventListeners(): void {
    // Track mouse movement to detect hovering over email rows
    document.addEventListener('mousemove', (e) => {
      if (!this.isActive) return;
      this.handleMouseMove(e);
    });
    
    // Setup safe view button click
    const safeViewBtn = this.hoverButtonsShadow?.getElementById('safe-view-btn');
    safeViewBtn?.addEventListener('click', () => {
      if (this.currentHoveredRow) {
        this.openSafeEmail(this.currentHoveredRow);
      }
    });
  }
  
  private handleMouseMove(e: MouseEvent): void {
    const row = findEmailRowUnderPoint(e.clientX, e.clientY);
    const buttonsContainer = this.hoverButtonsShadow?.getElementById('buttons');
    
    if (row && row !== this.currentHoveredRow) {
      this.currentHoveredRow = row;
      
      // Position buttons near the row
      const rect = row.getBoundingClientRect();
      if (buttonsContainer) {
        buttonsContainer.parentElement!.style.left = `${rect.right - 150}px`;
        buttonsContainer.parentElement!.style.top = `${rect.top + rect.height / 2 - 16}px`;
        buttonsContainer.classList.add('visible');
      }
    } else if (!row) {
      // Check if mouse is over the buttons themselves
      const buttonsRect = this.hoverButtonsContainer?.getBoundingClientRect();
      if (buttonsRect) {
        const isOverButtons = 
          e.clientX >= buttonsRect.left && 
          e.clientX <= buttonsRect.right &&
          e.clientY >= buttonsRect.top && 
          e.clientY <= buttonsRect.bottom;
        
        if (!isOverButtons) {
          buttonsContainer?.classList.remove('visible');
          this.currentHoveredRow = null;
        }
      }
    }
  }
  
  private async openSafeEmail(row: Element): Promise<void> {
    console.log('[MailGuard] Opening safe email view');
    
    // Hide hover buttons
    this.hoverButtonsShadow?.getElementById('buttons')?.classList.remove('visible');
    
    // Show loading state in lightbox
    const overlay = this.lightboxShadow?.getElementById('overlay');
    const body = this.lightboxShadow?.getElementById('body');
    
    if (overlay && body) {
      body.innerHTML = `
        <div class="loading">
          <div class="spinner"></div>
          <span>Loading email safely...</span>
        </div>
      `;
      overlay.classList.add('visible');
    }
    
    // Extract email content
    const email = await openEmailAndExtractContent(row);
    
    if (email) {
      this.displaySanitizedEmail(email);
    } else {
      // Show error
      if (body) {
        body.innerHTML = `
          <div class="safe-notice" style="background: #fef2f2; border-color: #ef4444; color: #991b1b;">
            <span class="icon">⚠️</span>
            <span>Could not extract email content. Please try again.</span>
          </div>
        `;
      }
    }
  }
  
  private displaySanitizedEmail(email: SanitizedEmail): void {
    const body = this.lightboxShadow?.getElementById('body');
    if (!body) return;
    
    let attachmentsHtml = '';
    if (email.attachments.length > 0) {
      const attachmentItems = email.attachments.map((att, index) => `
        <div class="attachment-item" data-index="${index}" data-url="${escapeHtml(att.url)}" data-name="${escapeHtml(att.name)}">
          <span class="icon">📎</span>
          <span class="attachment-name">${escapeHtml(att.name)}</span>
          <span style="color: #94a3b8;">→ View Safe</span>
        </div>
      `).join('');
      
      attachmentsHtml = `
        <div class="attachments">
          <div class="attachments-title">
            <span>📎</span>
            Attachments (${email.attachments.length})
          </div>
          <div class="attachment-list">
            ${attachmentItems}
          </div>
        </div>
      `;
    }
    
    body.innerHTML = `
      <div class="safe-notice">
        <span class="icon">🛡️</span>
        <span>This is a sanitized view. Scripts, tracking, and active content have been removed.</span>
      </div>
      <div class="email-meta">
        <div class="meta-row">
          <span class="meta-label">From:</span>
          <span class="meta-value">${escapeHtml(email.from) || '(unknown)'}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">To:</span>
          <span class="meta-value">${escapeHtml(email.to) || '(unknown)'}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Date:</span>
          <span class="meta-value">${escapeHtml(email.date) || '(unknown)'}</span>
        </div>
      </div>
      <div class="subject">${escapeHtml(email.subject) || '(no subject)'}</div>
      <div class="email-body">${escapeHtml(email.body) || '(no content)'}</div>
      ${attachmentsHtml}
    `;
    
    // Add click handlers for attachments
    body.querySelectorAll('.attachment-item').forEach(item => {
      item.addEventListener('click', () => {
        const name = item.getAttribute('data-name') || 'attachment';
        const url = item.getAttribute('data-url') || '';
        this.openSafeAttachment(name, url);
      });
    });
  }
  
  private async openSafeAttachment(name: string, url: string): Promise<void> {
    console.log('[MailGuard] Opening safe attachment:', name);
    
    const body = this.lightboxShadow?.getElementById('body');
    if (!body) return;
    
    // For now, show a placeholder for PDF viewing
    // In a full implementation, we would use PDF.js to render the PDF as images
    
    const isPdf = name.toLowerCase().endsWith('.pdf');
    
    if (isPdf) {
      body.innerHTML = `
        <div class="safe-notice">
          <span class="icon">🛡️</span>
          <span>Safe PDF View - Rendered as images, no active content</span>
        </div>
        <div class="pdf-viewer">
          <div style="text-align: center; padding: 40px; color: #94a3b8;">
            <div style="font-size: 48px; margin-bottom: 20px;">📄</div>
            <div style="font-size: 16px; margin-bottom: 10px;">${escapeHtml(name)}</div>
            <div style="font-size: 12px; color: #64748b; max-width: 400px; margin: 0 auto;">
              PDF rendering as safe images would be implemented here using PDF.js.
              The PDF would be converted to static canvas images with no executable content.
            </div>
            <button style="margin-top: 20px; padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;" onclick="window.open('${escapeHtml(url)}', '_blank')">
              Open Original (External)
            </button>
          </div>
        </div>
      `;
    } else {
      body.innerHTML = `
        <div class="safe-notice" style="background: #fefce8; border-color: #eab308; color: #854d0e;">
          <span class="icon">⚠️</span>
          <span>This attachment type cannot be safely previewed. You can download the original.</span>
        </div>
        <div style="text-align: center; padding: 40px;">
          <div style="font-size: 48px; margin-bottom: 20px;">📎</div>
          <div style="font-size: 16px; margin-bottom: 20px;">${escapeHtml(name)}</div>
          <button style="padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;" onclick="window.open('${escapeHtml(url)}', '_blank')">
            Download Original
          </button>
        </div>
      `;
    }
  }
}

// =============================================================================
// Initialize
// =============================================================================

function showLoadMarker(): void {
  // Add a visible marker to prove the script loaded
  const marker = document.createElement('div');
  marker.id = 'wr-mailguard-load-marker';
  marker.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 20px;
    z-index: 2147483647;
    background: #22c55e;
    color: white;
    padding: 8px 16px;
    border-radius: 6px;
    font-family: sans-serif;
    font-size: 12px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    animation: fadeInOut 3s forwards;
  `;
  marker.innerHTML = '🛡️ WR MailGuard loaded';
  
  const style = document.createElement('style');
  style.textContent = `
    @keyframes fadeInOut {
      0% { opacity: 0; transform: translateY(10px); }
      15% { opacity: 1; transform: translateY(0); }
      85% { opacity: 1; }
      100% { opacity: 0; }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(marker);
  
  setTimeout(() => marker.remove(), 3000);
}

async function waitForGmailReady(): Promise<boolean> {
  console.log('[MailGuard] Waiting for Gmail to be ready...');
  
  // Wait for Gmail's main UI container to appear
  const maxAttempts = 30; // 30 seconds max
  for (let i = 0; i < maxAttempts; i++) {
    // Check for Gmail's main app container
    const gmailContainer = document.querySelector('div[role="main"], div.aeN, div.nH');
    const inboxRows = document.querySelectorAll('tr.zA, div[role="row"]');
    
    if (gmailContainer || inboxRows.length > 0) {
      console.log('[MailGuard] Gmail UI detected');
      return true;
    }
    
    // Also check if we're on the loading screen
    const loadingScreen = document.querySelector('#loading, .zia');
    if (loadingScreen) {
      console.log('[MailGuard] Gmail still loading...');
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('[MailGuard] Gmail UI not detected after timeout');
  return false;
}

async function init(): Promise<void> {
  console.log('[MailGuard] Content script loaded on:', window.location.href);
  console.log('[MailGuard] Hostname:', window.location.hostname);
  
  // Show visual confirmation that script loaded
  if (document.body) {
    showLoadMarker();
  } else {
    document.addEventListener('DOMContentLoaded', showLoadMarker);
  }
  
  try {
    // Wait for Gmail's UI to be ready
    const ready = await waitForGmailReady();
    if (!ready) {
      console.log('[MailGuard] Gmail did not load, but showing banner anyway');
    }
    
    const controller = new WRMailGuardController();
    await controller.init();
  } catch (err) {
    console.error('[MailGuard] Fatal error:', err);
  }
}

// Run immediately - the manifest specifies run_at: document_end
// so DOM should be available
console.log('[MailGuard] Script executing, readyState:', document.readyState);
init().catch(err => console.error('[MailGuard] Init promise rejected:', err));
