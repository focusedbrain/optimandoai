import { Pool, PoolClient } from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Run migrations to ensure kv_store table exists
 */
export async function runMigrations(pool: Pool): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Read and execute migration SQL
    const migrationSQL = readFileSync(
      join(__dirname, 'migrations', '001_kv_store.sql'),
      'utf-8'
    );
    
    await client.query(migrationSQL);
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



