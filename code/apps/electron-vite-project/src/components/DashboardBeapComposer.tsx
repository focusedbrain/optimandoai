/**
 * Full-width automation-dashboard BEAP composer — wraps {@link BeapInlineComposer} with dashboard chrome.
 *
 * AI draft refinement for public / encrypted fields is handled inside {@link BeapInlineComposer}
 * (`handleAiRefineToggle` + `useDraftRefineStore`), same targets as inbox (`capsule-public` /
 * `capsule-encrypted`). {@link HybridSearch} reads the same store for Use / accept.
 */

import { BeapInlineComposer } from './BeapInlineComposer'
import './AnalysisCanvas.css'

export interface DashboardBeapComposerProps {
  onClose: () => void
}

export function DashboardBeapComposer({ onClose }: DashboardBeapComposerProps) {
  return (
    <div className="dashboard-beap-composer">
      <BeapInlineComposer embedInDashboard onClose={onClose} onSent={() => {}} />
    </div>
  )
}

export default DashboardBeapComposer
