-- Create kv_store table for key-value storage
CREATE TABLE IF NOT EXISTS kv_store (
  k TEXT PRIMARY KEY,
  v JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create index on updated_at for potential queries
CREATE INDEX IF NOT EXISTS idx_kv_store_updated_at ON kv_store(updated_at);


