CREATE TABLE IF NOT EXISTS crop_knowledge (
  id bigserial PRIMARY KEY,
  crop_name text NOT NULL,
  region text,
  season text,
  soil_type text,
  ph_min double precision,
  ph_max double precision,
  nitrogen_min_mg_kg double precision,
  nitrogen_max_mg_kg double precision,
  phosphorus_min_mg_kg double precision,
  phosphorus_max_mg_kg double precision,
  potassium_min_mg_kg double precision,
  potassium_max_mg_kg double precision,
  guidance text NOT NULL,
  source_name text NOT NULL,
  source_url text,
  source_published_at date,
  verified_status text NOT NULL DEFAULT 'needs_review' CHECK (verified_status IN ('needs_review','reviewed','verified')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crop_knowledge_lookup_idx ON crop_knowledge (verified_status, region, season, crop_name);
CREATE TABLE IF NOT EXISTS disease_references (
  id bigserial PRIMARY KEY,
  crop_name text NOT NULL,
  disease_name text NOT NULL,
  symptoms text NOT NULL,
  treatment_guidance text NOT NULL,
  source_name text NOT NULL,
  source_url text,
  source_published_at date,
  verified_status text NOT NULL DEFAULT 'needs_review' CHECK (verified_status IN ('needs_review','reviewed','verified')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS disease_references_lookup_idx ON disease_references (verified_status, crop_name, disease_name);