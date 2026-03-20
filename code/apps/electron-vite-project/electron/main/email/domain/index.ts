/**
 * Email domain layer — provider identity, mailboxes/sync targets, capabilities.
 *
 * - **UI** (`renderer`, connect-email flow) should not import provider implementations.
 * - **Gateway** uses this module to enrich API responses and to keep concepts explicit.
 */

export * from './accountAggregate'
export * from './accountIdentity'
export * from './accountRowPicker'
export * from './capabilitiesRegistry'
export * from './mailboxResolution'
export * from './mailboxSyncPlan'
