import { describe, test, expect } from 'vitest'
import { isInboxMessageActionable } from '../inboxMessageActionable'
import type { InboxMessage } from '../../stores/useEmailInboxStore'

describe('isInboxMessageActionable', () => {
  test('true for any non-deleted row with id', () => {
    expect(
      isInboxMessageActionable({
        id: '1',
        source_type: 'email_plain',
        deleted: 0,
      } as InboxMessage),
    ).toBe(true)
    expect(
      isInboxMessageActionable({
        id: '2',
        source_type: 'direct_beap',
      } as InboxMessage),
    ).toBe(true)
  })

  test('false when deleted or missing id', () => {
    expect(isInboxMessageActionable(null)).toBe(false)
    expect(
      isInboxMessageActionable({
        id: 'x',
        deleted: 1,
      } as InboxMessage),
    ).toBe(false)
  })
})
