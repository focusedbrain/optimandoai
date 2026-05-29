import { describe, test, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('electron', () => ({
  app: { isPackaged: false },
}))

import {
  assertBeapPodPackageDirReady,
  resolveBeapPodPackageDir,
} from '../beapPodPaths.js'

describe('beapPodPaths', () => {
  beforeEach(() => {
    delete process.env['BEAP_POD_PACKAGE_DIR']
  })

  test('assertBeapPodPackageDirReady throws when pod.yaml missing', () => {
    process.env['BEAP_POD_PACKAGE_DIR'] = mkdtempSync(join(tmpdir(), 'beap-empty-'))
    expect(() => assertBeapPodPackageDirReady()).toThrow(/Cannot find pod\.yaml/)
    rmSync(process.env['BEAP_POD_PACKAGE_DIR'], { recursive: true, force: true })
    delete process.env['BEAP_POD_PACKAGE_DIR']
  })

  test('assertBeapPodPackageDirReady returns dir when pod.yaml exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'beap-ok-'))
    writeFileSync(join(dir, 'pod.yaml'), 'apiVersion: v1\n')
    process.env['BEAP_POD_PACKAGE_DIR'] = dir
    expect(assertBeapPodPackageDirReady()).toBe(dir)
    rmSync(dir, { recursive: true, force: true })
    delete process.env['BEAP_POD_PACKAGE_DIR']
  })

  test('resolveBeapPodPackageDir finds workspace pod.yaml in dev', () => {
    const dir = resolveBeapPodPackageDir()
    expect(dir).toContain('beap-pod')
  })
})
