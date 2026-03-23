import { describe, test, expect } from 'vitest'
import { verifyExternalProcessing } from '../steps/externalProcessing'
import { ReasonCode } from '../types'
import { buildCtx, buildVerifiedCapsuleInput, buildReceiverPolicy } from './helpers'

describe('External Processing / Cloud AI', () => {
  test('external_processing none → passes regardless of policy', () => {
    const ctx = buildCtx({ input: buildVerifiedCapsuleInput({ external_processing: 'none' }) })
    expect(verifyExternalProcessing.execute(ctx).passed).toBe(true)
  })

  test('external_processing local_only → passes regardless of policy', () => {
    const ctx = buildCtx({ input: buildVerifiedCapsuleInput({ external_processing: 'local_only' }) })
    expect(verifyExternalProcessing.execute(ctx).passed).toBe(true)
  })

  test('external_processing provider_name + policy allows + snippet mode → passes', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ external_processing: 'anthropic', cloud_payload_mode: 'snippet', cloud_payload_bytes: 500 }),
      receiverPolicy: buildReceiverPolicy({ allowsCloudEscalation: true, allowedCloudProviders: ['anthropic'], cloudPayloadModeAllowed: ['none', 'snippet'] }),
    })
    expect(verifyExternalProcessing.execute(ctx).passed).toBe(true)
  })

  test('external_processing provider_name + policy denies cloud → CLOUD_PROCESSING_DENIED', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ external_processing: 'anthropic' }),
      receiverPolicy: buildReceiverPolicy({ allowsCloudEscalation: false }),
    })
    const r = verifyExternalProcessing.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.CLOUD_PROCESSING_DENIED)
  })

  test('external_processing provider_name not in allowedCloudProviders → CLOUD_PROVIDER_DENIED', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ external_processing: 'openai', cloud_payload_mode: 'snippet' }),
      receiverPolicy: buildReceiverPolicy({ allowsCloudEscalation: true, allowedCloudProviders: ['anthropic'] }),
    })
    const r = verifyExternalProcessing.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.CLOUD_PROVIDER_DENIED)
  })

  test('cloud AI is OFF by default (default policy)', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ external_processing: 'anthropic' }),
      receiverPolicy: buildReceiverPolicy(),
    })
    const r = verifyExternalProcessing.execute(ctx)
    expect(r.passed).toBe(false)
  })

  test('cloud_payload_mode full → CLOUD_PROCESSING_DENIED (MVP: snippet only)', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ external_processing: 'anthropic', cloud_payload_mode: 'full' }),
      receiverPolicy: buildReceiverPolicy({ allowsCloudEscalation: true, allowedCloudProviders: ['anthropic'] }),
    })
    const r = verifyExternalProcessing.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.CLOUD_PROCESSING_DENIED)
  })

  test('cloud_payload_mode absent with provider → CLOUD_PROCESSING_DENIED', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ external_processing: 'anthropic', cloud_payload_mode: undefined }),
      receiverPolicy: buildReceiverPolicy({ allowsCloudEscalation: true, allowedCloudProviders: ['anthropic'] }),
    })
    const r = verifyExternalProcessing.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.CLOUD_PROCESSING_DENIED)
  })

  test('cloud_payload_bytes exceeds maxCloudPayloadBytes → CLOUD_PROCESSING_DENIED', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ external_processing: 'anthropic', cloud_payload_mode: 'snippet', cloud_payload_bytes: 2000 }),
      receiverPolicy: buildReceiverPolicy({ allowsCloudEscalation: true, allowedCloudProviders: ['anthropic'], maxCloudPayloadBytes: 1200 }),
    })
    const r = verifyExternalProcessing.execute(ctx)
    expect(r.passed).toBe(false)
    if (!r.passed) expect(r.reason).toBe(ReasonCode.CLOUD_PROCESSING_DENIED)
  })

  test('cloud_payload_mode snippet + bytes within limit → passes', () => {
    const ctx = buildCtx({
      input: buildVerifiedCapsuleInput({ external_processing: 'anthropic', cloud_payload_mode: 'snippet', cloud_payload_bytes: 800 }),
      receiverPolicy: buildReceiverPolicy({ allowsCloudEscalation: true, allowedCloudProviders: ['anthropic'], maxCloudPayloadBytes: 1200, cloudPayloadModeAllowed: ['none', 'snippet'] }),
    })
    expect(verifyExternalProcessing.execute(ctx).passed).toBe(true)
  })
})
