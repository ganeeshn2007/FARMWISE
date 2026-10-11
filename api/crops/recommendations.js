import { db } from "hatchable";

export const access = "public";
export const methods = ["GET", "POST"];

function num(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : NaN;
}
function text(value, max = 120) {
  if (value === undefined || value === null || value === "") return null;
  return String(value).trim().slice(0, max);
}

export default async function (req, res) {
  const input = req.method === "POST" ? (req.body || {}) : (req.query || {});
  const n = num(input.nitrogen);
  const p = num(input.phosphorus);
  const k = num(input.potassium);
  if ([n,p,k].some(v => Number.isNaN(v))) {
    return res.status(400).json({ available: false, error: "invalid_npk", message: "N, P and K must be non-negative numeric values." });
  }
  const region = text(input.region);
  const season = text(input.season);
  const soilType = text(input.soilType);
  const ph = input.ph === undefined || input.ph === null || input.ph === "" ? null : Number(input.ph);
  const moisture = input.moisture === undefined || input.moisture === null || input.moisture === "" ? null : Number(input.moisture);
  if ((ph !== null && (!Number.isFinite(ph) || ph < 0 || ph > 14)) || (moisture !== null && (!Number.isFinite(moisture) || moisture < 0 || moisture > 100))) {
    return res.status(400).json({ available: false, error: "invalid_soil_condition", message: "pH must be between 0 and 14; moisture must be between 0 and 100 percent." });
  }
  if ([n,p,k].some(v => v !== null) && [n,p,k].some(v => v === null)) {
    return res.status(400).json({ available: false, error: "incomplete_npk", message: "Provide all three N, P and K values, or omit all three." });
  }

  const conditions = [];
  const params = [];
  function add(condition, value) { params.push(value); conditions.push(condition.replace("?", "$" + params.length)); }
  // Include AI-generated draft rows so the prototype can return results now; the response labels them as provisional and not agronomically verified.
  conditions.push("verified_status IN ('verified','needs_review')");
  if (region) add("(region IS NULL OR lower(region) = lower(?))", region);
  if (season) add("(season IS NULL OR lower(season) = lower(?))", season);
  if (soilType) add("(soil_type IS NULL OR lower(soil_type) = lower(?))", soilType);
  if (ph !== null) {
    add("(ph_min IS NULL OR ph_min <= ?)", ph);
    add("(ph_max IS NULL OR ph_max >= ?)", ph);
  }
  if (moisture !== null) {
    add("(moisture_min_pct IS NULL OR moisture_min_pct <= ?)", moisture);
    add("(moisture_max_pct IS NULL OR moisture_max_pct >= ?)", moisture);
  }
  if (n !== null) {
    add("(nitrogen_min_mg_kg IS NULL OR nitrogen_min_mg_kg <= ?)", n);
    add("(nitrogen_max_mg_kg IS NULL OR nitrogen_max_mg_kg >= ?)", n);
    add("(phosphorus_min_mg_kg IS NULL OR phosphorus_min_mg_kg <= ?)", p);
    add("(phosphorus_max_mg_kg IS NULL OR phosphorus_max_mg_kg >= ?)", p);
    add("(potassium_min_mg_kg IS NULL OR potassium_min_mg_kg <= ?)", k);
    add("(potassium_max_mg_kg IS NULL OR potassium_max_mg_kg >= ?)", k);
  }
  const sql = "SELECT id, crop_name, region, season, soil_type, guidance, source_name, source_url, source_published_at, verified_status, notes FROM crop_knowledge WHERE " + conditions.join(" AND ") + " ORDER BY crop_name LIMIT 50";
  try {
    const result = await db.query(sql, params);
    return res.json({
      available: true,
      source: "FarmWise PostgreSQL crop_knowledge",
      fetchedAt: new Date().toISOString(),
      input: { nitrogen: n, phosphorus: p, potassium: k, ph, moisture, region, season, soilType },
      count: result.rows.length,
      recommendations: result.rows,
      message: result.rows.length
        ? "Results are retrieved from PostgreSQL. Records marked needs_review are AI-generated preliminary drafts, not verified recommendations; use for demo/reference only and confirm locally before acting."
        : "No matching crop records are currently available. Generate a batch of crop knowledge drafts or add region-specific guidance from an agricultural university, ICAR/KVK, or an official soil-test recommendation."
    });
  } catch (error) {
    return res.status(500).json({ available: false, error: "database_query_failed", message: "Crop recommendation records could not be retrieved from the database." });
  }
}