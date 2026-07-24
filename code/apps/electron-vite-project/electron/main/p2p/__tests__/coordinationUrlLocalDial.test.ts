import { afterEach, describe, expect, it } from 'vitest'
import {
  isCoordinationRelayColocated,
  normalizeCoordinationUrlForLocalDial,
  normalizeCoordinationWsUrlForLocalDial,
  resetCoordinationLocalHostnameCacheForTests,
  setCoordinationLocalHostnamesForTests,
} from '../coordinationUrlLocalDial'

describe('coordinationUrlLocalDial', () => {
  afterEach(() => {
    resetCoordinationLocalHostnameCacheForTests()
  })

  it('treats public relay host as not co-located', () => {
    expect(isCoordinationRelayColocated('https://relay.wrdesk.com')).toBe(false)
    expect(normalizeCoordinationUrlForLocalDial('https://relay.wrdesk.com/beap/capsule')).toBe(
      'https://relay.wrdesk.com/beap/capsule',
    )
  })

  it('loopback-rewrites when persisted host matches a local NIC IPv4', () => {
    setCoordinationLocalHostnamesForTests(['127.0.0.1', 'localhost', '::1', '192.168.55.10'])
    const url = 'http://192.168.55.10:51249'
    expect(isCoordinationRelayColocated(url)).toBe(true)
    expect(normalizeCoordinationUrlForLocalDial(url)).toBe('http://127.0.0.1:51249')
    expect(normalizeCoordinationWsUrlForLocalDial('ws://192.168.55.10:51249/beap/ws')).toBe(
      'ws://127.0.0.1:51249/beap/ws',
    )
  })

  it('leaves remote LAN relay unchanged when host is not on this machine (sandbox path)', () => {
    setCoordinationLocalHostnamesForTests(['127.0.0.1', 'localhost', '::1', '192.168.55.20'])
    const remoteRelay = 'http://192.168.55.10:51249'
    expect(isCoordinationRelayColocated(remoteRelay)).toBe(false)
    expect(normalizeCoordinationUrlForLocalDial(remoteRelay)).toBe(remoteRelay)
    expect(normalizeCoordinationWsUrlForLocalDial('ws://192.168.55.10:51249/beap/ws')).toBe(
      'ws://192.168.55.10:51249/beap/ws',
    )
  })

  it('treats loopback persisted URL as co-located (no-op rewrite)', () => {
    expect(isCoordinationRelayColocated('http://127.0.0.1:51249')).toBe(true)
    expect(normalizeCoordinationUrlForLocalDial('http://127.0.0.1:51249')).toBe('http://127.0.0.1:51249')
  })
})
