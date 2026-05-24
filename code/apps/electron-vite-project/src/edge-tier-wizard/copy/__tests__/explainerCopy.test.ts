/**
 * Explainer copy snapshot tests — tone-drift guard (P4.5.1).
 */

import { describe, it, expect } from 'vitest'

import { EXPLAINER_HEADLINE, EXPLAINER_OVERVIEW } from '../explainerCopy.js'

describe('explainer copy snapshots', () => {
  it('EXPLAINER_HEADLINE matches snapshot', () => {
    expect(EXPLAINER_HEADLINE).toMatchSnapshot()
  })

  it('EXPLAINER_OVERVIEW matches snapshot', () => {
    expect(EXPLAINER_OVERVIEW).toMatchSnapshot()
  })
})

describe('explainer copy structure', () => {
  it('overview has nine paragraphs', () => {
    expect(EXPLAINER_OVERVIEW.paragraphs).toHaveLength(9)
  })

  it('each overview paragraph is non-empty prose', () => {
    for (const paragraph of EXPLAINER_OVERVIEW.paragraphs) {
      expect(paragraph.trim().length).toBeGreaterThan(40)
    }
  })
})
