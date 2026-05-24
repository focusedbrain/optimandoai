/**
 * Distro probe — unit tests (P4.1)
 */

import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  parseOsRelease,
  classifyDistro,
  evaluateProbeVerdict,
  buildTargetProbe,
} from '../osRelease.js'
import { interpretProbeCommands, probeTarget } from '../probe.js'
import type { RunResult, SshCommandRunner } from '../types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = join(__dirname, 'fixtures', 'os-release')

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), 'utf8')
}

function baseProbeResults(overrides: Partial<Parameters<typeof interpretProbeCommands>[0]>) {
  return interpretProbeCommands({
    osReleaseContent: loadFixture('ubuntu-22.04'),
    podmanPathStdout: '/usr/bin/podman',
    packageManagerStdout: 'dpkg 1.21.22',
    idUStdout: '0',
    sudoCheckStdout: 'SUDO_EXIT:0\n',
    sudoCheckStderr: '',
    sudoCheckCode: 0,
    ...overrides,
  })
}

describe('parseOsRelease + classifyDistro — supported distros', () => {
  test.each([
    ['ubuntu-22.04', 'ubuntu', '22.04', 'debian'],
    ['debian-12', 'debian', '12', 'debian'],
    ['fedora-40', 'fedora', '40', 'fedora'],
    ['rhel-9', 'rhel', '9.4', 'rhel'],
    ['rocky-9', 'rocky', '9.3', 'rhel'],
    ['alma-9', 'alma', '9.4', 'rhel'],
  ] as const)('%s → family %s', (file, distro, version, family) => {
    const parsed = parseOsRelease(loadFixture(file))
    const classification = classifyDistro(parsed)
    expect(classification.distro).toBe(distro)
    expect(classification.version).toBe(version)
    expect(classification.family).toBe(family)
  })
})

describe('classifyDistro — unsupported distros', () => {
  test.each([
    ['alpine-3.19', 'unsupported_distro'],
    ['arch', 'unsupported_distro'],
    ['opensuse-leap', 'unsupported_distro'],
  ] as const)('%s → ok: false (%s)', (file, reason) => {
    const parsed = parseOsRelease(loadFixture(file))
    const classification = classifyDistro(parsed)
    expect(classification.family).toBe('unsupported')

    const details = buildTargetProbe(classification, {
      podman_installed: true,
      package_manager: 'rpm',
      is_root: true,
      has_passwordless_sudo: true,
    })
    const verdict = evaluateProbeVerdict(details, classification)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.reason).toBe(reason)
      expect(verdict.message).toMatch(/not supported at launch/i)
    }
  })
})

describe('interpretProbeCommands — sudo and podman', () => {
  test('missing podman does not fail verdict on supported distro', () => {
    const probe = baseProbeResults({
      podmanPathStdout: '',
      packageManagerStdout: 'rpm 4.18.0',
    })
    expect(probe.podman_installed).toBe(false)
    expect(probe.verdict.ok).toBe(true)
  })

  test('non-root without passwordless sudo → no_sudo', () => {
    const probe = baseProbeResults({
      idUStdout: '1000',
      sudoCheckCode: 1,
      sudoCheckStderr: 'sudo: a password is required',
    })
    expect(probe.is_root).toBe(false)
    expect(probe.has_passwordless_sudo).toBe(false)
    expect(probe.verdict.ok).toBe(false)
    if (!probe.verdict.ok) {
      expect(probe.verdict.reason).toBe('no_sudo')
    }
  })

  test('non-root with passwordless sudo → ok', () => {
    const probe = baseProbeResults({
      idUStdout: '1000',
      sudoCheckCode: 0,
    })
    expect(probe.has_passwordless_sudo).toBe(true)
    expect(probe.verdict.ok).toBe(true)
  })
})

describe('probeTarget — SSH runner integration (mocked)', () => {
  test('runs probe commands and returns TargetProbe', async () => {
    const responses: Record<string, RunResult> = {
      'cat /etc/os-release': {
        stdout: loadFixture('debian-12'),
        stderr: '',
        code: 0,
      },
      'command -v podman 2>/dev/null || true': {
        stdout: '',
        stderr: '',
        code: 0,
      },
      '(rpm --version 2>/dev/null | head -1) || (dpkg --version 2>/dev/null | head -1) || true': {
        stdout: 'Debian dpkg 1.21.22',
        stderr: '',
        code: 0,
      },
      'id -u': { stdout: '0\n', stderr: '', code: 0 },
      'sudo -n true 2>/dev/null; echo SUDO_EXIT:$?': {
        stdout: 'SUDO_EXIT:0\n',
        stderr: '',
        code: 0,
      },
    }

    const client: SshCommandRunner = {
      run: async (command: string) => {
        const hit = responses[command]
        if (!hit) throw new Error(`unexpected command: ${command}`)
        return hit
      },
    }

    const probe = await probeTarget(client)
    expect(probe.distro).toBe('debian')
    expect(probe.podman_installed).toBe(false)
    expect(probe.verdict.ok).toBe(true)
  })
})
