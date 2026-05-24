/**
 * Parse and classify /etc/os-release for edge VM probing — Phase 4 (P4.1).
 */

import type {
  DistroClassification,
  ParsedOsRelease,
  ProbeFailureReason,
  TargetProbeDetails,
  TargetProbeVerdict,
  UnsupportedDistroId,
} from './types.js'

const UNSUPPORTED_MESSAGES: Record<UnsupportedDistroId, string> = {
  alpine: 'Alpine Linux is not supported at launch. Use Debian, Ubuntu, Fedora, RHEL, Rocky, or Alma.',
  arch: 'Arch Linux is not supported at launch. Use Debian, Ubuntu, Fedora, RHEL, Rocky, or Alma.',
  opensuse: 'openSUSE is not supported at launch. Use Debian, Ubuntu, Fedora, RHEL, Rocky, or Alma.',
  other: 'This Linux distribution is not supported at launch. Use Debian, Ubuntu, Fedora, RHEL, Rocky, or Alma.',
}

/** Parse KEY=value lines from /etc/os-release (ignores comments and blank lines). */
export function parseOsRelease(content: string): ParsedOsRelease {
  const fields: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    fields[key] = value
  }

  const id = (fields['ID'] ?? '').toLowerCase()
  const versionId = fields['VERSION_ID'] ?? fields['VERSION'] ?? ''
  const idLikeRaw = fields['ID_LIKE'] ?? ''
  const idLike = idLikeRaw
    .toLowerCase()
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)

  return {
    id,
    versionId,
    idLike,
    name: fields['NAME'],
  }
}

function unsupportedClassification(
  parsed: ParsedOsRelease,
  unsupportedId: UnsupportedDistroId,
): DistroClassification {
  return {
    distro: parsed.id || parsed.name?.toLowerCase() || 'unknown',
    version: parsed.versionId,
    family: 'unsupported',
    unsupportedId,
  }
}

/** Classify distro against Phase 4 launch support (strategy §9 item 4). */
export function classifyDistro(parsed: ParsedOsRelease): DistroClassification {
  const id = parsed.id

  if (id === 'alpine') {
    return unsupportedClassification(parsed, 'alpine')
  }
  if (id === 'arch' || id === 'archlinux') {
    return unsupportedClassification(parsed, 'arch')
  }
  if (
    id === 'opensuse-leap' ||
    id === 'opensuse-tumbleweed' ||
    id === 'opensuse' ||
    id === 'sles' ||
    id === 'sled'
  ) {
    return unsupportedClassification(parsed, 'opensuse')
  }

  const version = parsed.versionId

  if (id === 'ubuntu') {
    return { distro: 'ubuntu', version, family: 'debian' }
  }
  if (id === 'debian') {
    return { distro: 'debian', version, family: 'debian' }
  }
  if (id === 'fedora') {
    return { distro: 'fedora', version, family: 'fedora' }
  }
  if (id === 'rhel') {
    return { distro: 'rhel', version, family: 'rhel' }
  }
  if (id === 'rocky' || id === 'rockylinux') {
    return { distro: 'rocky', version, family: 'rhel' }
  }
  if (id === 'almalinux' || id === 'alma') {
    return { distro: 'alma', version, family: 'rhel' }
  }
  if (id === 'centos') {
    return { distro: 'centos', version, family: 'rhel' }
  }

  return unsupportedClassification(parsed, 'other')
}

export function unsupportedDistroMessage(unsupportedId: UnsupportedDistroId): string {
  return UNSUPPORTED_MESSAGES[unsupportedId]
}

export function evaluateProbeVerdict(
  details: TargetProbeDetails,
  classification: DistroClassification,
): TargetProbeVerdict {
  if (classification.family === 'unsupported') {
    const uid = classification.unsupportedId ?? 'other'
    return {
      ok: false,
      reason: 'unsupported_distro' satisfies ProbeFailureReason,
      message: unsupportedDistroMessage(uid),
    }
  }

  if (!details.is_root && !details.has_passwordless_sudo) {
    return {
      ok: false,
      reason: 'no_sudo',
      message:
        'SSH user cannot install packages. Log in as root or configure passwordless sudo, then retry.',
    }
  }

  return { ok: true }
}

export function buildTargetProbe(
  classification: DistroClassification,
  details: Omit<TargetProbeDetails, 'distro' | 'version' | 'family'>,
): TargetProbeDetails {
  return {
    distro: classification.distro,
    version: classification.version,
    family: classification.family,
    ...details,
  }
}
