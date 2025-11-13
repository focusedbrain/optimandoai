/**
 * Storage adapter interface for abstracting storage backends
 */
export interface StorageAdapter {
  /**
   * Get a value by key
   */
  get<T = any>(key: string): Promise<T | undefined>;

  /**
   * Set a value by key
   */
  set<T = any>(key: string, value: T): Promise<void>;

  /**
   * Get all key-value pairs
   */
  getAll(): Promise<Record<string, any>>;

  /**
   * Set multiple key-value pairs atomically
   */
  setAll(payload: Record<string, any>): Promise<void>;
}

/**
 * Result type for adapter operations
 */
export interface AdapterResult<T = any> {
  ok: boolean;
  message?: string;
  details?: T;
  count?: number;
}

/**
 * Backend configuration
 */
export interface BackendConfig {
  active: 'chrome' | 'postgres';
  postgres?: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl: boolean;
    schema: string;
  };
}








