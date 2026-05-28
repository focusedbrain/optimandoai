import { describe, test, expect } from 'vitest'

import { parsePairingLink } from '../parsePairingLink.js'

describe('parsePairingLink', () => {
  test('parses wrdesk-pair scheme', () => {
    expect(parsePairingLink('wrdesk-pair://vps.example.com:8443?code=123456')).toEqual({
      address: 'https://vps.example.com:8443',
      code: '123456',
    })
  })

  test('parses https deep link', () => {
    expect(parsePairingLink('https://vps.example.com:8443?code=654321')).toEqual({
      address: 'https://vps.example.com:8443',
      code: '654321',
    })
  })

  test('returns null without code', () => {
    expect(parsePairingLink('https://vps.example.com:8443')).toBeNull()
  })
})
