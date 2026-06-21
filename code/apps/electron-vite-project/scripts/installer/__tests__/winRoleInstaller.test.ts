import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  classifyWindowsEdition,
  orchestratorSeedPathFromProfile,
  ORCHESTRATOR_SEED_RELATIVE,
} from '../winRoleEdition'

/** Must match electron/bootstrapUserData.ts getWrDeskUserDataPath() */
function expectedWrDeskUserDataPath(home: string): string {
  return path.join(home, '.opengiraffe', 'electron-data')
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const INSTALLER_DIR = path.resolve(__dirname, '../../../build/installer')
const SEED_PS1 = path.join(INSTALLER_DIR, 'seed-orchestrator-mode.ps1')
const EDITION_PS1 = path.join(INSTALLER_DIR, 'detect-windows-edition.ps1')
const INSTALLER_NSH = path.join(INSTALLER_DIR, 'installer.nsh')
const HYPERV_PS1 = path.join(INSTALLER_DIR, 'hyperv-status.ps1')

function readInstallerText(file: string): string {
  return fs.readFileSync(file, 'utf8')
}

function runPowerShellFile(script: string, args: string[] = []): string {
  return execFileSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
    { encoding: 'utf8' },
  ).trim()
}

describe('Windows installer role seed — path alignment', () => {
  it('seed script targets .opengiraffe/electron-data (not AppData)', () => {
    const src = readInstallerText(SEED_PS1)
    expect(src).toContain('.opengiraffe\\electron-data')
    expect(src).toContain('orchestrator-mode.json')
    expect(src).not.toMatch(/\$env:APPDATA/)
  })

  it('written path matches bootstrapUserData getWrDeskUserDataPath + orchestrator-mode.json', () => {
    const fromBootstrap = path.join(expectedWrDeskUserDataPath(os.homedir()), 'orchestrator-mode.json')
    const fromProfile = orchestratorSeedPathFromProfile(os.homedir())
    expect(fromBootstrap).toBe(fromProfile)
    expect(fromBootstrap).toContain(ORCHESTRATOR_SEED_RELATIVE[0])
    expect(fromBootstrap.endsWith('orchestrator-mode.json')).toBe(true)
  })
})

