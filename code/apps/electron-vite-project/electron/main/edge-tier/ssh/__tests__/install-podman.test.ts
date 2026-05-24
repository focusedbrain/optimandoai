/**
 * Remote Podman installer — unit tests (P4.2)
 */

import { describe, test, expect } from 'vitest'

import {
  buildPodmanInstallCommand,
  collectInstallPodmanEvents,
  installPodman,
  parsePodmanMajorVersion,
  wrapWithSudo,
} from '../install-podman.js'
import type { RunResult, SshCommandRunner, TargetProbe } from '../types.js'

function makeProbe(overrides: Partial<TargetProbe> = {}): TargetProbe {
  return {
    distro: 'ubuntu',
    version: '22.04',
    family: 'debian',
    podman_installed: false,
    package_manager: 'dpkg',
    is_root: false,
    has_passwordless_sudo: true,
    verdict: { ok: true },
    ...overrides,
  }
}

function makeMockClient(
  handler: (command: string) => RunResult | Promise<RunResult>,
): SshCommandRunner {
  return {
    run: async (command: string) => {
      const result = await handler(command)
      return result
    },
  }
}

describe('parsePodmanMajorVersion', () => {
  test('parses podman version output', () => {
    expect(parsePodmanMajorVersion('podman version 4.9.3')).toBe(4)
    expect(parsePodmanMajorVersion('podman version 3.4.2')).toBe(3)
  })
})

