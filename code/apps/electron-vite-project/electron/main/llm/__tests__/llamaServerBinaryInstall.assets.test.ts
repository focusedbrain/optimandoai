/**
 * build038 installer asset-selection tests:
 *  - CUDA variant requires the matching cudart companion zip (fresh-install DLL fix)
 *  - incomplete releases (assets still uploading) are rejected → release-race fallback
 *  - cpu/vulkan variants need no companion
 *  - draft/prerelease releases are never selected
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
}))
vi.mock('../local-llm-manager', () => ({
  localLlmManager: {},
}))
vi.mock('../../inference/gpuStatus', () => ({
  detectNvidiaSmi: async () => ({ present: false }),
}))

import { pickReleaseAssets, type GithubRelease } from '../llamaServerBinaryInstall'

function release(tag: string, assetNames: string[], extra?: Partial<GithubRelease>): GithubRelease {
  return {
    tag_name: tag,
    assets: assetNames.map((name) => ({
      name,
      browser_download_url: `https://github.com/ggml-org/llama.cpp/releases/download/${tag}/${name}`,
    })),
    ...extra,
  }
}

describe('pickReleaseAssets — CUDA companion (cudart DLLs)', () => {
  it('selects main zip + matching cudart companion for cuda', () => {
    const rel = release('b9952', [
      'llama-b9952-bin-win-cuda-12.4-x64.zip',
      'cudart-llama-bin-win-cuda-12.4-x64.zip',
      'llama-b9952-bin-win-cpu-x64.zip',
    ])
    const picked = pickReleaseAssets(rel, 'cuda')
    expect(picked).not.toBeNull()
    expect(picked!.main.name).toBe('llama-b9952-bin-win-cuda-12.4-x64.zip')
    expect(picked!.companions.map((a) => a.name)).toEqual(['cudart-llama-bin-win-cuda-12.4-x64.zip'])
  })

  it('returns null (incomplete) when the cudart companion is missing', () => {
    const rel = release('b9952', ['llama-b9952-bin-win-cuda-12.4-x64.zip'])
    expect(pickReleaseAssets(rel, 'cuda')).toBeNull()
  })

  it('companion must match the main zip CUDA version', () => {
    const rel = release('b9952', [
      'llama-b9952-bin-win-cuda-12.4-x64.zip',
      'cudart-llama-bin-win-cuda-13.3-x64.zip',
    ])
    expect(pickReleaseAssets(rel, 'cuda')).toBeNull()
  })

  it('prefers the lowest CUDA version when several are published, with its companion', () => {
    const rel = release('b9952', [
      'llama-b9952-bin-win-cuda-13.3-x64.zip',
      'cudart-llama-bin-win-cuda-13.3-x64.zip',
      'llama-b9952-bin-win-cuda-12.4-x64.zip',
      'cudart-llama-bin-win-cuda-12.4-x64.zip',
    ])
    const picked = pickReleaseAssets(rel, 'cuda')
    expect(picked!.main.name).toBe('llama-b9952-bin-win-cuda-12.4-x64.zip')
    expect(picked!.companions[0]!.name).toBe('cudart-llama-bin-win-cuda-12.4-x64.zip')
  })
})

describe('pickReleaseAssets — cpu/vulkan and release filtering', () => {
  it('cpu needs only the main zip and no companions', () => {
    const rel = release('b9952', ['llama-b9952-bin-win-cpu-x64.zip'])
    const picked = pickReleaseAssets(rel, 'cpu')
    expect(picked!.main.name).toBe('llama-b9952-bin-win-cpu-x64.zip')
    expect(picked!.companions).toEqual([])
  })

  it('vulkan needs only the main zip and no companions', () => {
    const rel = release('b9952', ['llama-b9952-bin-win-vulkan-x64.zip'])
    const picked = pickReleaseAssets(rel, 'vulkan')
    expect(picked!.main.name).toBe('llama-b9952-bin-win-vulkan-x64.zip')
    expect(picked!.companions).toEqual([])
  })

  it('returns null when the main zip for the variant is absent (release race)', () => {
    const rel = release('b9953', ['llama-b9953-bin-macos-arm64.zip'])
    expect(pickReleaseAssets(rel, 'cpu')).toBeNull()
    expect(pickReleaseAssets(rel, 'cuda')).toBeNull()
  })

  it('rejects draft and prerelease releases', () => {
    const assets = [
      'llama-b9952-bin-win-cpu-x64.zip',
      'llama-b9952-bin-win-cuda-12.4-x64.zip',
      'cudart-llama-bin-win-cuda-12.4-x64.zip',
    ]
    expect(pickReleaseAssets(release('b9952', assets, { draft: true }), 'cpu')).toBeNull()
    expect(pickReleaseAssets(release('b9952', assets, { prerelease: true }), 'cuda')).toBeNull()
  })
})