describe('Windows installer — no sandbox mode in installer artifacts', () => {
  const files = [SEED_PS1, INSTALLER_NSH, EDITION_PS1, HYPERV_PS1]

  it.each(files.map((f) => [path.basename(f), f] as const))(
    '%s does not emit mode sandbox',
    (_name, file) => {
      const src = readInstallerText(file)
      expect(src).not.toMatch(/mode\s*=\s*['"]sandbox['"]/)
      expect(src).not.toMatch(/"mode"\s*:\s*"sandbox"/)
      expect(src).not.toContain("'sandbox'")
    },
  )

  it('installer.nsh locks Host and disables Sandbox UI', () => {
    const src = readInstallerText(INSTALLER_NSH)
    expect(src).toContain('Sandbox orchestrators run only on Linux.')
    expect(src).toContain('EnableWindow $WRDeskSandboxRadio 0')
    expect(src).toContain('seed-orchestrator-mode.ps1')
  })
})

describe('classifyWindowsEdition', () => {
  it('returns home for Core / Home SKU EditionIDs', () => {
    expect(classifyWindowsEdition('Core')).toBe('home')
    expect(classifyWindowsEdition('CoreSingleLanguage')).toBe('home')
    expect(classifyWindowsEdition('Home')).toBe('home')
  })

  it('returns pro for Professional / Enterprise EditionIDs', () => {
    expect(classifyWindowsEdition('Professional')).toBe('pro')
    expect(classifyWindowsEdition('ProfessionalWorkstation')).toBe('pro')
    expect(classifyWindowsEdition('Enterprise')).toBe('pro')
  })

  it('returns other for unknown EditionIDs', () => {
    expect(classifyWindowsEdition('ServerStandard')).toBe('other')
    expect(classifyWindowsEdition('')).toBe('other')
  })
})

describe('detect-windows-edition.ps1', () => {
  it('classifies mocked EditionId parameters', () => {
    expect(runPowerShellFile(EDITION_PS1, ['-EditionId', 'Core'])).toBe('home')
    expect(runPowerShellFile(EDITION_PS1, ['-EditionId', 'Professional'])).toBe('pro')
    expect(runPowerShellFile(EDITION_PS1, ['-EditionId', 'ServerDatacenter'])).toBe('other')
  })
})

describe('seed-orchestrator-mode.ps1', () => {
  it.skipIf(process.platform !== 'win32')(
    'writes mode host on fresh profile dir',
    () => {
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wrdesk-seed-'))
      const profile = path.join(tmpRoot, 'User')
      fs.mkdirSync(profile, { recursive: true })

      runPowerShellFile(SEED_PS1, ['-UserProfileRoot', profile])

      const seedPath = orchestratorSeedPathFromProfile(profile)
      expect(fs.existsSync(seedPath)).toBe(true)
      const json = JSON.parse(fs.readFileSync(seedPath, 'utf8')) as {
        mode: string
        deviceName: string
        instanceId: string
        pairingCode: string
        connectedPeers: unknown[]
      }
      expect(json.mode).toBe('host')
      expect(json.deviceName.length).toBeGreaterThan(0)
      expect(json.instanceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      )
      expect(json.pairingCode).toMatch(/^[0-9]{6}$/)
      expect(json.connectedPeers).toEqual([])

      fs.rmSync(tmpRoot, { recursive: true, force: true })
    },
  )

  it.skipIf(process.platform !== 'win32')(
    'preserves existing orchestrator-mode.json on reinstall',
    () => {
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wrdesk-seed-'))
      const profile = path.join(tmpRoot, 'User')
      const dataDir = path.join(profile, '.opengiraffe', 'electron-data')
      fs.mkdirSync(dataDir, { recursive: true })
      const seedPath = path.join(dataDir, 'orchestrator-mode.json')
      const existing = {
        mode: 'host',
        deviceName: 'Preserved',
        instanceId: '11111111-1111-1111-1111-111111111111',
        pairingCode: '999999',
        connectedPeers: [],
      }
      fs.writeFileSync(seedPath, JSON.stringify(existing, null, 2), 'utf8')

      runPowerShellFile(SEED_PS1, ['-UserProfileRoot', profile])

      const after = JSON.parse(fs.readFileSync(seedPath, 'utf8')) as typeof existing
      expect(after.instanceId).toBe(existing.instanceId)
      expect(after.pairingCode).toBe(existing.pairingCode)
      expect(after.deviceName).toBe('Preserved')

      fs.rmSync(tmpRoot, { recursive: true, force: true })
    },
  )
})

describe('installer.nsh hypervisor notices', () => {
  it('documents Hyper-V enable step for Pro when disabled', () => {
    const src = readInstallerText(INSTALLER_NSH)
    expect(src).toContain('Hyper-V is not enabled')
    expect(src).toContain('Enable-WindowsOptionalFeature')
    expect(src).toContain('virtualbox.org')
  })

  it('hyperv-status.ps1 returns enabled, disabled, or unknown only', () => {
    const src = readInstallerText(HYPERV_PS1)
    expect(src).toContain("'enabled'")
    expect(src).toContain("'disabled'")
    expect(src).toContain("'unknown'")
  })
})

describe('electron-builder NSIS wiring', () => {
  it('includes installer.nsh and nsis target', () => {
    const cfg = readInstallerText(
      path.resolve(__dirname, '../../../electron-builder.config.cjs'),
    )
    expect(cfg).toContain("target: 'nsis'")
    expect(cfg).toContain("include: 'installer/installer.nsh'")
    expect(cfg).toContain('oneClick: false')
    expect(cfg).toContain('allowToChangeInstallationDirectory: true')
  })
})
