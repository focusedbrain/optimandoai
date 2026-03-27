import { describe, it, expect } from 'vitest'
import { checkQbeapTransportChannelSafety } from '../BeapPackageBuilder'
import type { CapsuleAttachment } from '../../../beap-builder/canonical-types'

const emptyAtt: CapsuleAttachment[] = []

describe('checkQbeapTransportChannelSafety', () => {
  it('returns null when encrypted and transport plaintext are independent', () => {
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

  it('allows the same human-readable text in both designated plaintext and encrypted fields', () => {
    const body = 'Same user-authored text in both fields is valid.'
    expect(
      checkQbeapTransportChannelSafety(
        {
          messageBody: body,
          encryptedMessage: body,
          attachments: emptyAtt,
        },
        body,
      ),
    ).toBeNull()
  })

  it('allows overlapping content between encryptedMessage and messageBody (not a leak)', () => {
    const secret = 'y'.repeat(50) + ' UNIQUE_TAIL'
    expect(
      checkQbeapTransportChannelSafety(
        {
          messageBody: `prefix ${secret} suffix`,
          encryptedMessage: secret,
          attachments: emptyAtt,
        },
        `prefix ${secret} suffix`,
      ),
    ).toBeNull()
  })

  it('still fails when extracted PDF semantic content appears in transport plaintext', () => {
    const semantic =
      'This is long extracted PDF semantic content that must not be pasted into the transport plaintext field because it belongs in the capsule only. ' +
      'More text to exceed fifty characters for the security check.'
    const att: CapsuleAttachment = {
      id: 'a1',
      originalName: 'doc.pdf',
      originalSize: 100,
      originalType: 'application/pdf',
      semanticExtracted: true,
      semanticContent: semantic,
      encryptedRef: 'ref',
      encryptedHash: 'hash',
      previewRef: null,
      rasterProof: null,
      isMedia: false,
      hasTranscript: false,
    }
    const transport = `Please read: ${semantic}`
    const err = checkQbeapTransportChannelSafety(
      {
        messageBody: transport,
        encryptedMessage: 'separate encrypted body',
        attachments: [att],
      },
      transport,
    )
    expect(err).toMatch(/SECURITY: Extracted PDF content detected in transport text/)
  })
})
