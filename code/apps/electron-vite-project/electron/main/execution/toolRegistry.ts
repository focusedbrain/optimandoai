/**
 * Tool Registry
 *
 * Maps tool names to their handler functions. Handlers are registered here
 * but MUST NOT be called directly — all invocations go through
 * executeToolRequest() which enforces authorization first.
 */

import type { ToolHandler } from './types'

const registry: Record<string, ToolHandler> = {}

export function registerTool(name: string, handler: ToolHandler): void {
  if (registry[name]) {
    throw new Error(`Tool "${name}" is already registered`)
  }
  registry[name] = handler
}

export function getToolHandler(name: string): ToolHandler | undefined {
  return registry[name]
}

export function hasToolHandler(name: string): boolean {
  return name in registry
}

export function listRegisteredTools(): readonly string[] {
  return Object.keys(registry)
}

/**
 * Reset for testing only. Not exported from the public barrel.
 */
export function _resetRegistryForTesting(): void {
  for (const key of Object.keys(registry)) {
    delete registry[key]
  }
}
