/**
 * Execution Domain Schema
 * 
 * Defines execution capabilities: automation, connectors, filesystem access.
 * Deny by default: empty arrays = nothing allowed.
 */

import { z } from 'zod'

/**
 * Connector types that can be invoked
 */
export const ConnectorTypeSchema = z.enum([
  'api_rest',           // REST API calls
  'api_graphql',        // GraphQL queries
  'database_read',      // Database reads
  'database_write',     // Database writes
  'email_send',         // Send emails
  'email_read',         // Read emails
  'calendar_read',      // Read calendar
  'calendar_write',     // Write calendar
  'storage_read',       // Cloud storage read
  'storage_write',      // Cloud storage write
  'messaging',          // Chat/messaging platforms
  'custom',             // Custom connectors
])

export type ConnectorType = z.infer<typeof ConnectorTypeSchema>

/**
 * Automation capabilities
 */
export const AutomationCapabilitySchema = z.enum([
  'scheduled_tasks',    // Run on schedule
  'triggered_tasks',    // Run on trigger
  'batch_processing',   // Process in batches
  'workflow_steps',     // Multi-step workflows
  'conditional_logic',  // If/else conditions
  'loops',              // Loop execution
  'parallel_execution', // Run tasks in parallel
  'background_tasks',   // Run in background
])

export type AutomationCapability = z.infer<typeof AutomationCapabilitySchema>

/**
 * Filesystem operation types
 */
export const FilesystemOperationSchema = z.enum([
  'read_local',         // Read local files
  'write_local',        // Write local files
  'delete_local',       // Delete local files
  'read_temp',          // Read temp files
  'write_temp',         // Write temp files
  'list_directory',     // List directory contents
])

export type FilesystemOperation = z.infer<typeof FilesystemOperationSchema>

/**
 * Execution Policy Schema
 */
export const ExecutionPolicySchema = z.object({
  // Allowed connectors (empty = deny all)
  allowedConnectors: z.array(ConnectorTypeSchema).default([]),
  
  // Blocked connector patterns
  blockedConnectors: z.array(z.string()).default([]),
  
  // Allowed automation capabilities
  allowedAutomation: z.array(AutomationCapabilitySchema).default([]),
  
  // Allowed filesystem operations
  allowedFilesystem: z.array(FilesystemOperationSchema).default([]),
  
  // Maximum execution time in seconds
  maxExecutionTimeSeconds: z.number().int().positive().default(30),
  
  // Maximum concurrent executions
  maxConcurrentExecutions: z.number().int().positive().default(5),
  
  // Allow code execution (HIGH RISK)
  allowCodeExecution: z.boolean().default(false),
  
  // Allow shell commands (HIGH RISK)
  allowShellCommands: z.boolean().default(false),
  
  // Require approval for executions
  requireApproval: z.boolean().default(true),
  
  // Sandbox execution
  sandboxExecution: z.boolean().default(true),
  
  // Log all executions
  auditAllExecutions: z.boolean().default(true),
  
  // Rate limit: max executions per hour
  maxExecutionsPerHour: z.number().int().positive().default(100),
})

export type ExecutionPolicy = z.infer<typeof ExecutionPolicySchema>

/**
 * Default restrictive execution policy
 */
export const DEFAULT_EXECUTION_POLICY: ExecutionPolicy = {
  allowedConnectors: [],
  blockedConnectors: [],
  allowedAutomation: [],
  allowedFilesystem: ['read_temp'],
  maxExecutionTimeSeconds: 30,
  maxConcurrentExecutions: 5,
  allowCodeExecution: false,
  allowShellCommands: false,
  requireApproval: true,
  sandboxExecution: true,
  auditAllExecutions: true,
  maxExecutionsPerHour: 100,
}


