/**
 * Step 8 — Post-deployment email-on-edge handoff (P4.5.9).
 */

import {
  FINALE_LATER_LABEL,
  FINALE_MIGRATION_BODY,
  FINALE_MIGRATION_SECTION_TITLE,
  FINALE_OPEN_EMAIL_ACCOUNTS_LABEL,
  FINALE_SUMMARY,
  FINALE_TITLE,
} from '../copy/finaleCopy.js'
import { btnPrimary, btnSecondary, helpBox } from '../styles.js'

export interface StepFinaleProps {
  totalReplicas: number
  onOpenEmailAccounts: () => void
  onLater: () => void
}

export function StepFinale({ totalReplicas, onOpenEmailAccounts, onLater }: StepFinaleProps) {
  const replicaNote =
    totalReplicas === 1
      ? 'One edge replica is active.'
      : `${totalReplicas} edge replicas are active.`

  return (
    <article data-testid="wizard-step-finale">
      <header style={{ marginBottom: 12 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>{FINALE_TITLE}</h2>
        <p style={{ margin: 0, color: '#94a3b8' }}>{FINALE_SUMMARY}</p>
        <p style={{ margin: '8px 0 0', color: '#cbd5e1', fontSize: 12 }}>{replicaNote}</p>
      </header>

      <section style={helpBox} aria-labelledby="wizard-finale-migration-heading">
        <h3 id="wizard-finale-migration-heading" style={{ margin: '0 0 8px', fontSize: 14, color: '#e2e8f0' }}>
          {FINALE_MIGRATION_SECTION_TITLE}
        </h3>
        <p style={{ margin: 0, color: '#cbd5e1' }}>{FINALE_MIGRATION_BODY}</p>
      </section>

      <footer style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button
          type="button"
          style={btnPrimary}
          data-testid="wizard-finale-open-email-accounts"
          onClick={onOpenEmailAccounts}
        >
          {FINALE_OPEN_EMAIL_ACCOUNTS_LABEL}
        </button>
        <button type="button" style={btnSecondary} data-testid="wizard-finale-later" onClick={onLater}>
          {FINALE_LATER_LABEL}
        </button>
      </footer>
    </article>
  )
}
