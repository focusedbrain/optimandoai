/**
 * Shared opaque sealed service-RPC capsule marker (Phase A relay transport).
 *
 * Single type on the wire — relay and egress classifiers see ONLY this string;
 * inner service-RPC types live inside E2E ciphertext (see sealedServiceRpc in app).
 *
 * Keep in sync with:
 *   - packages/coordination-service/src/server.ts RELAY_ALLOWED_TYPES
 *   - apps/electron-vite-project/electron/main/handshake/p2pTransport.ts
 *   - sandboxEgressClassification SANDBOX_OUTBOUND_ALLOWED_TYPES (sandbox may emit)
 */

export const SEALED_SERVICE_RPC_CAPSULE_TYPE = 'sealed_service_rpc_v1' as const;

export type SealedServiceRpcCapsuleType = typeof SEALED_SERVICE_RPC_CAPSULE_TYPE;
