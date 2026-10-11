ALTER TABLE crop_knowledge ADD COLUMN IF NOT EXISTS moisture_min_pct double precision;
ALTER TABLE crop_knowledge ADD COLUMN IF NOT EXISTS moisture_max_pct double precision;
CREATE INDEX IF NOT EXISTS crop_knowledge_verified_region_idx ON crop_knowledge (verified_status, region, season);