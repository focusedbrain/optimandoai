import { Pool, PoolClient } from 'pg';

/**
 * Inlined migration SQL to avoid file system issues in packaged app
 */
const MIGRATION_001_KV_STORE = `
-- Key-Value Store Schema for Chrome Storage API compatibility
-- This table stores data in a simple key-value format with JSON values

-- Drop existing objects if they exist (clean slate)
DROP TRIGGER IF EXISTS update_kv_store_updated_at ON kv_store;
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
DROP INDEX IF EXISTS idx_kv_store_created_at;
DROP INDEX IF EXISTS idx_kv_store_updated_at;
DROP TABLE IF EXISTS kv_store;

-- Create table with all columns
CREATE TABLE kv_store (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes on the columns
CREATE INDEX idx_kv_store_created_at ON kv_store(created_at);
CREATE INDEX idx_kv_store_updated_at ON kv_store(updated_at);

-- Create function for auto-updating updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to call the function
CREATE TRIGGER update_kv_store_updated_at BEFORE UPDATE ON kv_store
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
`;

/**
 * Run migrations to ensure kv_store table exists
 */
export async function runMigrations(pool: Pool): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Execute migration SQL (now inlined)
    await client.query(MIGRATION_001_KV_STORE);
    await client.query('COMMIT');
    
    console.log('[DB] Migrations completed successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[DB] Migration error:', error);
    throw error;
  } finally {
    client.release();
  }
}



