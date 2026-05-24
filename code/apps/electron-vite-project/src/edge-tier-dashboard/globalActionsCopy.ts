import type { DashboardFallbackPolicy } from './types.js'

export const FALLBACK_POLICY_COPY: Record<
  DashboardFallbackPolicy,
  { label: string; description: string }
> = {
  reject: {
    label: 'Reject when edge is unreachable',
    description:
      'When all edge replicas are unreachable, messages are quarantined and you are alerted. This is the safest choice for high-assurance use.',
  },
  downgrade_with_badge: {
    label: 'Downgrade with badge',
    description:
      'When all edge replicas are unreachable, messages are processed locally only and tagged with a badge in the inbox. Choose this only if you understand that local-only processing gives you weaker guarantees than the edge tier provides.',
  },
}
