ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS user_id TEXT;
CREATE INDEX IF NOT EXISTS sensor_readings_user_received_idx ON sensor_readings(user_id, received_at DESC);