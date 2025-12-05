/**
 * Email Sanitizer
 * 
 * Provides secure sanitization of email content.
 * All HTML is stripped or heavily restricted.
 * Tracking pixels, scripts, and dangerous content are removed.
 */

/**
 * Dangerous HTML tags to completely remove (including content)
 */
const REMOVE_TAGS = [
  'script', 'style', 'iframe', 'frame', 'frameset',
  'object', 'embed', 'applet', 'form', 'input',
  'button', 'select', 'textarea', 'meta', 'link',
  'base', 'head', 'noscript', 'template'
]

/**
 * Tags to strip but keep inner content
 * Note: These are handled by stripAllTags which removes all tags
 */
// const STRIP_TAGS = [
//   'html', 'body', 'div', 'span', 'section', 'article', ...
// ]

/**
 * Tracking pixel patterns to detect and remove
 */
const TRACKING_PATTERNS = [
  // Common tracking domains
  /track\./i,
  /pixel\./i,
  /beacon\./i,
  /analytics\./i,
  /mailchimp\.com/i,
  /sendgrid\.net/i,
  /mailgun\.org/i,
  /constantcontact\.com/i,
  /hubspot\.com/i,
  /salesforce\.com/i,
  /marketo\.com/i,
  /eloqua\.com/i,
  /pardot\.com/i,
  // Common tracking parameters
  /utm_/i,
  /mc_cid/i,
  /mc_eid/i,
  // 1x1 pixel indicators
  /width=["']?1["']?.*height=["']?1["']?/i,
  /height=["']?1["']?.*width=["']?1["']?/i,
  // Open tracking patterns
  /open\.gif/i,
  /pixel\.gif/i,
  /spacer\.gif/i,
  /blank\.gif/i,
  /track\.png/i
]

/**
 * HTML entities to decode
 */
const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&copy;': '\u00A9',
  '&reg;': '\u00AE',
  '&trade;': '\u2122',
  '&mdash;': '\u2014',
  '&ndash;': '\u2013',
  '&hellip;': '\u2026',
  '&lsquo;': '\u2018',
  '&rsquo;': '\u2019',
  '&ldquo;': '\u201C',
  '&rdquo;': '\u201D',
  '&bull;': '\u2022',
  '&middot;': '\u00B7',
  '&euro;': '\u20AC',
  '&pound;': '\u00A3',
  '&yen;': '\u00A5',
  '&cent;': '\u00A2'
}

/**
 * Decode HTML entities in text
 */
function decodeHtmlEntities(text: string): string {
  let result = text
  
  // Decode named entities
  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    result = result.replace(new RegExp(entity, 'gi'), char)
  }
  
  // Decode numeric entities (&#123; or &#x7B;)
  result = result.replace(/&#(\d+);/g, (_, code) => 
    String.fromCharCode(parseInt(code, 10))
  )
  result = result.replace(/&#x([0-9a-f]+);/gi, (_, code) => 
    String.fromCharCode(parseInt(code, 16))
  )
  
  return result
}

/**
 * Check if an element is likely a tracking pixel
 */
function isTrackingPixel(tag: string): boolean {
  return TRACKING_PATTERNS.some(pattern => pattern.test(tag))
}

/**
 * Remove dangerous tags and their content
 */
function removeDangerousTags(html: string): string {
  let result = html
  
  for (const tag of REMOVE_TAGS) {
    // Remove opening and closing tags with content
    const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi')
    result = result.replace(regex, '')
    
    // Remove self-closing tags
    const selfClosing = new RegExp(`<${tag}[^>]*\\/?>`, 'gi')
    result = result.replace(selfClosing, '')
  }
  
  return result
}

/**
 * Remove event handlers from HTML
 */
function removeEventHandlers(html: string): string {
  // Remove on* attributes (onclick, onload, onerror, etc.)
  return html.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '')
             .replace(/\s+on\w+\s*=\s*[^\s>]+/gi, '')
}

/**
 * Remove dangerous CSS
 */
