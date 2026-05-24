export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function formatCertsPerMinute(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '0'
  if (rate < 0.1) return '<0.1'
  return rate.toFixed(1)
}

export function healthLabel(health: string): string {
  switch (health) {
    case 'healthy':
      return 'Healthy'
    case 'unhealthy':
      return 'Unhealthy'
    default:
      return 'Unknown'
  }
}

export function healthColor(health: string): string {
  switch (health) {
    case 'healthy':
      return '#22c55e'
    case 'unhealthy':
      return '#ef4444'
    default:
      return '#94a3b8'
  }
}

export function resultColor(result: string): string {
  return result === 'verified' ? '#22c55e' : '#ef4444'
}
