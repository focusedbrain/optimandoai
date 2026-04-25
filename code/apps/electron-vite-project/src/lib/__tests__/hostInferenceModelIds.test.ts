import { describe, it, expect } from 'vitest'
import {
  hostInferenceModelId,
  hostInternalInferenceModelId,
  isHostInferenceModelId,
  parseAnyHostInferenceModelId,
  parseHostInferenceModelId,
  parseHostInternalInferenceModelId,
} from '../hostInferenceModelIds'

describe('hostInferenceModelIds', () => {
  it('builds and parses legacy id', () => {
    const id = hostInferenceModelId('hs-abc')
    expect(id).toBe('host-inference:hs-abc')
    expect(parseHostInferenceModelId(id)).toEqual({ handshakeId: 'hs-abc' })
    expect(parseHostInternalInferenceModelId(id)).toBeNull()
    expect(isHostInferenceModelId(id)).toBe(true)
  })

  it('builds and parses host-internal id with model', () => {
    const id = hostInternalInferenceModelId('hs-abc', 'gemma3:12b')
    expect(parseHostInternalInferenceModelId(id)).toEqual({ handshakeId: 'hs-abc', model: 'gemma3:12b' })
    const any = parseAnyHostInferenceModelId(id)
    expect(any).toEqual({ handshakeId: 'hs-abc', model: 'gemma3:12b' })
    expect(isHostInferenceModelId(id)).toBe(true)
  })

  it('rejects non-host models', () => {
    expect(parseHostInferenceModelId('llama3')).toBeNull()
    expect(parseAnyHostInferenceModelId('llama3')).toBeNull()
    expect(isHostInferenceModelId('llama3')).toBe(false)
  })
})
