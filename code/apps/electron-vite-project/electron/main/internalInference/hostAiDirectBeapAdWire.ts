/**
 * Wire helpers for `p2p_host_ai_direct_beap_ad`. Production coordination relay schema requires
 * `endpoint_url` (non-empty, valid URL) even when direct-LAN ingest is retired; sealed-relay ads
 * use an inert placeholder that must not be probed or stored as a real ingest endpoint.
 */

/** Non-routable URL (`.invalid` TLD) — satisfies relay `field_required` without implying direct-LAN. */
export const HOST_AI_DIRECT_BEAP_AD_SEALED_RELAY_ENDPOINT_PLACEHOLDER =
  'https://wrdesk.invalid/host-ai/sealed-relay'

export function wireEndpointUrlForHostAiDirectBeapAd(directLanUrl?: string | null): string {
  const t = typeof directLanUrl === 'string' ? directLanUrl.trim() : ''
  return t || HOST_AI_DIRECT_BEAP_AD_SEALED_RELAY_ENDPOINT_PLACEHOLDER
}

/** True when the wire value carries no direct-LAN ingest (missing, empty, or sealed-relay placeholder). */
export function hostAiDirectBeapAdEndpointUrlIsInertPlaceholder(url: string | null | undefined): boolean {
  const t = typeof url === 'string' ? url.trim() : ''
  return !t || t === HOST_AI_DIRECT_BEAP_AD_SEALED_RELAY_ENDPOINT_PLACEHOLDER
}