describe('buildPodmanInstallCommand', () => {
  test('debian/ubuntu uses apt-get', () => {
    const cmd = buildPodmanInstallCommand(makeProbe({ family: 'debian', distro: 'ubuntu' }))
    expect(cmd).toContain('apt-get update')
    expect(cmd).toContain('apt-get install -y podman')
    expect(cmd).not.toMatch(/curl|wget|\.sh\b/)
  })

  test('fedora uses dnf only', () => {
    const cmd = buildPodmanInstallCommand(
      makeProbe({ family: 'fedora', distro: 'fedora', is_root: true }),
    )
    expect(cmd).toBe('dnf install -y podman')
  })

  test('rhel family prefers dnf with yum fallback', () => {
    const cmd = buildPodmanInstallCommand(makeProbe({ family: 'rhel', distro: 'rocky' }))
    expect(cmd).toContain('dnf install -y podman')
    expect(cmd).toContain('yum install -y podman')
  })

  test('wraps with sudo when not root', () => {
    const cmd = wrapWithSudo(makeProbe({ is_root: false }), 'dnf install -y podman')
    expect(cmd).toMatch(/^sudo -n sh -c '/)
  })

  test('does not wrap when root', () => {
    const cmd = buildPodmanInstallCommand(makeProbe({ is_root: true, family: 'fedora' }))
    expect(cmd).not.toContain('sudo')
  })
})

describe('installPodman — idempotency', () => {
  test('emits done without install when podman 4.x already present', async () => {
    const commands: string[] = []
    const client = makeMockClient((command) => {
      commands.push(command)
      if (command.includes('podman --version')) {
        return { stdout: 'podman version 4.9.0\n', stderr: '', code: 0 }
      }
      return { stdout: '', stderr: 'unexpected', code: 1 }
    })

    const events = await collectInstallPodmanEvents(client, makeProbe({ podman_installed: true }))
    expect(events.some((e) => e.kind === 'done')).toBe(true)
    expect(events.some((e) => e.kind === 'error')).toBe(false)
    expect(commands.some((c) => c.includes('apt-get install'))).toBe(false)
    expect(commands.some((c) => c.includes('dnf install'))).toBe(false)
  })
})

describe('installPodman — per-distro install commands', () => {
  test('debian runs apt-get install with sudo', async () => {
    const commands: string[] = []
    let versionCalls = 0
    const client = makeMockClient((command) => {
      commands.push(command)
      if (command.includes('podman --version')) {
        versionCalls++
        return versionCalls >= 2
          ? { stdout: 'podman version 4.2.0\n', stderr: '', code: 0 }
          : { stdout: '', stderr: '', code: 0 }
      }
      if (command.includes('apt-get')) {
        return { stdout: 'installed\n', stderr: '', code: 0 }
      }
      if (command.includes('systemctl')) {
        return { stdout: '', stderr: 'failed', code: 1 }
      }
      return { stdout: '', stderr: '', code: 0 }
    })

    const events = await collectInstallPodmanEvents(
      client,
      makeProbe({ family: 'debian', distro: 'debian' }),
    )

    expect(commands.some((c) => c.includes('sudo -n') && c.includes('apt-get install -y podman'))).toBe(
      true,
    )
    expect(events.at(-1)?.kind).toBe('done')
  })

  test('fedora runs dnf install', async () => {
    const commands: string[] = []
    const client = makeMockClient((command) => {
      commands.push(command)
      if (command.includes('podman --version')) {
        return command.includes('after-install')
          ? { stdout: 'podman version 4.5.0\n', stderr: '', code: 0 }
          : { stdout: '', stderr: '', code: 0 }
      }
      if (command.includes('dnf install')) {
        return { stdout: 'ok', stderr: '', code: 0 }
      }
      if (command.includes('systemctl')) {
        return { stdout: '', stderr: '', code: 0 }
      }
      return { stdout: '', stderr: '', code: 0 }
    })

    // Second version check returns 4.x after install — simulate with call count
    let versionCalls = 0
    const countingClient = makeMockClient((command) => {
      commands.push(command)
      if (command.includes('podman --version')) {
        versionCalls++
        return versionCalls >= 2
          ? { stdout: 'podman version 4.5.0\n', stderr: '', code: 0 }
          : { stdout: '', stderr: '', code: 0 }
      }
      if (command.includes('dnf install')) {
        return { stdout: 'ok', stderr: '', code: 0 }
      }
      if (command.includes('systemctl')) {
        return { stdout: '', stderr: '', code: 0 }
      }
      return { stdout: '', stderr: '', code: 0 }
    })

    const events = await collectInstallPodmanEvents(
      countingClient,
      makeProbe({ family: 'fedora', distro: 'fedora', is_root: true }),
    )

    expect(commands.some((c) => c.includes('dnf install -y podman'))).toBe(true)
    expect(events.at(-1)?.kind).toBe('done')
  })

  test('rhel family runs dnf/yum branch script', async () => {
    const commands: string[] = []
    let versionCalls = 0
    const client = makeMockClient((command) => {
      commands.push(command)
      if (command.includes('podman --version')) {
        versionCalls++
        return versionCalls >= 2
          ? { stdout: 'podman version 4.3.1\n', stderr: '', code: 0 }
          : { stdout: '', stderr: '', code: 0 }
      }
      if (command.includes('dnf install') || command.includes('yum install')) {
        return { stdout: 'ok', stderr: '', code: 0 }
      }
      if (command.includes('systemctl')) {
        return { stdout: '', stderr: '', code: 0 }
      }
      return { stdout: '', stderr: '', code: 0 }
    })

    await collectInstallPodmanEvents(
      client,
      makeProbe({ family: 'rhel', distro: 'alma', is_root: true }),
    )

    expect(commands.some((c) => c.includes('command -v dnf') && c.includes('yum install'))).toBe(true)
  })
})

describe('installPodman — version too old', () => {
  test('emits error when installed version remains below 4', async () => {
    const client = makeMockClient((command) => {
      if (command.includes('podman --version')) {
        return { stdout: 'podman version 3.4.2\n', stderr: '', code: 0 }
      }
      if (command.includes('apt-get')) {
        return { stdout: '', stderr: '', code: 0 }
      }
      return { stdout: '', stderr: '', code: 0 }
    })

    const events = await collectInstallPodmanEvents(client, makeProbe())
    const error = events.find((e) => e.kind === 'error')
    expect(error).toBeDefined()
    expect(error!.message).toMatch(/4\.0 or newer|version 4/i)
  })
})

describe('installPodman — event stream shape', () => {
  test('yields structured stage and log events', async () => {
    const client = makeMockClient((command) => {
      if (command.includes('podman --version')) {
        return { stdout: 'podman version 4.1.0\n', stderr: '', code: 0 }
      }
      return { stdout: '', stderr: '', code: 0 }
    })

    const events: Array<{ kind: string; message: string; stage_name?: string }> = []
    for await (const event of installPodman(client, makeProbe({ is_root: true }))) {
      events.push(event)
    }

    expect(events[0]?.kind).toBe('stage')
    expect(events[0]?.stage_name).toBe('check_version')
    expect(events.some((e) => e.kind === 'done')).toBe(true)
    for (const event of events) {
      expect(typeof event.message).toBe('string')
      expect(event.message.length).toBeGreaterThan(0)
    }
  })
})
