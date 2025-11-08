import { Pool, PoolClient } from 'pg';
import type { StorageAdapter } from '@shared/core/storage/StorageAdapter';
import { runMigrations } from './migrations.js';

export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  schema: string;
}

/**
 * PostgreSQL adapter implementation
 * Uses pg library with connection pooling
 */
export class PostgresAdapter implements StorageAdapter {
  private pool: Pool | null = null;
  private config: PostgresConfig;
  private migrationsRun = false;

  constructor(config: PostgresConfig) {
    this.config = config;
  }

  /**
   * Initialize connection pool and run migrations
   */
  async connect(): Promise<void> {
    if (this.pool) {
      return; // Already connected
    }

    const { host, port, database, user, password, ssl, schema } = this.config;

    this.pool = new Pool({
      host,
      port,
      database,
      user,
      password,
      ssl: ssl ? { rejectUnauthorized: false } : false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    // Test connection
    const client = await this.pool.connect();
    try {
      await client.query('SELECT 1');
      
      // Set search path to schema (use identifier quoting for safety)
      await client.query(`SET search_path TO "${schema}"`);
      
      // Run migrations if not already run
      if (!this.migrationsRun) {
        await runMigrations(this.pool);
        this.migrationsRun = true;
      }
    } finally {
      client.release();
    }
  }

  /**
   * Get connection pool, ensuring it's connected
   */
  private async getPool(): Promise<Pool> {
    if (!this.pool) {
      await this.connect();
    }
    if (!this.pool) {
      throw new Error('Failed to establish database connection');
    }
    return this.pool;
  }

  /**
   * Get a value by key
   */
  async get<T = any>(key: string): Promise<T | undefined> {
    const pool = await this.getPool();
    const result = await pool.query(
      'SELECT v FROM kv_store WHERE k = $1',
      [key]
    );
    
    if (result.rows.length === 0) {
      return undefined;
    }
    
    // v is already JSONB, so it's already parsed
    return result.rows[0].v as T;
  }

  /**
   * Set a value by key
   */
  async set<T = any>(key: string, value: T): Promise<void> {
    const pool = await this.getPool();
    // Use JSONB directly - pg will handle the conversion
    await pool.query(
      `INSERT INTO kv_store (k, v, updated_at) 
       VALUES ($1, $2::jsonb, now()) 
       ON CONFLICT (k) 
       DO UPDATE SET v = $2::jsonb, updated_at = now()`,
      [key, JSON.stringify(value)]
    );
  }

  /**
   * Get all key-value pairs
   */
  async getAll(): Promise<Record<string, any>> {
    const pool = await this.getPool();
    const result = await pool.query('SELECT k, v FROM kv_store');
    
    const data: Record<string, any> = {};
    for (const row of result.rows) {
      data[row.k] = row.v;
    }
    
    return data;
  }

  /**
   * Set multiple key-value pairs atomically in a transaction
   */
  async setAll(payload: Record<string, any>): Promise<void> {
    const pool = await this.getPool();
    const client: PoolClient = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      const keys = Object.keys(payload);
      for (const key of keys) {
        await client.query(
          `INSERT INTO kv_store (k, v, updated_at) 
           VALUES ($1, $2::jsonb, now()) 
           ON CONFLICT (k) 
           DO UPDATE SET v = $2::jsonb, updated_at = now()`,
          [key, JSON.stringify(payload[key])]
        );
      }
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Close the connection pool
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.migrationsRun = false;
    }
  }
}

