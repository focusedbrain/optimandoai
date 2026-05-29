/**
 * CI guard — pod manifest security invariants must not regress (Stream A — A8).
 */

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test, expect } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const MANIFESTS = ['pod.yaml', 'pod-local-verify.yaml', 'pod-remote-edge.yaml'] as const

interface ContainerBlock {
  name: string
  body: string
}

function extractContainersSection(yaml: string): string {
  const match = yaml.match(/\r?\n  containers:\r?\n/)
  if (!match || match.index === undefined) {
    throw new Error('containers: section not found')
  }
  return yaml.slice(match.index + match[0].length)
}

function splitContainers(yaml: string): ContainerBlock[] {
  const section = extractContainersSection(yaml)
  const parts = section.split(/\r?\n    - name: /)
  const blocks: ContainerBlock[] = []
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i]!
    const nl = chunk.indexOf('\n')
    const name = nl === -1 ? chunk.trim() : chunk.slice(0, nl).trim()
    blocks.push({ name, body: chunk })
  }
  return blocks
}

function assertContainerSecurity(block: ContainerBlock, manifest: string): void {
  const { name, body } = block
  const label = `${manifest} container "${name}"`

  expect(body, `${label}: runAsUser`).toMatch(/runAsUser:\s*10\d{3}/)
  expect(body, `${label}: readOnlyRootFilesystem`).toMatch(/readOnlyRootFilesystem:\s*true/)
  expect(body, `${label}: allowPrivilegeEscalation`).toMatch(
    /allowPrivilegeEscalation:\s*false/,
  )
  expect(body, `${label}: capabilities drop ALL`).toMatch(/drop:\s*\["ALL"\]/)
  expect(body, `${label}: memory limit`).toMatch(/memory:\s*"/)
  expect(body, `${label}: cpu limit`).toMatch(/cpu:\s*"/)
  expect(body, `${label}: pids limit`).toMatch(/pids:\s*"/)
  expect(body, `${label}: seccompProfile`).toMatch(/seccompProfile:/)

  if (name === 'depackager') {
    expect(body, `${label}: depackager Localhost profile`).toMatch(
      /localhostProfile:\s*beap-depackager\.json/,
    )
    expect(body, `${label}: depackager Localhost type`).toMatch(/type:\s*Localhost/)
  }

  if (name === 'pdf-parser') {
    expect(body, `${label}: pdf-parser Localhost profile`).toMatch(
      /localhostProfile:\s*beap-pdf-parser\.json/,
    )
    expect(body, `${label}: pdf-parser runAsUser 10108`).toMatch(/runAsUser:\s*10108/)
    expect(body, `${label}: pdf-parser pids 64`).toMatch(/pids:\s*"64"/)
  }
}

describe.each(MANIFESTS)('pod manifest security — %s', (manifest) => {
  test('every container meets hardening invariants', () => {
    const path = join(ROOT, manifest)
    const yaml = readFileSync(path, 'utf8')
    const containers = splitContainers(yaml)
    expect(containers.length, manifest).toBeGreaterThan(0)
    for (const block of containers) {
      assertContainerSecurity(block, manifest)
    }
  })

  test('restartPolicy is Never', () => {
    const yaml = readFileSync(join(ROOT, manifest), 'utf8')
    expect(yaml).toMatch(/restartPolicy:\s*Never/)
  })
})

describe('Containerfile distributable notices', () => {
  test('copies THIRD-PARTY-NOTICES and licenses into image', () => {
    const dockerfile = readFileSync(join(ROOT, 'Containerfile'), 'utf8')
    expect(dockerfile).toMatch(/COPY packages\/beap-pod\/THIRD-PARTY-NOTICES/)
    expect(dockerfile).toMatch(/COPY packages\/beap-pod\/licenses\//)
    expect(dockerfile).toMatch(/\/usr\/share\/licenses\/beap-components/)
  })

  test('THIRD-PARTY-NOTICES exists and references Podman external runtime', () => {
    const notices = readFileSync(join(ROOT, 'THIRD-PARTY-NOTICES'), 'utf8')
    expect(notices).toContain('beap-components')
    expect(notices).toContain('Podman')
    expect(notices).toContain('AUTO:PNPM_PROD_DEPS_BEGIN')
  })
})

describe('pod.yaml LOCAL_HOST quarantine', () => {
  test('depackager mounts tmp-quarantine at /var/lib/quarantine', () => {
    const yaml = readFileSync(join(ROOT, 'pod.yaml'), 'utf8')
    expect(yaml).toMatch(/name:\s*tmp-quarantine/)
    const dep = splitContainers(yaml).find((c) => c.name === 'depackager')
    expect(dep?.body).toMatch(/mountPath:\s*\/var\/lib\/quarantine/)
  })
})

describe('pod manifest container rosters (authoritative for completeness gate)', () => {
  test('pod.yaml LOCAL_HOST defines five containers — no certifier', () => {
    const containers = splitContainers(readFileSync(join(ROOT, 'pod.yaml'), 'utf8'))
    expect(containers.map((c) => c.name)).toEqual([
      'ingestor',
      'validator',
      'depackager',
      'pdf-parser',
      'sealer',
    ])
  })

  test('pod-local-verify.yaml defines six containers including verifier — no certifier', () => {
    const containers = splitContainers(
      readFileSync(join(ROOT, 'pod-local-verify.yaml'), 'utf8'),
    )
    expect(containers.map((c) => c.name)).toEqual([
      'ingestor',
      'verifier',
      'validator',
      'depackager',
      'pdf-parser',
      'sealer',
    ])
  })

  test('pod-remote-edge.yaml includes certifier (REMOTE_EDGE only)', () => {
    const names = splitContainers(
      readFileSync(join(ROOT, 'pod-remote-edge.yaml'), 'utf8'),
    ).map((c) => c.name)
    expect(names).toContain('certifier')
    expect(names).toContain('validator')
    expect(names).not.toContain('sealer')
  })
})
