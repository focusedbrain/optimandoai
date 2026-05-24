/**
 * Remote target probe — distro, Podman, sudo — Phase 4 (P4.1).
 */

import {
  buildTargetProbe,
  classifyDistro,
  evaluateProbeVerdict,
  parseOsRelease,
} from './osRelease.js'
import type {
  PackageManagerKind,
  SshCommandRunner,
  TargetProbe,
  TargetProbeDetails,
} from './types.js'

export { parseOsRelease, classifyDistro, evaluateProbeVerdict, buildTargetProbe }

export interface ProbeCommandResults {
  readonly osReleaseContent: string
  readonly podmanPathStdout: string
  readonly packageManagerStdout: string
  readonly idUStdout: string
  readonly sudoCheckStdout: string
  readonly sudoCheckStderr: string
  readonly sudoCheckCode: number | null
}

/** Derive probe fields from captured command output (unit tests). */
export function interpretProbeCommands(results: ProbeCommandResults): TargetProbe {
  const parsed = parseOsRelease(results.osReleaseContent)
  const classification = classifyDistro(parsed)

  const podmanPath = results.podmanPathStdout.trim()
  const podman_installed = podmanPath.length > 0 && !podmanPath.includes('not found')

  const pmOut = results.packageManagerStdout.toLowerCase()
  let package_manager: PackageManagerKind = 'unknown'
  if (pmOut.includes('rpm')) package_manager = 'rpm'
  else if (pmOut.includes('dpkg')) package_manager = 'dpkg'

  const uid = parseInt(results.idUStdout.trim(), 10)
  const is_root = uid === 0

  const has_passwordless_sudo = is_root || results.sudoCheckCode === 0

  const details = buildTargetProbe(classification, {
    podman_installed,
    package_manager,
    is_root,
    has_passwordless_sudo,
  })

  const verdict = evaluateProbeVerdict(details, classification)
  return { ...details, verdict }
}

/**
 * Probe a connected SSH target per strategy §4 Step 3.
 * Does not install Podman — missing podman is recorded but does not fail the verdict.
 */
export async function probeTarget(client: SshCommandRunner): Promise<TargetProbe> {
  const osRelease = await client.run('cat /etc/os-release')
  if (osRelease.code !== 0 || !osRelease.stdout.trim()) {
    return probeCommandFailed('Could not read /etc/os-release on the target host.')
  }

  const podmanCheck = await client.run('command -v podman 2>/dev/null || true')
  const pmCheck = await client.run(
    '(rpm --version 2>/dev/null | head -1) || (dpkg --version 2>/dev/null | head -1) || true',
  )
  const idCheck = await client.run('id -u')
  const sudoCheck = await client.run('sudo -n true 2>/dev/null; echo SUDO_EXIT:$?')

  if (idCheck.code !== 0) {
    return probeCommandFailed('Could not determine SSH user id (id -u failed).')
  }

  const sudoExitMatch = sudoCheck.stdout.match(/SUDO_EXIT:(\d+)/)
  const sudoExitCode = sudoExitMatch ? Number(sudoExitMatch[1]) : sudoCheck.code

  return interpretProbeCommands({
    osReleaseContent: osRelease.stdout,
    podmanPathStdout: podmanCheck.stdout,
    packageManagerStdout: pmCheck.stdout,
    idUStdout: idCheck.stdout,
    sudoCheckStdout: sudoCheck.stdout,
    sudoCheckStderr: sudoCheck.stderr,
    sudoCheckCode: sudoExitCode,
  })
}

function probeCommandFailed(message: string): TargetProbe {
  const details: TargetProbeDetails = {
    distro: 'unknown',
    version: '',
    family: 'unsupported',
    podman_installed: false,
    package_manager: 'unknown',
    is_root: false,
    has_passwordless_sudo: false,
  }
  return {
    ...details,
    verdict: {
      ok: false,
      reason: 'probe_command_failed',
      message,
    },
  }
}
