/** Stable codes returned to callers and in HTTP JSON for internal service RPC. */

export const InternalInferenceErrorCode = {
  NO_ACTIVE_INTERNAL_HOST_HANDSHAKE: 'NO_ACTIVE_INTERNAL_HOST_HANDSHAKE',
  HOST_DIRECT_P2P_UNAVAILABLE: 'HOST_DIRECT_P2P_UNAVAILABLE',
  INVALID_INTERNAL_ROLE: 'INVALID_INTERNAL_ROLE',
  POLICY_FORBIDDEN: 'POLICY_FORBIDDEN',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  SERVICE_RPC_NOT_SUPPORTED: 'SERVICE_RPC_NOT_SUPPORTED',
  /** Wire / required-field validation (client or inbound). */
  MALFORMED_SERVICE_MESSAGE: 'MALFORMED_SERVICE_MESSAGE',
  /** Host policy: internal inference is off. */
  HOST_INFERENCE_DISABLED: 'HOST_INFERENCE_DISABLED',
  /** Host has no active local Ollama model configured, but Sandbox sent a model id. */
  HOST_NO_ACTIVE_LOCAL_LLM: 'HOST_NO_ACTIVE_LOCAL_LLM',
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
  OLLAMA_UNAVAILABLE: 'OLLAMA_UNAVAILABLE',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  RATE_LIMITED: 'RATE_LIMITED',
  REQUEST_EXPIRED: 'REQUEST_EXPIRED',
  /** Client requested cancel; Sandbox may treat as a soft error. */
  REQUEST_CANCELLED: 'REQUEST_CANCELLED',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  /** Provider (e.g. Ollama) not running or not reachable; distinct from time-based timeouts. */
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_BUSY: 'PROVIDER_BUSY',
  INTERNAL_INFERENCE_FAILED: 'INTERNAL_INFERENCE_FAILED',
  /**
   * Host no longer serves `internal_inference_request` on HTTP /beap/ingest when P2P+DC is the
   * configured path — old Sandboxes must use DataChannel, or set `WRDESK_P2P_INFERENCE_HTTP_INTERNAL_COMPAT=1`.
   */
  P2P_INFERENCE_REQUIRED: 'P2P_INFERENCE_REQUIRED',
  /** WebRTC path selected; data channel or capability fetch not complete yet (not a user-facing “failure” for the selector). */
  P2P_STILL_CONNECTING: 'P2P_STILL_CONNECTING',
  /** IPC / probe: WebRTC path but DataChannel not open; do not start a new session from probe. */
  P2P_NOT_READY: 'P2P_NOT_READY',
  /** @deprecated Use OFFER_CREATE_TIMEOUT; kept for log compatibility. */
  SIGNALING_NOT_STARTED: 'SIGNALING_NOT_STARTED',
  /** Hidden WebRTC transport window could not be created or is disabled. */
  WEBRTC_TRANSPORT_NOT_READY: 'WEBRTC_TRANSPORT_NOT_READY',
  /** `webrtcCreatePeerConnection` / IPC to the transport pod failed after the window existed. */
  OFFER_DISPATCH_FAILED: 'OFFER_DISPATCH_FAILED',
  /** Local SDP was not produced in time after transport dispatch (renderer createOffer / send offer). */
  OFFER_CREATE_TIMEOUT: 'OFFER_CREATE_TIMEOUT',
  /** Offer SDP could not be sent on the signaling path (e.g. relay). */
  OFFER_SIGNAL_SEND_FAILED: 'OFFER_SIGNAL_SEND_FAILED',
  /** Outbound offer was sent but no answer arrived before the deadline. */
  SIGNALING_ANSWER_TIMEOUT: 'SIGNALING_ANSWER_TIMEOUT',
  /** `phase=signaling` with no `create_offer_begin` and no outbound offer within the watchdog window. */
  OFFER_START_NOT_OBSERVED: 'OFFER_START_NOT_OBSERVED',
  /** Relay GET /health does not advertise Host AI P2P signaling; do not select webrtc_p2p for relay rows. */
  RELAY_HOST_AI_P2P_SIGNALING_UNAVAILABLE: 'RELAY_HOST_AI_P2P_SIGNALING_UNAVAILABLE',
  /** POST /beap/p2p-signal returned 404/405 — coordination route missing on this host. */
  RELAY_MISSING_P2P_SIGNAL_ROUTE: 'RELAY_MISSING_P2P_SIGNAL_ROUTE',
  /** Network failure reaching coordination relay for p2p-signal. */
  RELAY_UNREACHABLE: 'RELAY_UNREACHABLE',
  /** Coordination rejected p2p-signal body (4xx validation / schema). */
  P2P_SIGNAL_SCHEMA_REJECTED: 'P2P_SIGNAL_SCHEMA_REJECTED',
  /** Inbound Host AI envelope cannot be normalized to a supported `host_ai.route_advertisement` version. */
  HOST_AI_SIGNAL_SCHEMA_VERSION_UNSUPPORTED: 'HOST_AI_SIGNAL_SCHEMA_VERSION_UNSUPPORTED',
  /** 401/403 on p2p-signal POST (auth or routing). */
  P2P_SIGNAL_AUTH_OR_ROUTE_FAILED: 'P2P_SIGNAL_AUTH_OR_ROUTE_FAILED',
  /** Relay signaling circuit breaker: too many 429 offer/answer storms; new sessions paused briefly. */
  RELAY_429_CIRCUIT_OPEN: 'RELAY_429_CIRCUIT_OPEN',
  /** Too many terminal session failures on this handshake in a short window; new session attempts paused briefly. */
  HOST_AI_SESSION_TERMINAL_STORM: 'HOST_AI_SESSION_TERMINAL_STORM',
  /** Capability probe: HTTP 401/403 from Host/BEAP (gateway or token), not “Ollama down”. */
  PROBE_AUTH_REJECTED: 'PROBE_AUTH_REJECTED',
  /** Capability probe: HTTP 429 from Host/BEAP path. */
  PROBE_RATE_LIMITED: 'PROBE_RATE_LIMITED',
  /** Capability probe: HTTP 5xx or bad gateway / malformed success path from Host/BEAP. */
  PROBE_HOST_ERROR: 'PROBE_HOST_ERROR',
  /** Capability probe: transport error (network, DNS, refused) before a definitive HTTP probe status. */
  PROBE_HOST_UNREACHABLE: 'PROBE_HOST_UNREACHABLE',
  /** Capability probe: HTTP 200 capabilities OK but no models configured (distinct from Host “no active LLM” / Ollama down). */
  PROBE_NO_MODELS: 'PROBE_NO_MODELS',
  /** Capability probe: HTTP 200 but body was not valid JSON or not the expected capabilities shape. */
  PROBE_INVALID_RESPONSE: 'PROBE_INVALID_RESPONSE',
  /** Capability probe: WebRTC/DataChannel or client transport not ready; probe not sent yet (transient). */
  PROBE_TRANSPORT_NOT_READY: 'PROBE_TRANSPORT_NOT_READY',
  /** Host capability build: `/api/tags` probe reported models but enumeration failed transiently — retry shortly (distinct from PROBE_INVALID_RESPONSE wiring bugs). */
  PROBE_PROVIDER_NOT_READY: 'PROBE_PROVIDER_NOT_READY',
  /**
   * Capability probe: Host machine’s Ollama HTTP API unreachable (Host-side getEffectiveChatModelName / listModels).
   * Not related to sandbox-local Ollama discovery on the Sandbox app.
   */
  PROBE_OLLAMA_UNAVAILABLE: 'PROBE_OLLAMA_UNAVAILABLE',
  /**
   * Host capability build: `/api/tags` returned models but every row was dropped during mapping (e.g. empty names).
   * Distinct from {@link InternalInferenceErrorCode.PROBE_NO_MODELS} (no tags).
   */
  MODEL_MAPPING_DROPPED_ALL: 'MODEL_MAPPING_DROPPED_ALL',
  /** Host `ollama_direct` LAN advertisement: loopback `GET http://127.0.0.1:<port>/api/tags` failed — Sandbox reachability unknown from localhost alone. */
  OLLAMA_LOCAL_UNREACHABLE: 'OLLAMA_LOCAL_UNREACHABLE',
  /** Host `ollama_direct` LAN advertisement: localhost OK but `GET http://<host-lan-ip>:<port>/api/tags` failed or no LAN bind — do not advertise LAN Ollama. */
  OLLAMA_LAN_NOT_REACHABLE: 'OLLAMA_LAN_NOT_REACHABLE',
  /** Sandbox → Host Ollama LAN: no validated `ollama_direct` base URL for this handshake (or owner mismatch). */
  OLLAMA_DIRECT_INVALID_ENDPOINT: 'OLLAMA_DIRECT_INVALID_ENDPOINT',
  /** Sandbox → Host Ollama LAN: `POST /api/chat` failed (network / non-HTTP success) before a model-level error. */
  OLLAMA_DIRECT_CHAT_UNREACHABLE: 'OLLAMA_DIRECT_CHAT_UNREACHABLE',
  /** Sandbox → Host Ollama LAN: Ollama reports the requested model is not available. */
  OLLAMA_DIRECT_MODEL_NOT_FOUND: 'OLLAMA_DIRECT_MODEL_NOT_FOUND',
  /** Direct HTTP to peer: `counterparty_p2p_token` missing locally (cannot authenticate to their BEAP). */
  HOST_AI_DIRECT_AUTH_MISSING: 'HOST_AI_DIRECT_AUTH_MISSING',
  /** Sandbox→Host probe would POST to this device’s own direct BEAP or mismatched host owner (selection bug). */
  HOST_AI_ENDPOINT_OWNER_MISMATCH: 'HOST_AI_ENDPOINT_OWNER_MISMATCH',
  /** Handshake row cannot establish host coordination id (or other binding) to vet counterparty direct BEAP. */
  HOST_AI_ENDPOINT_PROVENANCE_MISSING: 'HOST_AI_ENDPOINT_PROVENANCE_MISSING',
  /**
   * Direct-HTTP path only: no peer-issued or relay-delivered host LAN BEAP advertisement while the
   * ledger/caller would only point at this device’s own BEAP. Does **not** mean Host AI is unavailable
   * if WebRTC/relay can carry the session (see {@link decideHostAiIntentRoute} / route selection).
   */
  HOST_AI_DIRECT_PEER_BEAP_MISSING: 'HOST_AI_DIRECT_PEER_BEAP_MISSING',
  /**
   * Route resolution: selected endpoint is this device’s own BEAP / local ingest, not the paired Host’s.
   * Identity is coordination-device scoped (handshake + device ids), not IP.
   */
  HOST_AI_LOCAL_BEAP_IS_NOT_PEER_HOST: 'HOST_AI_LOCAL_BEAP_IS_NOT_PEER_HOST',
  /**
   * Route resolution: no candidate passed verified peer-Host checks (advertisement, attestation, or policy).
   */
  HOST_AI_NO_VERIFIED_PEER_ROUTE: 'HOST_AI_NO_VERIFIED_PEER_ROUTE',
  /**
   * Route resolution: candidate owner device id does not match the handshake’s peer Host coordination id
   * (distinct from {@link InternalInferenceErrorCode.HOST_AI_ENDPOINT_OWNER_MISMATCH} wire/ingest scope).
   */
  HOST_AI_ROUTE_OWNER_MISMATCH: 'HOST_AI_ROUTE_OWNER_MISMATCH',
  /**
   * Route / repair: peer Host has no advertised counterparty BEAP endpoint (distinct ledger empty cases).
   * Terminal for probe UX when paired with {@link InternalInferenceErrorCode.HOST_AI_DIRECT_PEER_BEAP_MISSING}.
   */
  HOST_AI_PEER_ENDPOINT_MISSING: 'HOST_AI_PEER_ENDPOINT_MISSING',
  /** Handshake-derived roles do not satisfy Sandbox→Host inference (see inferenceDirectHttpTrust). */
  HOST_AI_ROLE_MISMATCH: 'HOST_AI_ROLE_MISMATCH',
  /** internal_coordination_identity_complete missing for trusted internal pairing. */
  HOST_AI_IDENTITY_INCOMPLETE: 'HOST_AI_IDENTITY_INCOMPLETE',
  /** counterparty_p2p_token missing for Sandbox→Host direct HTTP trust. */
  HOST_AI_BEARER_MISSING: 'HOST_AI_BEARER_MISSING',
  /** Inference trust denied for a reason without a narrower code (see mapTrustReasonToFailureCode). */
  HOST_AI_UNTRUSTED: 'HOST_AI_UNTRUSTED',
  /** Host peer has no direct MVP-LAN counterparty URL; do not substitute local sandbox URL. */
  HOST_DIRECT_ENDPOINT_MISSING: 'HOST_DIRECT_ENDPOINT_MISSING',
  /**
   * No WebRTC/DC, no relay P2P session, and no valid direct BEAP for HTTP — Host AI cannot be reached.
   */
  HOST_AI_NO_ROUTE: 'HOST_AI_NO_ROUTE',
  /**
   * Mis-attributed: Sandbox local Ollama unreachable; must not be shown as the **paired Host** Ollama down
   * when Host capabilities advertise the Host Ollama as available.
   */
  OLLAMA_UNREACHABLE_ON_SANDBOX: 'OLLAMA_UNREACHABLE_ON_SANDBOX',
  /**
   * Capability probe over P2P: ledger says this process is not the expected receiver (host) or
   * requester (sandbox) for internal_inference_capabilities — not a transport/BEAP-missing error.
   */
  HOST_AI_CAPABILITY_ROLE_REJECTED: 'HOST_AI_CAPABILITY_ROLE_REJECTED',
  /** Capabilities: Host is reachable; no Host-side provider (Ollama, etc.) available for the chosen mode. */
  HOST_PROVIDER_UNAVAILABLE: 'HOST_PROVIDER_UNAVAILABLE',
  /** Sandbox has an internal S→H row but the Host machine has no matching active handshake (asymmetric DB). */
  HOST_AI_LEDGER_ASYMMETRIC: 'HOST_AI_LEDGER_ASYMMETRIC',
  /** Reciprocity proof expired; user must re-link the Host. */
  HOST_AI_PAIRING_STALE: 'HOST_AI_PAIRING_STALE',
} as const

export type InternalInferenceErrorCodeType =
  (typeof InternalInferenceErrorCode)[keyof typeof InternalInferenceErrorCode]
