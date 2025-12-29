/**
 * Domain Editors Index
 * 
 * Visual editors for each policy domain.
 * 
 * BEAP-ALIGNED STRUCTURE:
 * - ChannelsEditor: What doors exist (BEAP, webhooks, filesystem)
 * - PreVerificationEditor: DoS protection before BEAP verification
 * - DerivationsEditor: What can be derived AFTER BEAP verification
 * - EgressEditor: What can go OUT
 * 
 * DEPRECATED: IngressEditor (replaced by Channels + PreVerification + Derivations)
 */

// BEAP-aligned editors (replaces old IngressEditor)
export { ChannelsEditor } from './ChannelsEditor'
export { PreVerificationEditor } from './PreVerificationEditor'
export { DerivationsEditor } from './DerivationsEditor'

// Other editors
export { EgressEditor } from './EgressEditor'

// Legacy (deprecated)
export { IngressEditor } from './IngressEditor'
