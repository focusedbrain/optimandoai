/**
 * Step 0 — Off-band validation explainer with tier-aware CTA (P4.5.2).
 */

import type { CSSProperties } from 'react'

import {
  EMAIL_ON_EDGE_SECTION,
  EXPLAINER_HEADLINE,
  EXPLAINER_OVERVIEW,
  THREE_THREATS,
  WHAT_IT_DOES_NOT_PROTECT_AGAINST,
  type ExplainerSection,
} from '../copy/explainerCopy.js'
import { WIZARD_UPGRADE_URL } from '../copy.js'
import { btnPrimary } from '../styles.js'
import { TierBadgeWithRefresh } from '../../components/TierBadgeWithRefresh.js'
import { isEnterpriseExplainerTier, isWizardPaidTier } from '../wizardTier.js'

export interface StepExplainerProps {
  tier: string
  waitingForUpgrade?: boolean
  onContinue: () => void
  onUpgrade: () => void
  onRefreshTier: () => Promise<{ tier: string }>
}

const explainerScrollStyle: CSSProperties = {
  maxHeight: 'min(48vh, 420px)',
  overflowY: 'auto',
  marginBottom: 16,
  paddingRight: 4,
}

const sectionStyle: CSSProperties = {
  marginBottom: 16,
}

function ExplainerSectionBlock({ section }: { section: ExplainerSection }) {
  return (
    <section style={sectionStyle}>
      {section.title ? <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>{section.title}</h3> : null}
      {section.paragraphs.map((p) => (
        <p key={p.slice(0, 48)} style={{ margin: '0 0 10px', color: '#cbd5e1' }}>
          {p}
        </p>
      ))}
      {section.bullets && section.bullets.length > 0 ? (
        <ul style={{ margin: '0 0 10px', paddingLeft: 20, color: '#cbd5e1' }}>
          {section.bullets.map((b) => (
            <li key={b.slice(0, 48)} style={{ marginBottom: 6 }}>
              {b}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

export function StepExplainer({
  tier,
  waitingForUpgrade = false,
  onContinue,
  onUpgrade,
  onRefreshTier,
}: StepExplainerProps) {
  const paid = isWizardPaidTier(tier)
  const showEnterpriseNote = isEnterpriseExplainerTier(tier)

  return (
    <article data-testid="wizard-step-explainer">
      {showEnterpriseNote ? (
        <aside
          data-testid="wizard-explainer-enterprise-note"
          style={{
            marginBottom: 12,
            padding: 10,
            borderRadius: 6,
            background: 'rgba(79,70,229,0.12)',
            border: '1px solid rgba(99,102,241,0.35)',
            color: '#c7d2fe',
            fontSize: 12,
          }}
        >
          You are on the Business/Enterprise plan. The off-band validation pod is included in your plan.
        </aside>
      ) : null}

      <header style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>{EXPLAINER_HEADLINE.title}</h2>
      </header>

      <div
        style={explainerScrollStyle}
        role="region"
        aria-label="Off-band validation explainer"
        data-testid="wizard-explainer-scroll"
      >
        <ExplainerSectionBlock section={EXPLAINER_OVERVIEW} />

        <section style={sectionStyle} aria-labelledby="wizard-explainer-threats-heading">
          <h3 id="wizard-explainer-threats-heading" style={{ margin: '0 0 8px', fontSize: 14 }}>
            Threats addressed
          </h3>
          <ul style={{ margin: 0, paddingLeft: 20, color: '#cbd5e1' }}>
            {THREE_THREATS.map((threat) => (
              <li key={threat.name} style={{ marginBottom: 12 }}>
                <strong>{threat.name}</strong>
                <p style={{ margin: '4px 0', color: '#94a3b8' }}>{threat.description}</p>
                <p style={{ margin: '4px 0 0', color: '#cbd5e1' }}>{threat.defense}</p>
              </li>
            ))}
          </ul>
        </section>

        <ExplainerSectionBlock section={WHAT_IT_DOES_NOT_PROTECT_AGAINST} />
        <ExplainerSectionBlock section={EMAIL_ON_EDGE_SECTION} />
      </div>

      <footer data-testid="wizard-explainer-cta">
        {paid ? (
          <button type="button" style={btnPrimary} data-testid="wizard-explainer-continue" onClick={onContinue}>
            Continue to deployment
          </button>
        ) : (
          <>
            <button type="button" style={btnPrimary} data-testid="wizard-explainer-upgrade" onClick={onUpgrade}>
              Upgrade Now
            </button>
            <TierBadgeWithRefresh
              initialTier={tier}
              displayHint="upgrade-prompt"
              onRefresh={onRefreshTier}
            />
            <p
              data-testid="wizard-explainer-upgrade-hint"
              style={{ margin: '10px 0 0', fontSize: 12, color: '#94a3b8' }}
            >
              Already upgraded? Click the refresh icon to re-check your plan.
            </p>
            {waitingForUpgrade ? (
              <p data-testid="wizard-explainer-waiting" style={{ margin: '8px 0 0', fontSize: 12, color: '#a5b4fc' }}>
                Complete checkout in your browser, then refresh your plan above.
              </p>
            ) : null}
            <a href={WIZARD_UPGRADE_URL} style={{ display: 'none' }} aria-hidden="true">
              {WIZARD_UPGRADE_URL}
            </a>
          </>
        )}
      </footer>
    </article>
  )
}
