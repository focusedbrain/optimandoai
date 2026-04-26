/**
 * Host AI (Sandbox → Host) **transport decision matrix** — product rules encoded as pure helpers.
 *
 * Inputs (conceptual; concrete types live in deciders and policy):
 * - `endpoint_kind`: `direct` | `relay` | `webrtc` (path) | `unknown`
 * - Peer endpoint **provenance**: `valid` | `missing` | `self` | `wrong_owner` | `stale` — resolved by
 *   `resolveSandboxToHostHttpDirectIngest` / `listHostCapabilities` (terminal deny codes, not generic HTTP errors).
 * - WebRTC data channel: `open` | `connecting` | `failed` | `unavailable` (see `P2pSessionPhase` + `isP2pDataChannelUpForHandshake`).
 * - Legacy HTTP to peer BEAP ingest: `valid` | `invalid` | `unavailable` (`legacyHttpFallbackViable`, `mayPostInternalInferenceHttpToIngest`, relay has no direct POST).
 * - Relay authenticated P2P stack + signaling: **available** when `p2pEndpointGateOpen` and relay health allow signaling; **unavailable** otherwise.
 * - Host **provider** (Ollama, etc. on the paired host): from capabilities/probe — **unknown** until a successful or typed-failure probe.
 *
 * Rules (summary):
 * - If direct endpoint provenance is **invalid**, do not attempt direct HTTP to that URL for Host AI (enforced in `listHostCapabilities` / `resolveSandboxToHostHttpDirectIngest` — terminal `HOST_*` codes, not `PROBE_HOST_UNREACHABLE` alone).
 * - If direct HTTP is unavailable but an authenticated P2P path exists (e.g. relay + DC), capability requests go over WebRTC/DC (see `decideHostAiIntentRoute` + `listHostCapabilities` webrtc branch).
 * - If WebRTC is only **connecting** and there is no data channel, Host AI is **not** available (no “ready” or list-proven state).
 * - Prefer preserving **real** failure codes from the phase layer (`P2P_SESSION_FAILED`, `INTERNAL_RELAY_P2P_NOT_READY`, etc.); do not map auth/provenance to generic connectivity in UI (`listInferenceTargets` + probe mapping).
 * - **Sandbox-local Ollama** must not satisfy “Host AI available” — probe/capabilities must reflect the **remote host** (see `host_remote_ollama_down` / capabilities wire on DC or HTTP to peer ingest).
 */
import { isP2pDataChannelUpForHandshake } from './p2pSession/p2pSessionWait'
import type { HostAiTransportDeciderResult } from './transport/decideInternalInferenceTransport'

/**
 * **List selection proven**: at least one transport can run a successful capability request path to the **paired host**
 * (legacy HTTP to valid direct ingest, or WebRTC with DC up, per current decider + live session state).
 */
export function isHostAiListTransportProven(d: HostAiTransportDeciderResult, handshakeId: string): boolean {
  if (d.selectorPhase === 'ready' || d.selectorPhase === 'legacy_http_available') {
    return true
  }
  /**
   * After `waitForP2pDataChannelOpenOrTerminal`, the decider may still show `connecting` because it was computed
   * before the DC came up. If the data plane is up, WebRTC is a valid plane for `listHostCapabilities` / probe.
   */
  if (d.preferredTransport === 'webrtc_p2p' && isP2pDataChannelUpForHandshake(handshakeId)) {
    return true
  }
  return false
}
