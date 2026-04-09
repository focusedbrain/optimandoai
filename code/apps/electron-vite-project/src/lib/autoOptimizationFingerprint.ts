/**
 * Fingerprints auto-optimization inputs so interval ticks can skip LLM when nothing changed.
 */

import { useProjectStore } from '../stores/useProjectStore'
import type { DomSnapshot } from '../types/optimizationTypes'

export interface OptimizationFingerprint {
  projectUpdatedAt: string
  milestoneHash: string
  attachmentHash: string
  sidebarMessageCount: number
  sidebarLastAt: string | null
  domSlotHash: string | null
}

function quickHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0 // Convert to 32bit integer
  }
  return hash.toString(36)
}

let lastFingerprint: OptimizationFingerprint | null = null
let lastProjectId: string | null = null

export function getLastFingerprint(): OptimizationFingerprint | null {
  return lastFingerprint
}

export function setLastFingerprint(fp: OptimizationFingerprint, projectId: string): void {
  lastFingerprint = fp
  lastProjectId = projectId
}

export function clearLastFingerprint(): void {
  lastFingerprint = null
  lastProjectId = null
}

/**
 * Project-derived fingerprint parts — reads fresh from the store by id (not a stale closure).
 */
export function computeProjectFingerprint(projectId: string): Partial<OptimizationFingerprint> {
  const project = useProjectStore.getState().projects.find((p) => p.id === projectId)
  if (!project) {
    return {}
  }

  const milestonePayload = project.milestones.map((m) => ({
    id: m.id,
    title: m.title,
    description: m.description ?? '',
    completed: m.completed,
    isActive: m.isActive,
  }))

  const attachmentPayload = project.attachments.map((a) => ({
    id: a.id,
    parseStatus: a.parseStatus ?? null,
  }))

  return {
    projectUpdatedAt: project.updatedAt,
    milestoneHash: quickHash(JSON.stringify(milestonePayload)),
    attachmentHash: quickHash(JSON.stringify(attachmentPayload)),
  }
}

/**
 * Sidebar transcript metadata from orchestrator session JSON (WR Chat focused mode).
 */
export function computeSidebarFingerprint(sessionJson: unknown): Partial<OptimizationFingerprint> {
  const meta = (sessionJson as { metadata?: Record<string, unknown> } | null | undefined)?.metadata
  const log = meta?.optimizationSidebarChatLog
  if (!Array.isArray(log) || log.length === 0) {
    return {
      sidebarMessageCount: 0,
      sidebarLastAt: null,
    }
  }

  const last = log[log.length - 1] as { at?: string } | undefined
  const lastAt = typeof last?.at === 'string' && last.at.trim() ? last.at : null

  return {
    sidebarMessageCount: log.length,
    sidebarLastAt: lastAt,
  }
}

/**
 * DOM grid capture fingerprint — ignores capturedAt (changes every capture).
 */
export function computeDomFingerprint(dom: DomSnapshot | null): Partial<OptimizationFingerprint> {
  if (dom == null) {
    return { domSlotHash: null }
  }
  const body = dom.slots.map((s) => `${s.textDigest}|${s.status}`).join('\n')
  return {
    domSlotHash: quickHash(body),
  }
}

/** Full fingerprint for comparison / storage (merges project + sidebar + DOM partials). */
export function mergeOptimizationFingerprint(
  projectId: string,
  sessionJson: unknown,
  dom: DomSnapshot | null,
): OptimizationFingerprint {
  const p = computeProjectFingerprint(projectId)
  const s = computeSidebarFingerprint(sessionJson)
  const d = computeDomFingerprint(dom)
  return {
    projectUpdatedAt: p.projectUpdatedAt ?? '',
    milestoneHash: p.milestoneHash ?? '',
    attachmentHash: p.attachmentHash ?? '',
    sidebarMessageCount: s.sidebarMessageCount ?? 0,
    sidebarLastAt: s.sidebarLastAt ?? null,
    domSlotHash: d.domSlotHash ?? null,
  }
}

export function fingerprintsMatch(a: OptimizationFingerprint, b: OptimizationFingerprint): boolean {
  if (a.projectUpdatedAt !== b.projectUpdatedAt) return false
  if (a.milestoneHash !== b.milestoneHash) return false
  if (a.attachmentHash !== b.attachmentHash) return false
  if (a.sidebarMessageCount !== b.sidebarMessageCount) return false
  if (a.sidebarLastAt !== b.sidebarLastAt) return false
  if (a.domSlotHash !== b.domSlotHash) return false
  return true
}
