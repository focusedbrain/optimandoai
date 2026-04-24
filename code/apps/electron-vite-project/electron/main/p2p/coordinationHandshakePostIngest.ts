/**
 * Coordination WebSocket push path — post-`processHandshakeCapsule` hook for inbound accept.
 * Re-exports the same helper used by relay pull, ingestion RPC/HTTP, and P2P ingest so all
 * transports stay aligned (see regression: postAcceptContextSync.ingestPaths.regression.test.ts).
 */

export { maybeEnqueueInitialContextSyncAfterInboundAccept } from '../handshake/contextSyncEnqueue'
