/**
 * Pure helpers for AutoSort Session Review charts + received timestamp display.
 * Kept separate from the React component for focused unit tests.
 */

import type { SessionReviewMessageRow } from './inboxSessionReviewOpen'

export const TOP_SENDERS_MAX = 6
export const RECEIVED_DAY_BUCKETS = 5

export const SENDER_BAR_COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#3b82f6',
  '#0ea5e9',
  '#06b6d4',
  '#14b8a6',
  '#64748b',
]

export function truncateSenderLabel(s: string, max = 26): string {
  const t = s.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

export function aggregateTopSenders(rows: SessionReviewMessageRow[]): { name: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const m of rows) {
    const raw = ((m.from_name || '').trim() || (m.from_address || '').trim() || 'Unknown').trim()
    const label = truncateSenderLabel(raw, 28)
    counts.set(label, (counts.get(label) || 0) + 1)
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const top = sorted.slice(0, TOP_SENDERS_MAX)
  const restSum = sorted.slice(TOP_SENDERS_MAX).reduce((s, [, c]) => s + c, 0)
  const out = top.map(([name, count]) => ({ name, count }))
  if (restSum > 0) out.push({ name: 'Other', count: restSum })
  return out.sort((a, b) => a.count - b.count || a.name.localeCompare(b.name))
}

export function aggregateReceivedByDay(
  rows: SessionReviewMessageRow[],
): { name: string; count: number; fill: string }[] {
  const counts = new Map<string, number>()
  for (const m of rows) {
    const raw = m.received_at
    if (raw == null || String(raw).trim() === '') continue
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) continue
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  if (counts.size === 0) return []
  const sortedKeys = [...counts.keys()].sort((a, b) => b.localeCompare(a))
  const topKeys = sortedKeys.slice(0, RECEIVED_DAY_BUCKETS)
  const restKeys = sortedKeys.slice(RECEIVED_DAY_BUCKETS)
  let other = 0
  for (const k of restKeys) other += counts.get(k) ?? 0
  const out: { name: string; count: number; fill: string }[] = []
  topKeys.forEach((k, i) => {
    const [y, mo, day] = k.split('-').map(Number)
    const dd = new Date(y, mo - 1, day)
    const name = dd.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    out.push({ name, count: counts.get(k) ?? 0, fill: SENDER_BAR_COLORS[i % SENDER_BAR_COLORS.length] })
  })
  if (other > 0) {
    out.push({ name: 'Older days', count: other, fill: '#94a3b8' })
  }
  return out
}

export function aggregateReplyNeededForSessionReview(
  rows: SessionReviewMessageRow[],
): { name: string; value: number; color: string }[] {
  if (rows.length === 0) return []
  let need = 0
  let noNeed = 0
  for (const m of rows) {
    if ((m.needs_reply ?? 0) === 1) need += 1
    else noNeed += 1
  }
  const out: { name: string; value: number; color: string }[] = []
  if (need > 0) out.push({ name: 'Reply needed', value: need, color: '#0ea5e9' })
  if (noNeed > 0) out.push({ name: 'No reply', value: noNeed, color: '#cbd5e1' })
  return out
}

/** Safe label for session list rows; never throws. */
export function formatSessionReviewReceivedAtShort(raw: string | null | undefined): string {
  if (raw == null || String(raw).trim() === '') return '—'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
