/**
 * HTML→text derivation for the depackaging GUEST (B2, ruling R1).
 *
 * This is a VERBATIM copy of the live `sanitizeHtmlToText` algorithm in
 * `electron/main/email/sanitizer.ts`. R1 requires the HTML-to-text derivation the
 * live path performs at `gateway.ts:2485` to move *inside the key-less guest* with
 * the *same algorithm* (or a pure equivalent with proven output-equivalence on a
 * corpus). The guest payload must be self-contained (it bundles into the golden
 * image with no reach into host `email/` code), so the algorithm is copied here
 * rather than imported. Drift is prevented by
 * `__tests__/htmlToText.equivalence.test.ts`, which asserts byte-identical output
 * against the live `sanitizeHtmlToText` across a fixture corpus.
 *
 * IMPORTANT: keep this byte-for-byte equivalent to `email/sanitizer.ts`. Any
 * change here that is not mirrored there (or vice versa) will fail the
 * equivalence corpus test — that is the guard, by design.
 *
 * The derived text is fed into `constructSafeText` (positive construction), which
 * additionally applies the SafeText discipline (NFC, control/format stripping,
 * length caps). For normal mail these are no-ops, so renderer output is unchanged.
 */

const REMOVE_TAGS = [
  'script', 'style', 'iframe', 'frame', 'frameset',
  'object', 'embed', 'applet', 'form', 'input',
  'button', 'select', 'textarea', 'meta', 'link',
  'base', 'head', 'noscript', 'template',
]

const TRACKING_PATTERNS = [
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
  /utm_/i,
  /mc_cid/i,
  /mc_eid/i,
  /width=["']?1["']?.*height=["']?1["']?/i,
  /height=["']?1["']?.*width=["']?1["']?/i,
  /open\.gif/i,
  /pixel\.gif/i,
  /spacer\.gif/i,
  /blank\.gif/i,
  /track\.png/i,
]

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
  '&cent;': '\u00A2',
}

function decodeHtmlEntities(text: string): string {
  let result = text
  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    result = result.replace(new RegExp(entity, 'gi'), char)
  }
  result = result.replace(/&#(\d+);/g, (_, code) =>
    String.fromCharCode(parseInt(code, 10)),
  )
  result = result.replace(/&#x([0-9a-f]+);/gi, (_, code) =>
    String.fromCharCode(parseInt(code, 16)),
  )
  return result
}

function isTrackingPixel(tag: string): boolean {
  return TRACKING_PATTERNS.some((pattern) => pattern.test(tag))
}

function removeDangerousTags(html: string): string {
  let result = html
  for (const tag of REMOVE_TAGS) {
    const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi')
    result = result.replace(regex, '')
    const selfClosing = new RegExp(`<${tag}[^>]*\\/?>`, 'gi')
    result = result.replace(selfClosing, '')
  }
  return result
}

function removeEventHandlers(html: string): string {
  return html.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\s+on\w+\s*=\s*[^\s>]+/gi, '')
}

function removeDangerousCss(html: string): string {
  return html.replace(/javascript\s*:/gi, '')
    .replace(/expression\s*\(/gi, '')
    .replace(/behavior\s*:/gi, '')
    .replace(/-moz-binding\s*:/gi, '')
    .replace(/vbscript\s*:/gi, '')
}

function removeTrackingPixels(html: string): string {
  return html.replace(/<img[^>]*>/gi, (match) => {
    if (isTrackingPixel(match)) {
      return ''
    }
    if (/width\s*[:=]\s*["']?[01]px?["']?/i.test(match) ||
        /height\s*[:=]\s*["']?[01]px?["']?/i.test(match)) {
      return ''
    }
    return match
  })
}

const SKIP_LINK_PATTERNS = [
  /\.(png|jpg|jpeg|gif|svg|ico|webp|bmp)(\?|$)/i,
  /logo/i,
  /icon/i,
  /banner/i,
  /header/i,
  /footer/i,
  /spacer/i,
  /pixel/i,
  /facebook.*icon/i,
  /twitter.*icon/i,
  /linkedin.*icon/i,
  /instagram.*icon/i,
  /unsubscribe/i,
  /view.*browser/i,
  /email.*preferences/i,
  /cdn\./i,
  /static\./i,
  /assets\./i,
]

function shouldSkipLink(url: string, text: string): boolean {
  const combined = `${url} ${text}`.toLowerCase()
  return SKIP_LINK_PATTERNS.some((pattern) => pattern.test(combined))
}

function convertLinksToText(html: string): string {
  return html.replace(/<a\s+[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, url, text) => {
      const cleanText = text.replace(/<[^>]*>/g, '').trim()
      const cleanUrl = url.trim()
      if (/^(javascript|data):/i.test(cleanUrl)) {
        return cleanText
      }
      if (shouldSkipLink(cleanUrl, cleanText)) {
        return cleanText
      }
      if (!cleanUrl || cleanUrl === '#') {
        return cleanText
      }
      if (!cleanText) {
        return ''
      }
      return `${cleanText} {{LINK_BUTTON:${cleanUrl}}}`
    },
  )
}

function convertBlocksToBreaks(html: string): string {
  const blockElements = ['p', 'div', 'br', 'hr', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote']
  let result = html
  for (const tag of blockElements) {
    result = result.replace(new RegExp(`</${tag}>`, 'gi'), '\n')
    if (tag === 'br' || tag === 'hr') {
      result = result.replace(new RegExp(`<${tag}[^>]*/?>`, 'gi'), '\n')
    }
  }
  result = result.replace(/<\/(p|h[1-6])>/gi, '\n\n')
  result = result.replace(/<li[^>]*>/gi, '• ')
  return result
}

function stripAllTags(html: string): string {
  return html.replace(/<[^>]*>/g, '')
}

function cleanWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Derive plain text from HTML, identical to the live `sanitizeHtmlToText`.
 * Runs inside the key-less guest (R1). Output is fed to `constructSafeText`.
 */
export function htmlToSafeText(html: string): string {
  if (!html || typeof html !== 'string') {
    return ''
  }
  let result = html
  result = removeDangerousTags(result)
  result = removeEventHandlers(result)
  result = removeDangerousCss(result)
  result = removeTrackingPixels(result)
  result = convertLinksToText(result)
  result = convertBlocksToBreaks(result)
  result = stripAllTags(result)
  result = decodeHtmlEntities(result)
  result = cleanWhitespace(result)
  return result
}
