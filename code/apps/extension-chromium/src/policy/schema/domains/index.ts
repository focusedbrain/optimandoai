/**
 * Policy Domains Index
 * 
 * Re-exports all domain schemas for the canonical policy model.
 * 
 * BEAP-ALIGNED STRUCTURE:
 * - channels.ts: What doors exist (BEAP, webhooks, filesystem)
 * - pre-verification.ts: DoS protection before BEAP verification
 * - derivations.ts: What can be derived AFTER BEAP verification
 * - egress.ts: What can go OUT
 * - execution.ts: Automation capabilities
 * - vault-access.ts: WRVault access
 * - identity.ts: Identity/privacy
 * 
 * DEPRECATED: ingress.ts (replaced by channels + pre-verification + derivations)
 */

// BEAP-aligned ingress domains (replaces old ingress.ts)
export * from './channels'
export * from './pre-verification'
export * from './derivations'

// Automation risk classification
export * from './automation-risk'

// Session restrictions (during automation)
export * from './session-restrictions'

// Per-handshake policy overrides
export * from './handshake-overrides'

// Other domains (unchanged)
export * from './egress'
export * from './execution'
export * from './vault-access'
export * from './identity'

// Legacy ingress (deprecated, kept for migration)
export * from './ingress'
