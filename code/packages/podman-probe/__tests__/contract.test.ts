import { describe, expect, test } from 'vitest'

import {
  evaluatePodmanProbe,
  evaluateRemoteLinuxPodmanPreflightResult,
  platformRequiresPodmanMachine,
  PODMAN_PROBE_CONTRACT_STEPS,
} from '../src/contract.js'

describe('@repo/podman-probe contract', () => {
  test('contract steps are stable across surfaces', () => {
    expect(PODMAN_PROBE_CONTRACT_STEPS).toEqual([
      'binary_on_path',
      'engine_healthy',
      'machine_running_when_required',
      'ingestor_healthy_relay_only',
    ])
  })

  test('linux orchestrator: path + engine sufficient', () => {
    const r = evaluatePodmanProbe({
      surface: 'orchestrator_host',
      platform: 'linux',
      binaryOnPath: true,
      engineHealthy: true,
      machineState: 'not_applicable',
    })
    expect(r.ok).toBe(true)
  })

  test('win32: requires running machine', () => {
    expect(
      evaluatePodmanProbe({
        surface: 'orchestrator_host',
        platform: 'win32',
        binaryOnPath: true,
        engineHealthy: true,
        machineState: 'stopped',
      }).failureCode,
    ).toBe('machine_not_running')
  })

  test('relay: requires ingestor health when specified', () => {
    expect(
      evaluatePodmanProbe({
        surface: 'relay_host',
        platform: 'linux',
        binaryOnPath: true,
        engineHealthy: true,
        machineState: 'not_applicable',
        ingestorHealthy: false,
      }).failureCode,
    ).toBe('ingestor_unhealthy')
  })

  test('remote edge preflight maps shell exit codes', () => {
    expect(
      evaluateRemoteLinuxPodmanPreflightResult({ whichExitCode: 1, infoExitCode: null }).ok,
    ).toBe(false)
    expect(
      evaluateRemoteLinuxPodmanPreflightResult({ whichExitCode: 0, infoExitCode: 1 }).failureCode,
    ).toBe('engine_unhealthy')
    expect(
      evaluateRemoteLinuxPodmanPreflightResult({ whichExitCode: 0, infoExitCode: 0 }).ok,
    ).toBe(true)
  })

  test('platformRequiresPodmanMachine', () => {
    expect(platformRequiresPodmanMachine('win32')).toBe(true)
    expect(platformRequiresPodmanMachine('darwin')).toBe(true)
    expect(platformRequiresPodmanMachine('linux')).toBe(false)
  })
})
