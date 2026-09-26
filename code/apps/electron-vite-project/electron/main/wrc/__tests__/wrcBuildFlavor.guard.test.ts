/**
 * Containment of the built-in WR Code test registry, pinned in source.
 *
 * A release build must not carry the test registry and must not take its WRC
 * trust from the environment. These guards pin the pieces that make that true:
 * the flavor define and the stub alias in `vite.config.ts`, the bundle check in
 * every build chain, the stub's export parity, the pinned release anchors, and
 * the separate output folder of the test build.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import * as real from '../wrcTestRegistry'
import * as stub from '../wrcTestRegistry.release-stub'
import { setWrcBuildFlavorForTests, wrcBuildFlavor } from '../wrcBuildFlavor'
import { WRC_RELEASE_TRUST, WRC_TEST_KID_PREFIX } from '../wrcTrustAnchors'
import { resolveWrcTrustConfig } from '../wrcRuntime'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = join(here, '..', '..', '..', '..')
const read = (...p: string[]) => readFileSync(join(appDir, ...p), 'utf8')

afterEach(() => setWrcBuildFlavorForTests(null))

describe('the build flavor', () => {
  it('is release unless the test build sets it, in both bundles', () => {
    const vite = read('vite.config.ts')
    expect(vite).toContain(
      "process.env.WRDESK_WRC_BUILD_FLAVOR === 'wrc-test' ? 'wrc-test' : 'release'",
    )
    expect(vite.match(/__WRC_BUILD_FLAVOR__: JSON\.stringify\(WRC_BUILD_FLAVOR\)/g)).toHaveLength(2)
  })

  it('aliases the test registry to its stub in every non-test main bundle', () => {
    const vite = read('vite.config.ts')
    expect(vite).toContain("find: /^\\.\\/wrcTestRegistry$/")
    expect(vite).toContain("'electron/main/wrc/wrcTestRegistry.release-stub.ts'")
    expect(vite).toMatch(/resolve: \{\s*alias: WRC_TEST_REGISTRY_ALIAS,/)
  })

  it('is dev only in an unbundled run', () => {
    expect(wrcBuildFlavor()).toBe('dev')
  })
})

describe('every build chain checks the bundle against its flavor', () => {
  const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts

  it.each(Object.entries(scripts).filter(([, s]) => s.includes('vite build')))('%s', (_name, script) => {
    expect(script).toContain('vite build && node scripts/verify-wrc-build-flavor.cjs')
  })

  it('offers build:wrc-test', () => {
    expect(scripts['build:wrc-test']).toBe('node scripts/build-wrc-test.cjs')
  })
})

describe('the release stub', () => {
  it('exports the same runtime names as the test registry', () => {
    expect(Object.keys(stub).sort()).toEqual(Object.keys(real).sort())
  })

  it('carries no test material and refuses to build a registry', () => {
    const source = read('electron', 'main', 'wrc', 'wrcTestRegistry.release-stub.ts')
    expect(source).not.toContain(real.WRC_TEST_REGISTRY_MARKER)
    expect(() => stub.createWrcTestRegistry()).toThrow(/not part of this build/)
  })

  it('the bundle check searches for the registry marker', () => {
    expect(read('scripts', 'verify-wrc-build-flavor.cjs')).toContain(`'${real.WRC_TEST_REGISTRY_MARKER}'`)
  })
})

describe('release trust comes only from the pinned anchors [XVI.6.4]', () => {
  const env = {
    WRDESK_WRC_REGISTRY_URL: 'https://rogue.example',
    WRDESK_WRC_INGEST_PUBKEY: 'rogue-ingest',
    WRDESK_WRC_DIRECTORY_OPERATOR_KID: 'rogue-op',
    WRDESK_WRC_DIRECTORY_OPERATOR_PUBKEY: 'rogue-op-pub',
  }

  function withEnv<T>(fn: () => T): T {
    const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]))
    Object.assign(process.env, env)
    try {
      return fn()
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  }

  const pinned = {
    registryBaseUrl: 'https://wrc.optirando.example',
    ingestPublicKey: 'ingest-pub',
    directoryOperatorKid: 'op-2026',
    directoryOperatorPub: 'op-pub',
  }

  it('release ignores the environment', () => {
    expect(withEnv(() => resolveWrcTrustConfig('release', null))).toEqual({})
    expect(withEnv(() => resolveWrcTrustConfig('release', pinned))).toEqual(pinned)
  })

  it('release refuses a pinned anchor with the test key prefix', () => {
    const testAnchor = { ...pinned, directoryOperatorKid: `${WRC_TEST_KID_PREFIX}directory-operator` }
    expect(resolveWrcTrustConfig('release', testAnchor)).toEqual({})
  })

  it('only the unbundled dev flavor reads the environment', () => {
    expect(withEnv(() => resolveWrcTrustConfig('dev'))).toEqual({
      registryBaseUrl: env.WRDESK_WRC_REGISTRY_URL,
      ingestPublicKey: env.WRDESK_WRC_INGEST_PUBKEY,
      directoryOperatorKid: env.WRDESK_WRC_DIRECTORY_OPERATOR_KID,
      directoryOperatorPub: env.WRDESK_WRC_DIRECTORY_OPERATOR_PUBKEY,
    })
  })

  it('the wrc-test flavor uses the built-in registry, never the environment', () => {
    const cfg = withEnv(() => resolveWrcTrustConfig('wrc-test'))
    expect(cfg.registryBaseUrl).toBe(real.WRC_TEST_REGISTRY_BASE_URL)
    expect(cfg.directoryOperatorKid?.startsWith(WRC_TEST_KID_PREFIX)).toBe(true)
  })

  it('the pinned release anchors never carry test material', () => {
    if (!WRC_RELEASE_TRUST) return
    const test = real.createWrcTestRegistry().config
    expect(WRC_RELEASE_TRUST.directoryOperatorKid.startsWith(WRC_TEST_KID_PREFIX)).toBe(false)
    expect(WRC_RELEASE_TRUST.directoryOperatorPub).not.toBe(test.directoryOperatorPub)
    expect(WRC_RELEASE_TRUST.ingestPublicKey).not.toBe(test.ingestPublicKey)
  })
})

describe('the test build packages beside the release build', () => {
  it('uses its own output folder and keeps both on cleanup', () => {
    const builder = read('electron-builder.config.cjs')
    expect(builder).toContain("windowsOutputDirMarker() + WRC_TEST_OUTPUT_SUFFIX")
    expect(builder).toContain("'!dist/release-wrc-test/**'")
    expect(read('scripts', 'kill-wr-desk.cjs')).toContain('new Set([keep, `${keep}-wrc-test`])')
    for (const script of ['verify-windows-unpacked.cjs', 'clean-windows-build-output.cjs']) {
      expect(read('scripts', script)).toContain("process.env.WRDESK_WRC_BUILD_FLAVOR === 'wrc-test' ? '-wrc-test' : ''")
    }
  })
})

describe('the test code sheet', () => {
  it('lists every code the registry issues', () => {
    const sheet = readFileSync(join(appDir, '..', '..', 'docs', 'operational', 'wrc-test-build.md'), 'utf8')
    for (const code of real.createWrcTestRegistry().codes) {
      expect(sheet, code.display).toContain(`\`${code.display}\``)
    }
  })
})
