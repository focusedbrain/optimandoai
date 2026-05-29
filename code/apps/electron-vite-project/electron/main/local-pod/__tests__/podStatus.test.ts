/**
 * Podman probe pending state — no false-ready before startup probe completes.
 */

import { describe, test, expect, beforeEach } from 'vitest'

import { PodmanSetupError } from '../podmanDetect.js'
import {
  getPodSetupErrorRef,
  isPodmanVerifiedReady,
  isPodmanProbeComplete,
  markPodmanProbeComplete,
  setPodSetupErrorRef,
  _resetPodStatusForTest,
} from '../podStatus.js'

describe('podStatus probe completion', () => {
  beforeEach(() => {
    _resetPodStatusForTest()
  })

  test('starts pending — blocks verified ready until probe completes', () => {
    expect(isPodmanProbeComplete()).toBe(false)
    expect(isPodmanVerifiedReady()).toBe(false)
    expect(getPodSetupErrorRef()?.code).toBe('probe_pending')
  })

  test('complete + null error means verified ready', () => {
    markPodmanProbeComplete()
    setPodSetupErrorRef(null)
    expect(isPodmanVerifiedReady()).toBe(true)
    expect(getPodSetupErrorRef()).toBeNull()
  })

  test('complete + setup error blocks verified ready', () => {
    markPodmanProbeComplete()
    setPodSetupErrorRef(new PodmanSetupError('not_installed', 'missing'))
    expect(isPodmanVerifiedReady()).toBe(false)
  })
})
