/**
 * Retention Configuration
 *
 * Controls age-based and row-cap deletion for ingestion tables.
 * Defaults are safe for production. Override via constructor for testing.
 */

export interface RetentionConfig {
  readonly audit_log_max_age_days: number;
  readonly audit_log_max_rows: number;
  readonly quarantine_max_age_days: number;
  readonly sandbox_processed_max_age_days: number;
  readonly sandbox_failed_max_rows: number;
  readonly batch_size: number;
  readonly interval_ms: number;
}

export const DEFAULT_RETENTION_CONFIG: RetentionConfig = {
  audit_log_max_age_days: 90,
  audit_log_max_rows: 100_000,
  quarantine_max_age_days: 30,
  sandbox_processed_max_age_days: 7,
  sandbox_failed_max_rows: 10_000,
  batch_size: 1000,
  interval_ms: 60 * 60 * 1000,
}
