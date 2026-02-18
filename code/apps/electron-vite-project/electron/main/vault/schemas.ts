/**
 * Zod schemas for RPC request/response validation
 */

import { z } from 'zod'

/**
 * Container schemas
 */
export const ContainerTypeSchema = z.enum(['person', 'company'])

export const ContainerSchema = z.object({
  id: z.string(),
  type: ContainerTypeSchema,
  name: z.string().min(1).max(200),
  favorite: z.boolean(),
  created_at: z.number(),
  updated_at: z.number(),
})

export const CreateContainerSchema = z.object({
  type: ContainerTypeSchema,
  name: z.string().min(1).max(200),
  favorite: z.boolean().optional().default(false),
})

export const UpdateContainerSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(200).optional(),
  favorite: z.boolean().optional(),
})

/**
 * Field schemas
 */
export const FieldTypeSchema = z.enum(['text', 'password', 'email', 'url', 'number', 'textarea'])

export const FieldSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string(),
  encrypted: z.boolean(),
  type: FieldTypeSchema,
  explanation: z.string().optional(),
})

/**
 * Item schemas
 */
export const ItemCategorySchema = z.enum(['password', 'identity', 'company', 'custom'])

export const VaultItemSchema = z.object({
  id: z.string(),
  container_id: z.string().optional(),
  category: ItemCategorySchema,
  title: z.string().min(1).max(200),
  fields: z.array(FieldSchema),
  domain: z.string().optional(),
  favorite: z.boolean(),
  created_at: z.number(),
  updated_at: z.number(),
})

export const CreateItemSchema = z.object({
  container_id: z.string().optional(),
  category: ItemCategorySchema,
  title: z.string().min(1).max(200),
  fields: z.array(FieldSchema),
  domain: z.string().optional(),
  favorite: z.boolean().optional().default(false),
})

export const UpdateItemSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200).optional(),
  fields: z.array(FieldSchema).optional(),
  domain: z.string().optional(),
  favorite: z.boolean().optional(),
})

/**
 * RPC Request schemas
 */
export const CreateVaultRequestSchema = z.object({
  masterPassword: z.string().min(8).max(128),
  vaultName: z.string().min(1).max(200).optional(),
  vaultId: z.string().optional(),
})

export const UnlockVaultRequestSchema = z.object({
  masterPassword: z.string(),
  vaultId: z.string().optional(),
})

export const GetItemRequestSchema = z.object({
  id: z.string(),
})

export const ListItemsRequestSchema = z.object({
  container_id: z.string().optional(),
  category: ItemCategorySchema.optional(),
  favorites_only: z.boolean().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
})

export const DeleteItemRequestSchema = z.object({
  id: z.string(),
})

export const DeleteContainerRequestSchema = z.object({
  id: z.string(),
})

export const SearchRequestSchema = z.object({
  query: z.string().min(1),
  category: ItemCategorySchema.optional(),
})

export const GetAutofillCandidatesRequestSchema = z.object({
  domain: z.string().min(1),
})

export const AutofillSectionsSchema = z.object({
  login: z.boolean().optional(),
  identity: z.boolean().optional(),
  company: z.boolean().optional(),
  custom: z.boolean().optional(),
})

/** HA Mode state schema — validated at RPC boundary. */
export const HAStateSchema = z.enum(['off', 'active', 'locked'])

export const HAModeStateSchema = z.object({
  state: HAStateSchema,
  activatedAt: z.number().nullable(),
  activatedBy: z.string().nullable(),
  lockCodeHash: z.string().nullable(),
  failedUnlockAttempts: z.number().int().min(0),
  lastFailedUnlockAt: z.number().nullable(),
})

export const UpdateSettingsRequestSchema = z.object({
  autoLockMinutes: z.number().min(0).optional(),
  autofillEnabled: z.boolean().optional(),
  autofillSections: AutofillSectionsSchema.optional(),
})

/** RPC request for HA mode activation. */
export const ActivateHARequestSchema = z.object({
  activatedBy: z.string().min(1).max(200),
})

/** RPC request for HA mode deactivation (requires confirmation phrase). */
export const DeactivateHARequestSchema = z.object({
  confirmPhrase: z.string(),
})

/** RPC request for locking HA mode with an admin code. */
export const LockHARequestSchema = z.object({
  lockCodeHash: z.string().length(64), // SHA-256 hex
})

/** RPC request for unlocking HA mode. */
export const UnlockHARequestSchema = z.object({
  codeHash: z.string().length(64), // SHA-256 hex
})

export const ImportCSVRequestSchema = z.object({
  csvData: z.string(),
})

/**
 * RPC Response schemas
 */
export const VaultStatusSchema = z.object({
  exists: z.boolean(),
  locked: z.boolean(),
  autoLockMinutes: z.number(),
})

export const SuccessResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
})

export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
})

export const ListContainersResponseSchema = z.object({
  success: z.literal(true),
  containers: z.array(ContainerSchema),
})

export const ListItemsResponseSchema = z.object({
  success: z.literal(true),
  items: z.array(VaultItemSchema),
})

export const GetItemResponseSchema = z.object({
  success: z.literal(true),
  item: VaultItemSchema,
})

export const ExportCSVResponseSchema = z.object({
  success: z.literal(true),
  csv: z.string(),
})

export const GetStatusResponseSchema = z.object({
  success: z.literal(true),
  status: VaultStatusSchema,
})

/**
 * Type exports from schemas
 */
export type CreateVaultRequest = z.infer<typeof CreateVaultRequestSchema>
export type UnlockVaultRequest = z.infer<typeof UnlockVaultRequestSchema>
export type CreateContainerRequest = z.infer<typeof CreateContainerSchema>
export type UpdateContainerRequest = z.infer<typeof UpdateContainerSchema>
export type CreateItemRequest = z.infer<typeof CreateItemSchema>
export type UpdateItemRequest = z.infer<typeof UpdateItemSchema>
export type GetItemRequest = z.infer<typeof GetItemRequestSchema>
export type ListItemsRequest = z.infer<typeof ListItemsRequestSchema>
export type DeleteItemRequest = z.infer<typeof DeleteItemRequestSchema>
export type DeleteContainerRequest = z.infer<typeof DeleteContainerRequestSchema>
export type SearchRequest = z.infer<typeof SearchRequestSchema>
export type GetAutofillCandidatesRequest = z.infer<typeof GetAutofillCandidatesRequestSchema>
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequestSchema>
export type ImportCSVRequest = z.infer<typeof ImportCSVRequestSchema>
export type ActivateHARequest = z.infer<typeof ActivateHARequestSchema>
export type DeactivateHARequest = z.infer<typeof DeactivateHARequestSchema>
export type LockHARequest = z.infer<typeof LockHARequestSchema>
export type UnlockHARequest = z.infer<typeof UnlockHARequestSchema>

