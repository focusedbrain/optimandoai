/**
 * Explainer copy snapshot tests — tone-drift guard (P4.5.1).
 */

import { describe, it, expect } from 'vitest'

import {
  EXPLAINER_HEADLINE,
  EXPLAINER_OVERVIEW,
  THREE_THREATS,
  WHAT_IT_DOES_NOT_PROTECT_AGAINST,
  EMAIL_ON_EDGE_SECTION,
} from '../explainerCopy.js'

describe('explainer copy snapshots', () => {
  it('EXPLAINER_HEADLINE matches snapshot', () => {
    expect(EXPLAINER_HEADLINE).toMatchSnapshot()
  })

  it('EXPLAINER_OVERVIEW matches snapshot', () => {
    expect(EXPLAINER_OVERVIEW).toMatchSnapshot()
  })

  it('THREE_THREATS matches snapshot', () => {
    expect(THREE_THREATS).toMatchSnapshot()
  })

  it('WHAT_IT_DOES_NOT_PROTECT_AGAINST matches snapshot', () => {
    expect(WHAT_IT_DOES_NOT_PROTECT_AGAINST).toMatchSnapshot()
  })

  it('EMAIL_ON_EDGE_SECTION matches snapshot', () => {
    expect(EMAIL_ON_EDGE_SECTION).toMatchSnapshot()
  })
})

describe('explainer copy structure', () => {
  it('overview has three paragraphs', () => {
    expect(EXPLAINER_OVERVIEW.paragraphs).toHaveLength(3)
  })

  it('lists three threats with required fields', () => {
    expect(THREE_THREATS).toHaveLength(3)
    for (const threat of THREE_THREATS) {
      expect(threat.name.length).toBeGreaterThan(0)
      expect(threat.description.length).toBeGreaterThan(0)
      expect(threat.defense.length).toBeGreaterThan(0)
    }
  })

  it('email section has two paragraphs', () => {
    expect(EMAIL_ON_EDGE_SECTION.paragraphs).toHaveLength(2)
  })
})
