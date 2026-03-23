/**
 * Test Database
 *
 * In-memory mock that implements the subset of better-sqlite3 API used by
 * the ingestion persistence layer. Supports CREATE TABLE, INSERT, SELECT,
 * UPDATE with basic SQL parsing for test assertions.
 *
 * Provides row-level introspection for E2E assertions (audit log, quarantine,
 * sandbox queue).
 */

export interface TestDb {
  prepare(sql: string): TestStatement;
  transaction(fn: any): any;
  _tables: Record<string, any[]>;
  _idCounters: Record<string, number>;
  getAuditRows(): any[];
  getQuarantineRows(): any[];
  getSandboxQueueRows(): any[];
}

interface TestStatement {
  run(...args: any[]): any;
  get(...args: any[]): any;
  all(...args: any[]): any[];
}

export function createTestDb(): TestDb {
  const tables: Record<string, any[]> = {}
  const idCounters: Record<string, number> = {}
  const uniqueIndexes: Record<string, Set<string>> = {}

  function getOrCreateTable(name: string): any[] {
    if (!tables[name]) tables[name] = []
    return tables[name]
  }

  function getNextId(table: string): number {
    if (!idCounters[table]) idCounters[table] = 0
    return ++idCounters[table]
  }

  const db: TestDb = {
    _tables: tables,
    _idCounters: idCounters,

    prepare(sql: string): TestStatement {
      return {
        run(...args: any[]) {
          // CREATE TABLE
          if (sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/i)) {
            const match = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/i)!
            getOrCreateTable(match[1])
            return { changes: 0 }
          }

          // CREATE INDEX (track unique indexes)
          if (sql.match(/CREATE UNIQUE INDEX/i)) {
            const tableMatch = sql.match(/ON\s+(\w+)\((\w+)\)/i)
            if (tableMatch) {
              const key = `${tableMatch[1]}_${tableMatch[2]}`
              if (!uniqueIndexes[key]) uniqueIndexes[key] = new Set()
            }
            return { changes: 0 }
          }

          if (sql.match(/CREATE INDEX/i)) {
            return { changes: 0 }
          }

          // INSERT OR IGNORE
          if (sql.match(/INSERT OR IGNORE INTO (\w+)/i)) {
            const match = sql.match(/INSERT OR IGNORE INTO (\w+)/i)!
            const tableName = match[1]
            const table = getOrCreateTable(tableName)

            // Check unique constraint on raw_input_hash (first arg)
            const hashCol = `${tableName}_raw_input_hash`
            if (uniqueIndexes[hashCol] || tableName === 'ingestion_quarantine' || tableName === 'sandbox_queue') {
              const hashValue = args[0]
              if (!uniqueIndexes[hashCol]) uniqueIndexes[hashCol] = new Set()
              if (uniqueIndexes[hashCol].has(hashValue)) {
                return { changes: 0 }
              }
              uniqueIndexes[hashCol].add(hashValue)
            }

            const row: any = { id: getNextId(tableName) }
            if (tableName === 'ingestion_quarantine') {
              row.raw_input_hash = args[0]
              row.source_type = args[1]
              row.origin_classification = args[2]
              row.input_classification = args[3]
              row.validation_reason_code = args[4]
              row.validation_details = args[5]
              row.provenance_json = args[6]
              row.created_at = args[7]
            } else if (tableName === 'sandbox_queue') {
              row.raw_input_hash = args[0]
              row.validated_capsule_json = args[1]
              row.routing_reason = args[2]
              row.status = 'queued'
              row.created_at = args[3]
              row.updated_at = args[4]
              row.retry_count = 0
            }
            table.push(row)
            return { changes: 1 }
          }

          // INSERT INTO (non-ignore — audit_log, ingestion_audit_log, migrations)
          if (sql.match(/INSERT INTO (\w+)/i)) {
            const match = sql.match(/INSERT INTO (\w+)/i)!
            const tableName = match[1]
            const table = getOrCreateTable(tableName)

            const row: any = { id: getNextId(tableName) }
            if (tableName === 'ingestion_audit_log') {
              row.timestamp = args[0]
              row.raw_input_hash = args[1]
              row.source_type = args[2]
              row.origin_classification = args[3]
              row.input_classification = args[4]
              row.validation_result = args[5]
              row.validation_reason_code = args[6]
              row.distribution_target = args[7]
              row.processing_duration_ms = args[8]
              row.pipeline_version = args[9]
            } else if (tableName === 'audit_log') {
              row.timestamp = args[0]
              row.action = args[1]
              row.handshake_id = args[2]
              row.capsule_type = args[3]
              row.reason_code = args[4]
              row.failed_step = args[5]
              row.pipeline_duration_ms = args[6]
              row.actor_wrdesk_user_id = args[7]
              row.metadata = args[8]
            } else if (tableName === 'ingestion_schema_migrations') {
              row.version = args[0]
              row.applied_at = args[1]
              row.description = args[2]
            }
            table.push(row)
            return { changes: 1 }
          }

          // UPDATE
          if (sql.match(/UPDATE (\w+)/i)) {
            const match = sql.match(/UPDATE (\w+)/i)!
            const table = getOrCreateTable(match[1])
            if (sql.includes('sandbox_queue') && sql.includes('SET status')) {
              const item = table.find(r => r.id === args[2])
              if (item) {
                item.status = args[0]
                item.updated_at = args[1]
              }
            }
            return { changes: 1 }
          }

          return { changes: 0 }
        },

        get(...args: any[]) {
          // SELECT for migrations check
          if (sql.includes('ingestion_schema_migrations') && sql.includes('WHERE version')) {
            const table = tables['ingestion_schema_migrations'] ?? []
            return table.find(r => r.version === args[0])
          }

          // SELECT COUNT
          if (sql.includes('COUNT(*)')) {
            const tableMatch = sql.match(/FROM\s+(\w+)/i)
            if (tableMatch) {
              const table = tables[tableMatch[1]] ?? []
              if (sql.includes('WHERE status =')) {
                return { count: table.filter(r => r.status === args[0]).length }
              }
              return { count: table.length }
            }
            return { count: 0 }
          }

          // SELECT handshakes
          if (sql.includes('handshakes') && sql.includes('handshake_id') && args.length > 0) {
            const table = tables['handshakes'] ?? []
            return table.find(r => r.handshake_id === args[0])
          }

          return undefined
        },

        all(...args: any[]) {
          const tableMatch = sql.match(/FROM\s+(\w+)/i)
          if (!tableMatch) return []
          const table = tables[tableMatch[1]] ?? []

          if (sql.includes('WHERE status =') && args.length > 0) {
            const limit = args[1] ?? 100
            return table.filter(r => r.status === args[0]).slice(0, limit)
          }

          if (sql.includes('ORDER BY')) {
            const limit = args[0] ?? 100
            return table.slice(0, limit)
          }

          return table
        },
      }
    },

    transaction(fn: any) {
      return (...args: any[]) => fn(...args)
    },

    getAuditRows() {
      return tables['ingestion_audit_log'] ?? []
    },

    getQuarantineRows() {
      return tables['ingestion_quarantine'] ?? []
    },

    getSandboxQueueRows() {
      return tables['sandbox_queue'] ?? []
    },
  }

  return db
}