function removeDangerousCss(html: string): string {
  // Remove javascript: URLs in CSS
  return html.replace(/javascript\s*:/gi, '')
             .replace(/expression\s*\(/gi, '')
             .replace(/behavior\s*:/gi, '')
             .replace(/-moz-binding\s*:/gi, '')
             .replace(/vbscript\s*:/gi, '')
}

/**
 * Remove tracking pixels and invisible images
 */
function removeTrackingPixels(html: string): string {
  // Find and remove img tags that look like tracking pixels
  return html.replace(/<img[^>]*>/gi, (match) => {
    if (isTrackingPixel(match)) {
      return ''
    }
    // Also remove if it's a tiny image (1x1, 0x0)
    if (/width\s*[:=]\s*["']?[01]px?["']?/i.test(match) ||
        /height\s*[:=]\s*["']?[01]px?["']?/i.test(match)) {
      return ''
    }
    return match
  })
}

/**
 * Extract link URLs and convert to text references
 */
function convertLinksToText(html: string): string {
  // Convert <a href="url">text</a> to "text [url]"
  return html.replace(/<a\s+[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, 
    (_, url, text) => {
      const cleanText = text.replace(/<[^>]*>/g, '').trim()
      const cleanUrl = url.trim()
      
      // Skip javascript: and data: URLs
      if (/^(javascript|data):/i.test(cleanUrl)) {
        return cleanText
      }
      
      // If text is the same as URL, just show once
      if (cleanText === cleanUrl) {
        return `[${cleanUrl}]`
      }
      
      return cleanText ? `${cleanText} [${cleanUrl}]` : `[${cleanUrl}]`
    }
  )
}

/**
 * Convert block-level elements to line breaks
 */
function convertBlocksToBreaks(html: string): string {
  // Add newlines after block elements
  const blockElements = ['p', 'div', 'br', 'hr', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote']
  
  let result = html
  for (const tag of blockElements) {
    // After closing tags
    result = result.replace(new RegExp(`</${tag}>`, 'gi'), '\n')
    // Self-closing br and hr
    if (tag === 'br' || tag === 'hr') {
      result = result.replace(new RegExp(`<${tag}[^>]*/?>`, 'gi'), '\n')
    }
  }
  
  // Add extra newline for paragraphs and headings
  result = result.replace(/<\/(p|h[1-6])>/gi, '\n\n')
  
  // Convert list items to bullet points
  result = result.replace(/<li[^>]*>/gi, '• ')
  
  return result
}

/**
 * Strip all remaining HTML tags
 */
function stripAllTags(html: string): string {
  return html.replace(/<[^>]*>/g, '')
}

/**
 * Clean up whitespace
 */
function cleanWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')           // Normalize line endings
    .replace(/\r/g, '\n')             // Normalize line endings
    .replace(/[ \t]+/g, ' ')          // Collapse horizontal whitespace
    .replace(/\n[ \t]+/g, '\n')       // Remove leading whitespace on lines
    .replace(/[ \t]+\n/g, '\n')       // Remove trailing whitespace on lines
    .replace(/\n{3,}/g, '\n\n')       // Max 2 consecutive newlines
    .trim()
}

/**
 * Sanitize HTML email to plain text
 * 
 * This is the main sanitization function.
 * It removes all dangerous content and converts HTML to readable plain text.
 * 
 * @param html - Raw HTML email content
 * @returns Sanitized plain text
 */
export function sanitizeHtmlToText(html: string): string {
  if (!html || typeof html !== 'string') {
    return ''
  }
  
  let result = html
  
  // Step 1: Remove dangerous tags and content
  result = removeDangerousTags(result)
  
  // Step 2: Remove event handlers
  result = removeEventHandlers(result)
  
  // Step 3: Remove dangerous CSS
  result = removeDangerousCss(result)
  
  // Step 4: Remove tracking pixels
  result = removeTrackingPixels(result)
  
  // Step 5: Convert links to text references
  result = convertLinksToText(result)
  
  // Step 6: Convert block elements to line breaks
  result = convertBlocksToBreaks(result)
  
  // Step 7: Strip all remaining HTML tags
  result = stripAllTags(result)
  
  // Step 8: Decode HTML entities
  result = decodeHtmlEntities(result)
  
  // Step 9: Clean up whitespace
  result = cleanWhitespace(result)
  
  return result
}

/**
 * Sanitize email subject
 * Removes any HTML and dangerous characters
 */
export function sanitizeSubject(subject: string): string {
  if (!subject || typeof subject !== 'string') {
    return ''
  }
  
  return stripAllTags(subject)
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .trim()
}

/**
 * Sanitize email address
 * Validates format and removes dangerous characters
 */
export function sanitizeEmailAddress(email: string): string {
  if (!email || typeof email !== 'string') {
    return ''
  }
  
  // Basic email format validation and sanitization
  const cleaned = email
    .replace(/<[^>]*>/g, '') // Remove any HTML
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .trim()
    .toLowerCase()
  
  // Very basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) {
    return ''
  }
  
  return cleaned
}

/**
 * Sanitize display name (sender/recipient name)
 */
export function sanitizeDisplayName(name: string): string {
  if (!name || typeof name !== 'string') {
    return ''
  }
  
  return stripAllTags(name)
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .replace(/["'<>]/g, '') // Remove quotes and angle brackets
    .trim()
}

/**
 * Generate a safe snippet from email body
 * 
 * @param text - Sanitized plain text body
 * @param maxLength - Maximum snippet length (default: 150)
 */
export function generateSnippet(text: string, maxLength: number = 150): string {
  if (!text || typeof text !== 'string') {
    return ''
  }
  
  // Collapse whitespace for snippet
  const collapsed = text.replace(/\s+/g, ' ').trim()
  
  if (collapsed.length <= maxLength) {
    return collapsed
  }
  
  // Cut at word boundary
  const truncated = collapsed.substring(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')
  
  if (lastSpace > maxLength * 0.7) {
    return truncated.substring(0, lastSpace) + '…'
  }
  
  return truncated + '…'
}

/**
 * Extract plain text from a potentially mixed content email
 * Prefers text/plain part if available
 */
export function extractPlainText(parts: Array<{ mimeType: string; content: string }>): string {
  // First try to find text/plain part
  const plainPart = parts.find(p => p.mimeType === 'text/plain')
  if (plainPart && plainPart.content) {
    return cleanWhitespace(plainPart.content)
  }
  
  // Fall back to sanitizing HTML part
  const htmlPart = parts.find(p => p.mimeType === 'text/html')
  if (htmlPart && htmlPart.content) {
    return sanitizeHtmlToText(htmlPart.content)
  }
  
  // Try any part as last resort
  for (const part of parts) {
    if (part.content) {
      if (part.mimeType.startsWith('text/')) {
        return sanitizeHtmlToText(part.content)
      }
    }
  }
  
  return ''
}

