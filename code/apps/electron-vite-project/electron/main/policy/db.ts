/**
 * Policy Database Persistence
 * 
 * SQLite-based persistence for policy data.
 */

import Database from 'better-sqlite3'
import * as path from 'path'
import * as fs from 'fs'
import { app } from 'electron'
import type { AdminPolicyPackage, PolicyNode } from './types'

let db: Database.Database | null = null

/**
 * Get the database path
 */
function getDbPath(): string {
  const userDataPath = app.getPath('userData')
  const dbDir = path.join(userDataPath, 'policy')
  
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }
  
  return path.join(dbDir, 'policy.db')
}

/**
 * Initialize the policy database
 */
export function initPolicyDb(): void {
  if (db) return
  
  const dbPath = getDbPath()
  db = new Database(dbPath)
  
  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_policies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      layer TEXT NOT NULL,
      version TEXT NOT NULL,
      policy_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      is_active INTEGER DEFAULT 1
    );
    
    CREATE TABLE IF NOT EXISTS network_policies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      policy_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      is_active INTEGER DEFAULT 1
    );
    
    CREATE TABLE IF NOT EXISTS admin_packages (
      id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      policy_payload TEXT NOT NULL,
      effective_date INTEGER NOT NULL,
      hash_sha256 TEXT NOT NULL,
      signature TEXT,
      metadata_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      applied_at INTEGER
    );
    
    CREATE TABLE IF NOT EXISTS policy_nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      groups_json TEXT NOT NULL,
      last_seen INTEGER NOT NULL,
      policy_version TEXT,
      sync_status_json TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS handshake_policies (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL,
      name TEXT NOT NULL,
      policy_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      is_active INTEGER DEFAULT 1
    );
    
    CREATE TABLE IF NOT EXISTS consent_grants (
      id TEXT PRIMARY KEY,
      capsule_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      denials_json TEXT NOT NULL,
      scope TEXT NOT NULL,
      granted_at INTEGER NOT NULL,
      expires_at INTEGER,
      revoked_at INTEGER
    );
    
    CREATE INDEX IF NOT EXISTS idx_consent_sender ON consent_grants(sender_id);
    CREATE INDEX IF NOT EXISTS idx_consent_capsule ON consent_grants(capsule_id);
    CREATE INDEX IF NOT EXISTS idx_handshake_sender ON handshake_policies(sender_id);
  `)
  
  console.log('[PolicyDB] Initialized at', dbPath)
}

/**
 * Close the database
 */
export function closePolicyDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

/**
 * Save local policy
 */
export function saveLocalPolicy(policy: any): void {
  if (!db) initPolicyDb()
  
  const stmt = db!.prepare(`
    INSERT OR REPLACE INTO local_policies 
    (id, name, layer, version, policy_json, created_at, updated_at, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  
  stmt.run(
    policy.id,
    policy.name,
    policy.layer,
    policy.version,
    JSON.stringify(policy),
    policy.createdAt,
    policy.updatedAt,
    policy.isActive ? 1 : 0
  )
}

/**
 * Get active local policy
 */
export function getActiveLocalPolicy(): any {
  if (!db) initPolicyDb()
  
  const row = db!.prepare(`
    SELECT policy_json FROM local_policies 
    WHERE is_active = 1 
    ORDER BY updated_at DESC 
    LIMIT 1
  `).get() as { policy_json: string } | undefined
  
  return row ? JSON.parse(row.policy_json) : null
}

/**
 * Save admin package
 */
export function saveAdminPackage(pkg: AdminPolicyPackage): void {
  if (!db) initPolicyDb()
  
  const stmt = db!.prepare(`
    INSERT OR REPLACE INTO admin_packages 
    (id, version, policy_payload, effective_date, hash_sha256, signature, metadata_json, created_at, applied_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  
  stmt.run(
    pkg.id,
    pkg.version,
    pkg.policyPayload,
    pkg.effectiveDate,
    pkg.hashes.sha256,
    pkg.signatureMetadata?.signature || null,
    JSON.stringify(pkg.metadata),
    pkg.metadata.createdAt,
    Date.now()
  )
}

/**
 * Get all admin packages
 */
export function getAllAdminPackages(): AdminPolicyPackage[] {
  if (!db) initPolicyDb()
  
  const rows = db!.prepare(`
    SELECT * FROM admin_packages ORDER BY created_at DESC
  `).all() as any[]
  
  return rows.map(row => ({
    id: row.id,
    version: row.version,
    targetSelectors: { all: true }, // Simplified
    policyPayload: row.policy_payload,
    effectiveDate: row.effective_date,
    hashes: { sha256: row.hash_sha256 },
    signatureMetadata: row.signature ? {
      algorithm: 'RS256',
      keyId: 'unknown',
      signature: row.signature,
    } : undefined,
    metadata: JSON.parse(row.metadata_json),
  }))
}

/**
 * Save policy node
 */
export function savePolicyNode(node: PolicyNode): void {
  if (!db) initPolicyDb()
  
  const stmt = db!.prepare(`
    INSERT OR REPLACE INTO policy_nodes 
    (id, name, groups_json, last_seen, policy_version, sync_status_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  
  stmt.run(
    node.id,
    node.name,
    JSON.stringify(node.groups),
    node.lastSeen,
    node.policyVersion,
    JSON.stringify(node.syncStatus)
  )
}

/**
 * Get all policy nodes
 */
export function getAllPolicyNodes(): PolicyNode[] {
  if (!db) initPolicyDb()
  
  const rows = db!.prepare(`SELECT * FROM policy_nodes`).all() as any[]
  
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    groups: JSON.parse(row.groups_json),
    lastSeen: row.last_seen,
    policyVersion: row.policy_version,
    syncStatus: JSON.parse(row.sync_status_json),
  }))
}

/**
 * Save consent grant
 */
export function saveConsentGrant(grant: {
  id: string
  capsuleId: string
  senderId: string
  denials: any[]
  scope: string
  grantedAt: number
  expiresAt?: number
}): void {
  if (!db) initPolicyDb()
  
  const stmt = db!.prepare(`
    INSERT INTO consent_grants 
    (id, capsule_id, sender_id, denials_json, scope, granted_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  
  stmt.run(
    grant.id,
    grant.capsuleId,
    grant.senderId,
    JSON.stringify(grant.denials),
    grant.scope,
    grant.grantedAt,
    grant.expiresAt || null
  )
}

/**
 * Get consent grants for sender
 */
export function getConsentGrantsForSender(senderId: string): any[] {
  if (!db) initPolicyDb()
  
  const rows = db!.prepare(`
    SELECT * FROM consent_grants 
    WHERE sender_id = ? AND revoked_at IS NULL
    ORDER BY granted_at DESC
  `).all(senderId) as any[]
  
  return rows.map(row => ({
    id: row.id,
    capsuleId: row.capsule_id,
    senderId: row.sender_id,
    denials: JSON.parse(row.denials_json),
    scope: row.scope,
    grantedAt: row.granted_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  }))
}

/**
 * Revoke consent grant
 */
export function revokeConsentGrant(grantId: string): void {
  if (!db) initPolicyDb()
  
  db!.prepare(`
    UPDATE consent_grants SET revoked_at = ? WHERE id = ?
  `).run(Date.now(), grantId)
}

