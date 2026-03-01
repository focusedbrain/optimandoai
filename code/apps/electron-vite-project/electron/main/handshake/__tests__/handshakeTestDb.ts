/**
 * Handshake Pipeline Test Database
 *
 * A complete in-memory mock that handles all SQL used by the handshake DB layer
 * plus the ingestion audit/quarantine layer. Uses JavaScript Maps/Sets for
 * storage and regex-based SQL dispatch to avoid the native better-sqlite3 module.
 *
 * Covers:
 *   - handshakes (INSERT, UPDATE, SELECT by id, SELECT all, SELECT by state)
 *   - seen_capsule_hashes (INSERT, SELECT all for handshake)
 *   - context_block_versions (SELECT)
 *   - context_blocks (no-op for happy path)
 *   - audit_log (INSERT)
 *   - ingestion_audit_log (INSERT)
 *   - ingestion_quarantine (INSERT OR IGNORE)
 *   - sandbox_queue (INSERT OR IGNORE)
 *   - handshake_schema_migrations (INSERT OR REPLACE, SELECT)
 *   - ingestion_schema_migrations (INSERT, SELECT)
 */

export function createHandshakeTestDb() {
  const handshakes = new Map<string, any>()
  const seenHashes = new Map<string, Set<string>>() // handshake_id → Set<hash>
  const auditLog: any[] = []
  const ingestionAuditLog: any[] = []
  const quarantine: any[] = []
  const sandboxQueue: any[] = []
  const contextBlockVersions = new Map<string, number>() // `${sender}:${blockId}` → version
  const migrations = new Set<number>()
  const ingestionMigrations = new Set<number>()

  function prepare(sql: string) {
    return {
      run(...positional: any[]) {
        // Named-parameter call: single object arg
        const args = positional.length === 1 && typeof positional[0] === 'object' && positional[0] !== null && !Array.isArray(positional[0])
          ? positional[0]
          : null
        const pos = args ? [] : positional

        // INSERT INTO handshakes
        if (/INSERT INTO handshakes/i.test(sql)) {
          if (!args) return { changes: 0 }
          handshakes.set(args.handshake_id, { ...args })
          return { changes: 1 }
        }

        // UPDATE handshakes
        if (/UPDATE handshakes/i.test(sql)) {
          if (!args) return { changes: 0 }
          const existing = handshakes.get(args.handshake_id)
          if (existing) handshakes.set(args.handshake_id, { ...existing, ...args })
          return { changes: existing ? 1 : 0 }
        }

        // INSERT INTO seen_capsule_hashes
        if (/INSERT.*seen_capsule_hashes/i.test(sql)) {
          const hid = pos[0] ?? args?.handshake_id
          const hash = pos[1] ?? args?.capsule_hash
          if (hid && hash) {
            if (!seenHashes.has(hid)) seenHashes.set(hid, new Set())
            seenHashes.get(hid)!.add(hash)
          }
          return { changes: 1 }
        }

        // INSERT INTO audit_log
        if (/INSERT INTO audit_log/i.test(sql)) {
          auditLog.push({ sql, args: args ?? pos })
          return { changes: 1 }
        }

        // INSERT INTO ingestion_audit_log
        if (/INSERT INTO ingestion_audit_log/i.test(sql)) {
          ingestionAuditLog.push({ args: args ?? pos })
          return { changes: 1 }
        }

        // INSERT OR IGNORE INTO ingestion_quarantine
        if (/INSERT.*ingestion_quarantine/i.test(sql)) {
          quarantine.push({ args: args ?? pos })
          return { changes: 1 }
        }

        // INSERT OR IGNORE INTO sandbox_queue
        if (/INSERT.*sandbox_queue/i.test(sql)) {
          sandboxQueue.push({ args: args ?? pos })
          return { changes: 1 }
        }

        // INSERT OR REPLACE INTO handshake_schema_migrations
        if (/INSERT.*handshake_schema_migrations/i.test(sql)) {
          const v = pos[0] ?? (args as any)?.version
          if (v != null) migrations.add(Number(v))
          return { changes: 1 }
        }

        // INSERT INTO ingestion_schema_migrations
        if (/INSERT.*ingestion_schema_migrations/i.test(sql)) {
          const v = pos[0]
          if (v != null) ingestionMigrations.add(Number(v))
          return { changes: 1 }
        }

        // CREATE TABLE / CREATE INDEX — no-op
        if (/CREATE TABLE|CREATE.*INDEX/i.test(sql)) {
          return { changes: 0 }
        }

        return { changes: 0 }
      },

      get(...positional: any[]) {
        const pos = positional

        // SELECT handshake by id
        if (/SELECT.*FROM handshakes.*WHERE handshake_id/i.test(sql)) {
          return handshakes.get(pos[0]) ?? undefined
        }

        // SELECT from seen_capsule_hashes (individual)
        if (/seen_capsule_hashes.*WHERE handshake_id/i.test(sql)) {
          const set = seenHashes.get(pos[0])
          if (!set) return undefined
          return set.has(pos[1]) ? { handshake_id: pos[0], capsule_hash: pos[1] } : undefined
        }

        // SELECT handshake_schema_migrations
        if (/handshake_schema_migrations.*WHERE version/i.test(sql)) {
          return migrations.has(Number(pos[0])) ? { version: pos[0] } : undefined
        }

        // SELECT ingestion_schema_migrations
        if (/ingestion_schema_migrations.*WHERE version/i.test(sql)) {
          return ingestionMigrations.has(Number(pos[0])) ? { version: pos[0] } : undefined
        }

        return undefined
      },

      all(...positional: any[]) {
        const pos = positional

        // SELECT * FROM handshakes WHERE state IN (...)
        if (/FROM handshakes.*state IN/i.test(sql)) {
          return Array.from(handshakes.values()).filter(r =>
            ['PENDING_ACCEPT', 'ACTIVE'].includes(r.state)
          )
        }

        // SELECT * FROM handshakes (with optional filters)
        if (/FROM handshakes/i.test(sql)) {
          let rows = Array.from(handshakes.values())
          if (sql.includes('state = ?') && pos[0]) rows = rows.filter(r => r.state === pos[0])
          if (sql.includes('relationship_id = ?')) {
            const idx = sql.includes('state = ?') ? 1 : 0
            if (pos[idx]) rows = rows.filter(r => r.relationship_id === pos[idx])
          }
          return rows
        }

        // SELECT seen hashes for a handshake
        if (/FROM seen_capsule_hashes.*WHERE handshake_id/i.test(sql)) {
          const set = seenHashes.get(pos[0]) ?? new Set<string>()
          return Array.from(set).map(h => ({ handshake_id: pos[0], capsule_hash: h }))
        }

        // SELECT context_block_versions
        if (/FROM context_block_versions/i.test(sql)) {
          return Array.from(contextBlockVersions.entries()).map(([key, last_version]) => {
            const [sender_wrdesk_user_id, block_id] = key.split(':')
            return { sender_wrdesk_user_id, block_id, last_version }
          })
        }

        // SELECT context_blocks
        if (/FROM context_blocks/i.test(sql)) {
          return []
        }

        return []
      },
    }
  }

  return {
    prepare,
    transaction(fn: any) {
      return (...args: any[]) => fn(...args)
    },
    // Introspection for assertions
    getHandshakes: () => Array.from(handshakes.values()),
    getHandshake: (id: string) => handshakes.get(id),
    getAuditLog: () => auditLog,
    getIngestionAuditLog: () => ingestionAuditLog,
    getQuarantine: () => quarantine,
    getSandboxQueue: () => sandboxQueue,
  }
}

export type HandshakeTestDb = ReturnType<typeof createHandshakeTestDb>
