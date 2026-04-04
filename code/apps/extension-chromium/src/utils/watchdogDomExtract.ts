/**
 * Watchdog — collect `document.body.innerText` from open tabs via `scripting.executeScript`.
 * Sanitizes and caps size for privacy and LLM context limits.
 */

export interface DomSnapshot {
  tabId: number
  url: string
  title: string
  textContent: string
}

/** Hard cap on total DOM text across all tabs (after sanitization). */
const DEFAULT_MAX_TOTAL_DOM_CHARS = 100_000

function isExcludedUrl(url: string): boolean {
  const u = (url || '').trim()
  if (!u) return true
  const lower = u.toLowerCase()
  if (lower.startsWith('chrome://')) return true
  if (lower.startsWith('chrome-extension://')) return true
  if (lower.startsWith('about:')) return true
  if (lower.startsWith('devtools://')) return true
  if (lower.startsWith('edge://')) return true
  if (lower.startsWith('brave://')) return true
  if (lower.startsWith('vivaldi://')) return true
  if (lower.startsWith('moz-extension://')) return true
  if (lower.startsWith('opera://')) return true
  return false
}

/**
 * Prefer the focused window, then most recently accessed tabs when available.
 */
async function sortTabsForWatchdog(tabs: chrome.tabs.Tab[]): Promise<chrome.tabs.Tab[]> {
  let focusedWinId: number | undefined
  try {
    const w = await chrome.windows.getLastFocused()
    focusedWinId = w?.id
  } catch {
    focusedWinId = undefined
  }

  const copy = [...tabs]
  copy.sort((a, b) => {
    const af = focusedWinId != null && a.windowId === focusedWinId ? 1 : 0
    const bf = focusedWinId != null && b.windowId === focusedWinId ? 1 : 0
    if (bf !== af) return bf - af
    const la = (a as chrome.tabs.Tab & { lastAccessed?: number }).lastAccessed ?? 0
    const lb = (b as chrome.tabs.Tab & { lastAccessed?: number }).lastAccessed ?? 0
    return lb - la
  })
  return copy
}

/** Strip embedded base64 data URIs (can be huge; not useful for threat analysis). */
function stripDataUris(s: string): string {
  return s.replace(/data:[^,\s]+;base64,[A-Za-z0-9+/=\s]+/gi, '[data-uri removed]')
}

/** Defensive removal of script/style-like segments if they appear in plain text. */
function stripScriptStyleBlocks(s: string): string {
  let t = s
  t = t.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  t = t.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  return t
}

/** Collapse excessive whitespace (multiple spaces/newlines → single space). */
function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

export function sanitizeDomText(raw: string): string {
  let t = stripDataUris(raw)
  t = stripScriptStyleBlocks(t)
  t = collapseWhitespace(t)
  return t
}

/**
 * If total length exceeds `maxTotal`, trim each tab evenly so sum ≤ maxTotal.
 */
function distributeTotalBudget(snapshots: DomSnapshot[], maxTotal: number): void {
  if (snapshots.length === 0 || maxTotal <= 0) return
  let total = 0
  for (const s of snapshots) {
    total += s.textContent.length
  }
  if (total <= maxTotal) return
  const per = Math.max(0, Math.floor(maxTotal / snapshots.length))
  for (const s of snapshots) {
    if (s.textContent.length > per) {
      s.textContent = s.textContent.slice(0, per)
    }
  }
}

export async function extractAllTabsDom(
  maxTabs: number = 20,
  maxCharsPerTab: number = 8000,
  maxTotalDomChars: number = DEFAULT_MAX_TOTAL_DOM_CHARS,
): Promise<DomSnapshot[]> {
  const maxT = Math.max(1, Math.floor(maxTabs))
  const maxC = Math.max(0, Math.floor(maxCharsPerTab))
  const maxTotal = Math.max(0, Math.floor(maxTotalDomChars))

  const all = await chrome.tabs.query({})
  const filtered = all.filter((t) => {
    if (t.id == null) return false
    const u = t.url || t.pendingUrl || ''
    return !isExcludedUrl(u)
  })

  const sorted = await sortTabsForWatchdog(filtered)
  const slice = sorted.slice(0, maxT)

  const out: DomSnapshot[] = []
  for (const tab of slice) {
    if (tab.id == null) continue
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (innerMaxChars: number) => {
          const raw = document.body?.innerText || ''
          const cap = innerMaxChars > 0 ? Math.min(500_000, innerMaxChars * 4) : 500_000
          return raw.length > cap ? raw.substring(0, cap) : raw
        },
        args: [maxC],
      })
      const rawText = results?.[0]?.result
      if (typeof rawText !== 'string') continue
      let text = sanitizeDomText(rawText)
      if (maxC > 0 && text.length > maxC) {
        text = text.slice(0, maxC)
      }
      out.push({
        tabId: tab.id,
        url: tab.url || tab.pendingUrl || '',
        title: tab.title || '',
        textContent: text,
      })
    } catch {
      /* PDF viewers, restricted pages, unloaded tabs — skip */
    }
  }

  if (maxTotal > 0) {
    distributeTotalBudget(out, maxTotal)
  }

  return out
}
