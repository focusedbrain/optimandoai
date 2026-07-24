import { describe, expect, it } from 'vitest'
import {
  HOST_AI_DIRECT_BEAP_AD_SEALED_RELAY_ENDPOINT_PLACEHOLDER,
  hostAiDirectBeapAdEndpointUrlIsInertPlaceholder,
  wireEndpointUrlForHostAiDirectBeapAd,
} from '../hostAiDirectBeapAdWire'

describe('hostAiDirectBeapAdWire', () => {
  it('uses sealed-relay placeholder when direct URL absent', () => {
    expect(wireEndpointUrlForHostAiDirectBeapAd(null)).toBe(
      HOST_AI_DIRECT_BEAP_AD_SEALED_RELAY_ENDPOINT_PLACEHOLDER,
    )
    expect(wireEndpointUrlForHostAiDirectBeapAd('')).toBe(
      HOST_AI_DIRECT_BEAP_AD_SEALED_RELAY_ENDPOINT_PLACEHOLDER,
    )
  })

  it('passes through real direct-LAN URL when present', () => {
    const direct = 'http://192.168.1.2:51249/beap/ingest'
    expect(wireEndpointUrlForHostAiDirectBeapAd(direct)).toBe(direct)
  })

  it('treats placeholder and empty as inert on read path', () => {
    expect(hostAiDirectBeapAdEndpointUrlIsInertPlaceholder('')).toBe(true)
    expect(hostAiDirectBeapAdEndpointUrlIsInertPlaceholder(null)).toBe(true)
    expect(
      hostAiDirectBeapAdEndpointUrlIsInertPlaceholder(HOST_AI_DIRECT_BEAP_AD_SEALED_RELAY_ENDPOINT_PLACEHOLDER),
    ).toBe(true)
    expect(hostAiDirectBeapAdEndpointUrlIsInertPlaceholder('http://192.168.1.2:9/beap/ingest')).toBe(false)
  })
})
