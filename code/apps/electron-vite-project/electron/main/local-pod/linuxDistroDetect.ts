/**
 * Linux distro detection for operator-facing Podman install instructions.
 */

import { readFileSync } from 'node:fs'

import {
  LINUX_DISTRO_INSTALL_HINTS,
  type LinuxDistroInstallHint,
} from './podmanInstallRunner.js'

export function detectLinuxDistroHint(): LinuxDistroInstallHint {
  let content = ''
  try {
    content = readFileSync('/etc/os-release', 'utf8')
  } catch {
    return LINUX_DISTRO_INSTALL_HINTS[0]!
  }

  const id = content.match(/^ID=(.+)$/m)?.[1]?.replace(/"/g, '').toLowerCase() ?? ''
  const idLike = content.match(/^ID_LIKE=(.+)$/m)?.[1]?.replace(/"/g, '').toLowerCase() ?? ''
  const haystack = `${id} ${idLike}`

  if (haystack.includes('debian') || haystack.includes('ubuntu')) {
    return LINUX_DISTRO_INSTALL_HINTS.find((h) => h.id === 'debian')!
  }
  if (
    haystack.includes('fedora') ||
    haystack.includes('rhel') ||
    haystack.includes('centos') ||
    haystack.includes('rocky') ||
    haystack.includes('almalinux')
  ) {
    return LINUX_DISTRO_INSTALL_HINTS.find((h) => h.id === 'fedora')!
  }
  if (haystack.includes('arch') || haystack.includes('manjaro')) {
    return LINUX_DISTRO_INSTALL_HINTS.find((h) => h.id === 'arch')!
  }
  if (haystack.includes('opensuse') || haystack.includes('suse')) {
    return LINUX_DISTRO_INSTALL_HINTS.find((h) => h.id === 'opensuse')!
  }

  return LINUX_DISTRO_INSTALL_HINTS[0]!
}

export function buildLinuxOperatorInstruction(hint: LinuxDistroInstallHint): string {
  const installLine = hint.commands.find((c) => c.includes('install')) ?? hint.commands[0]!
  return [
    'WR Desk requires the Podman container runtime for security isolation on this server.',
    '',
    'This app cannot install system packages without root. Your operator must run:',
    '',
    installLine,
    '',
    'Then restart the WR Desk service on this host. Secure isolation will resume automatically after Podman is available.',
  ].join('\n')
}

export function buildLinuxEngineOperatorInstruction(): string {
  return [
    'Podman is installed but the container engine is not responding on this server.',
    '',
    'Your operator should verify the Podman service is running, for example:',
    '',
    'sudo systemctl start podman',
    'sudo systemctl enable podman',
    '',
    'Then restart the WR Desk service.',
  ].join('\n')
}
