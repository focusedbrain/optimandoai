import { describe, it, expect } from 'vitest'
import { hostInferenceModelId, isHostInferenceModelId, parseHostInferenceModelId } from '../hostInferenceModelIds'

describe('hostInferenceModelIds', () => {
  it('builds and parses id', () => {
    const id = hostInferenceModelId('hs-abc')
    expect(id).toBe('host-inference:hs-abc')
    expect(parseHostInferenceModelId(id)).toEqual({ handshakeId: 'hs-abc' })
    expect(isHostInferenceModelId(id)).toBe(true)
  })

  it('rejects non-host models', () => {
    expect(parseHostInferenceModelId('llama3')).toBeNull()
    expect(isHostInferenceModelId('cloud')).toBe(false)
  })
})
