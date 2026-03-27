import { describe, it, expect } from 'vitest'
import { checkQbeapTransportChannelSafety } from '../BeapPackageBuilder'
import type { CapsuleAttachment } from '../../../beap-builder/canonical-types'

const emptyAtt: CapsuleAttachment[] = []

describe('checkQbeapTransportChannelSafety', () => {
  it('returns null when encrypted and transport are independent', () => {
    expect(
      checkQbeapTransportChannelSafety(
        {
          messageBody: 'Hello transport',
          encryptedMessage: 'x'.repeat(40) + ' secret capsule text',
          attachments: emptyAtt,
        },
        'Hello transport',
      ),
    ).toBeNull()
  })

  it('detects identical encrypted and transport plaintext (short messages)', () => {
    const body = 'Same text'
    expect(
      checkQbeapTransportChannelSafety(
        {
          messageBody: body,
          encryptedMessage: body,
          attachments: emptyAtt,
        },
        body,
      ),
    ).toBe('SECURITY: encryptedMessage leaked into transport plaintext')
  })

  it('detects encrypted prefix duplicated in normalized transport', () => {
    const secret = 'y'.repeat(50) + ' UNIQUE_TAIL'
    const err = checkQbeapTransportChannelSafety(
      {
        messageBody: `prefix ${secret} suffix`,
        encryptedMessage: secret,
        attachments: emptyAtt,
      },
      `prefix ${secret} suffix`,
    )
    expect(err).toBe('SECURITY: encryptedMessage leaked into transport plaintext')
  })
})
