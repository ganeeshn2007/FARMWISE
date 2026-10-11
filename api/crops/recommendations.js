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
  if ([n,p,k].some(v => v !== null) && [n,p,k].some(v => v === null)) {
    return res.status(400).json({ available: false, error: "incomplete_npk", message: "Provide all three N, P and K values, or omit all three." });
  }

  const conditions = [];
  const params = [];
  function add(condition, value) { params.push(value); conditions.push(condition.replace("?", "$" + params.length)); }
  conditions.push("verified_status = 'verified'");
  if (region) add("(region IS NULL OR lower(region) = lower(?))", region);
  if (season) add("(season IS NULL OR lower(season) = lower(?))", season);
  if (soilType) add("(soil_type IS NULL OR lower(soil_type) = lower(?))", soilType);
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
      input: { nitrogen: n, phosphorus: p, potassium: k, region, season, soilType },
      count: result.rows.length,
      recommendations: result.rows,
      message: result.rows.length
        ? "Results are retrieved from verified database records. Check each source and the soil-test method before applying advice."
        : "No verified matching crop records are currently available. FarmWise will not invent a recommendation; add and review region-specific records from an agricultural university, ICAR/KVK, or an official soil-test recommendation."
    });
  } catch (error) {
    return res.status(500).json({ available: false, error: "database_query_failed", message: "Crop recommendation records could not be retrieved from the database." });
  }
}