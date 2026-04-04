import { WATCHDOG_EMOJI } from '../ui/components/WatchdogIcon'

/** Matches Electron `WatchdogThreat` / WR Chat watchdog payloads. */
export interface WatchdogThreat {
  severity: 'low' | 'medium' | 'high' | 'critical'
  category: string
  source: string
  summary: string
  advice: string
}

const MAX_MESSAGE_CHARS = 2000
const TRUNCATION_NOTE =
  '\n\nadditional threats detected — run manual scan for details'

const FOOTER =
  'Stay vigilant! If something looks suspicious, do not click links or enter credentials. When in doubt, close the tab and navigate to the site directly.'

function formatSeverityLabel(severity: WatchdogThreat['severity']): string {
  switch (severity) {
    case 'critical':
      return '🔴 CRITICAL'
    case 'high':
      return '🟠 HIGH'
    case 'medium':
      return '🟡 MEDIUM'
    case 'low':
      return '🔵 LOW'
    default:
      return String(severity)
  }
}

function formatThreatBlock(t: WatchdogThreat): string {
  const sev = formatSeverityLabel(t.severity)
  const cat = (t.category ?? '').trim() || 'other'
  const src = (t.source ?? '').trim() || '—'
  const sum = (t.summary ?? '').trim() || '—'
  const adv = (t.advice ?? '').trim() || '—'
  return `⚠️ ${sev} — ${cat}
Source: ${src}
${sum}
💡 Recommended action: ${adv}`
}

/**
 * Single assistant-ready string for WR Chat: header, threat blocks, footer.
 * Truncates to {@link MAX_MESSAGE_CHARS} with a manual-scan note if needed.
 */
export function formatWatchdogAlert(threats: WatchdogThreat[]): string {
  if (!threats || threats.length === 0) {
    return `${WATCHDOG_EMOJI} Watchdog scan complete — all clear!`
  }

  const header = `${WATCHDOG_EMOJI} WATCHDOG SECURITY ALERT`

  const blocks = threats.map((t) => formatThreatBlock(t))
  const body =
    threats.length === 1
      ? blocks[0]
      : blocks.join('\n\n---\n\n')

  let full = `${header}

${body}

${FOOTER}`

  if (full.length <= MAX_MESSAGE_CHARS) {
    return full
  }

  const budget = MAX_MESSAGE_CHARS - TRUNCATION_NOTE.length
  if (budget < 80) {
    return `${header}

${TRUNCATION_NOTE.trim()}`
  }

  let cut = full.slice(0, budget).trimEnd()
  // Prefer not to end mid-line on a lone dash
  const lastNl = cut.lastIndexOf('\n')
  if (lastNl > budget * 0.5) {
    cut = cut.slice(0, lastNl).trimEnd()
  }
  return cut + TRUNCATION_NOTE
}
