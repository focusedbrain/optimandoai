/**
 * EdgeIngestorSection — inbox placement UI tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { EdgeIngestorSection } from '../EdgeIngestorSection'
import {
  EDGE_INGESTOR_ACTION_BUTTON,
  EDGE_INGESTOR_EXPLAINER,
  EDGE_INGESTOR_NOT_CONFIGURED_BODY,
  EDGE_INGESTOR_NOT_CONFIGURED_TITLE,
  EDGE_INGESTOR_SECTION_TITLE,
} from '../edge-ingestor/edgeIngestorCopy'

describe('EdgeIngestorSection', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      edgeTier: {
        getStatus: vi.fn().mockResolvedValue({ edge_tier_enabled: false }),
      },
      dashboard: undefined,
    })
  })

  it('renders explainer and action button in inbox variant', () => {
    const html = renderToStaticMarkup(<EdgeIngestorSection variant="inbox" />)
    expect(html).toContain('data-testid="edge-ingestor-section"')
    expect(html).toContain(EDGE_INGESTOR_SECTION_TITLE)
    expect(html).toContain(EDGE_INGESTOR_EXPLAINER)
    expect(html).toContain(EDGE_INGESTOR_ACTION_BUTTON)
  })

  it('does not render setup dialog until opened', () => {
    const html = renderToStaticMarkup(<EdgeIngestorSection variant="bulk" />)
    expect(html).not.toContain(EDGE_INGESTOR_NOT_CONFIGURED_TITLE)
    expect(html).not.toContain(EDGE_INGESTOR_NOT_CONFIGURED_BODY)
  })
})
