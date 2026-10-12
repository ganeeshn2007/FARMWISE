CREATE TABLE IF NOT EXISTS market_data_cache (
  cache_key text PRIMARY KEY,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS market_data_cache_updated_idx ON market_data_cache (updated_at DESC);