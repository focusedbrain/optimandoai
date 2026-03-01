import { describe, test, expect } from 'vitest'
import { buildPlainDraftPayload } from '../plainTransform'

describe('Plain Transform', () => {
  test('wraps string content as internal_draft', () => {
    const payload = buildPlainDraftPayload('Hello, world!') as any
    expect(payload.capsule_type).toBe('internal_draft')
    expect(payload.schema_version).toBe(1)
    expect(payload.content).toBe('Hello, world!')
    expect(payload.timestamp).toBeDefined()
  })

  test('wraps Buffer content as internal_draft', () => {
    const buf = Buffer.from('Buffer content')
    const payload = buildPlainDraftPayload(buf) as any
    expect(payload.capsule_type).toBe('internal_draft')
    expect(payload.content).toBe('Buffer content')
  })

  test('does not include handshake_id', () => {
    const payload = buildPlainDraftPayload('test') as any
    expect(payload.handshake_id).toBeUndefined()
  })

  test('preserves empty string', () => {
    const payload = buildPlainDraftPayload('') as any
    expect(payload.content).toBe('')
    expect(payload.capsule_type).toBe('internal_draft')
  })

  test('handles unicode content', () => {
    const payload = buildPlainDraftPayload('日本語テスト 🎉') as any
    expect(payload.content).toBe('日本語テスト 🎉')
  })
})
