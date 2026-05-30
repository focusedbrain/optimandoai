import { describe, test, expect } from 'vitest'

import {
  DEFAULT_BEAP_IMAGE,
  beapImageBuildTags,
  beapImageRefCandidates,
  canonicalBeapImageRef,
  localhostBeapImageAlias,
} from '../beapImageRef.js'

describe('beapImageRef', () => {
  test('bare ref includes localhost alias', () => {
    expect(beapImageRefCandidates('beap-components:dev')).toEqual([
      'beap-components:dev',
      'localhost/beap-components:dev',
    ])
  })

  test('localhost ref includes bare alias', () => {
    expect(beapImageRefCandidates('localhost/beap-components:dev')).toEqual([
      'localhost/beap-components:dev',
      'beap-components:dev',
    ])
  })

  test('canonical strips localhost prefix', () => {
    expect(canonicalBeapImageRef('localhost/beap-components:dev')).toBe(DEFAULT_BEAP_IMAGE)
    expect(canonicalBeapImageRef(DEFAULT_BEAP_IMAGE)).toBe(DEFAULT_BEAP_IMAGE)
  })

  test('build tags include both names', () => {
    expect(beapImageBuildTags(DEFAULT_BEAP_IMAGE)).toEqual([
      'beap-components:dev',
      'localhost/beap-components:dev',
    ])
  })

  test('localhost alias helper', () => {
    expect(localhostBeapImageAlias(DEFAULT_BEAP_IMAGE)).toBe('localhost/beap-components:dev')
  })
})
