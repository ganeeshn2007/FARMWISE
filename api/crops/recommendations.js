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
function lower(value) { return String(value || "").trim().toLowerCase(); }

const GLOBAL_STAPLES = new Set([
  "rice","wheat","maize","corn","potato","tomato","cassava","soybean","soya","sorghum",
  "pearl millet","millet","barley","cotton","groundnut","peanut","chickpea","lentil",
  "onion","sugarcane","banana","cucumber","cabbage","pea","oats","rye","sunflower",
  "canola","carrot","common bean","cowpea","sweet potato","yam","plantain"
]);
const WARM_RAINY_CROPS = new Set([
  "rice","maize","corn","sorghum","pearl millet","millet","groundnut","peanut","soybean",
  "cotton","sugarcane","okra","tomato","cowpea","cassava","sweet potato"
]);
const COOL_DRY_CROPS = new Set([
  "wheat","chickpea","lentil","mustard","barley","potato","onion","pea","oats","garlic",
  "cumin","fenugreek","canola","rapeseed"
]);
const CROP_NAME_ALIASES = {
  "peanut":"groundnut", "peanuts":"groundnut",
  "corn":"maize",
  "paddy":"rice",
  "brinjal":"eggplant", "aubergine":"eggplant",
  "soya bean":"soybean", "soyabean":"soybean", "soya":"soybean",
  "ragi":"finger millet",
  "bajra":"pearl millet",
  "jowar":"sorghum",
  "chana":"chickpea", "bengal gram":"chickpea",
  "moong":"mung bean", "green gram":"mung bean",
  "urad":"black gram", "urad bean":"black gram",
  "kangkong":"water spinach"
};
function canonicalCropKey(value) {
  const name = lower(value).replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  return CROP_NAME_ALIASES[name] || name;
}
function candidatePriority(row, region, season, soilType) {
  const name = canonicalCropKey(row.crop_name);
  const rowRegion = lower(row.region);
  const wantedRegion = lower(region);
  const rowSeason = lower(row.season);
  const wantedSeason = lower(season);
  let score = row.verified_status === "verified" ? 100 : row.verified_status === "reviewed" ? 50 : 0;

  if (row.source_url) score += 2;
  if (wantedRegion && rowRegion) {
    if (rowRegion === wantedRegion) score += 12;
    else if (!wantedRegion.includes("global") && wantedRegion.includes(rowRegion)) score += 8;
    else if (rowRegion.startsWith("global") || rowRegion.startsWith("worldwide") || ["general","all regions"].includes(rowRegion)) score += 3;
  } else if (rowRegion.startsWith("global") || rowRegion === "general") {
    score += 2;
  }

  if (wantedSeason && rowSeason) {
    const wantsWarmWet = wantedSeason.includes("kharif") || wantedSeason.includes("monsoon") || wantedSeason.includes("rain");
    const wantsCoolDry = wantedSeason.includes("rabi") || wantedSeason.includes("winter");
    if (rowSeason.includes("general") || rowSeason.includes("varies") || rowSeason.includes("year-round") || rowSeason.includes("year round")) score += 2;
    else if (rowSeason.includes(wantedSeason)) score += 7;
    else if (wantsWarmWet && (rowSeason.includes("kharif") || rowSeason.includes("rain") || rowSeason.includes("monsoon") || rowSeason.includes("warm season") || rowSeason.includes("summer") || rowSeason.includes("tropical"))) score += 5;
    else if (wantsCoolDry && (rowSeason.includes("rabi") || rowSeason.includes("winter") || rowSeason.includes("cool season") || rowSeason.includes("spring") || rowSeason.includes("temperate"))) score += 5;
  }

  if (GLOBAL_STAPLES.has(name)) score += 4;
  const wantsWarmWet = wantedSeason.includes("kharif") || wantedSeason.includes("monsoon") || wantedSeason.includes("rain");
  const wantsCoolDry = wantedSeason.includes("rabi") || wantedSeason.includes("winter");
  if (wantsWarmWet && WARM_RAINY_CROPS.has(name)) score += 5;
  if (wantsCoolDry && COOL_DRY_CROPS.has(name)) score += 5;
  if (wantsWarmWet && COOL_DRY_CROPS.has(name) && !WARM_RAINY_CROPS.has(name)) score -= 7;
  if (wantsCoolDry && WARM_RAINY_CROPS.has(name) && !COOL_DRY_CROPS.has(name)) score -= 4;

  const soil = lower(soilType), cropSoil = lower(row.soil_type);
  if (soil && cropSoil) {
    const tokens = ["red","laterite","black","cotton","alluvial","sandy","sand","clay","loam","silt","well-drained"];
    for (const token of tokens) if (soil.includes(token) && cropSoil.includes(token)) score += 2;
  }
  return score;
}

export default async function (req, res) {
  const input = req.method === "POST" ? (req.body || {}) : (req.query || {});
  const n = num(input.nitrogen), p = num(input.phosphorus), k = num(input.potassium);
  if ([n,p,k].some(v => Number.isNaN(v))) {
    return res.status(400).json({ available:false, error:"invalid_npk", message:"N, P and K must be non-negative numeric values." });
  }
  const region = text(input.region), season = text(input.season), soilType = text(input.soilType);
  const ph = input.ph === undefined || input.ph === null || input.ph === "" ? null : Number(input.ph);
  const moisture = input.moisture === undefined || input.moisture === null || input.moisture === "" ? null : Number(input.moisture);
  if ((ph !== null && (!Number.isFinite(ph) || ph < 0 || ph > 14)) ||
      (moisture !== null && (!Number.isFinite(moisture) || moisture < 0 || moisture > 100))) {
    return res.status(400).json({ available:false, error:"invalid_soil_condition", message:"pH must be between 0 and 14; moisture must be between 0 and 100 percent." });
  }
  if ([n,p,k].some(v => v !== null) && [n,p,k].some(v => v === null)) {
    return res.status(400).json({ available:false, error:"incomplete_npk", message:"Provide all three N, P and K values, or omit all three." });
  }

  const conditions = ["verified_status IN ('verified','reviewed','needs_review')", "lower(trim(crop_name)) <> 'all crops'", "position(',' in crop_name) = 0"];
  const params = [];
  function add(condition, value) {
    params.push(value);
    conditions.push(condition.replace("?", "$" + params.length));
  }

  // Global draft records are useful as preliminary candidates even when a farmer
  // enters a village. Keep records for other specific regions out of the results.
  if (region) {
    params.push(region);
    const regionParam = "$" + params.length;
    conditions.push("(region IS NULL OR lower(trim(region)) LIKE 'global%' OR lower(trim(region)) LIKE 'worldwide%' OR lower(trim(region)) IN ('general','all regions') OR lower(trim(region)) = lower(trim(" + regionParam + ")) OR lower(trim(" + regionParam + ")) LIKE '%' || lower(trim(region)) || '%')");
  }
  if (season) {
    const s = lower(season);
    let seasonPredicate = "(season IS NULL OR lower(trim(season)) IN ('general','varies','global','year-round') OR lower(season) LIKE '%varies%' OR lower(season) LIKE '%year-round%'";
    if (s.includes("kharif") || s.includes("rain") || s.includes("monsoon")) {
      seasonPredicate += " OR lower(season) LIKE '%kharif%' OR lower(season) LIKE '%rain%' OR lower(season) LIKE '%monsoon%' OR lower(season) LIKE '%warm season%' OR lower(season) LIKE '%summer%' OR lower(season) LIKE '%tropical%'";
    } else if (s.includes("rabi") || s.includes("winter")) {
      seasonPredicate += " OR lower(season) LIKE '%rabi%' OR lower(season) LIKE '%winter%' OR lower(season) LIKE '%cool season%' OR lower(season) LIKE '%spring%' OR lower(season) LIKE '%temperate%'";
    } else {
      params.push(season);
      seasonPredicate += " OR lower(trim(season)) = lower(trim($" + params.length + "))";
    }
    seasonPredicate += ")";
    conditions.push(seasonPredicate);
  }
  // Soil-type descriptions are free text across datasets (e.g. "red soil",
  // "red loam", "well-drained loam"). Do not silently exclude candidates using
  // exact string equality; report the stored note so users can interpret it.

  // Apply any available numeric ranges, but also return the thresholds so the UI
  // can explicitly flag records whose numeric NPK/pH/moisture requirements are missing.
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

  const sql = "SELECT DISTINCT ON (lower(trim(crop_name))) id,crop_name,region,season,soil_type,ph_min,ph_max,nitrogen_min_mg_kg,nitrogen_max_mg_kg,phosphorus_min_mg_kg,phosphorus_max_mg_kg,potassium_min_mg_kg,potassium_max_mg_kg,moisture_min_pct,moisture_max_pct,guidance,source_name,source_url,source_published_at,verified_status,notes FROM crop_knowledge WHERE " + conditions.join(" AND ") + " ORDER BY lower(trim(crop_name)), CASE verified_status WHEN 'verified' THEN 0 WHEN 'reviewed' THEN 1 ELSE 2 END, updated_at DESC, id DESC";

  try {
    const result = await db.query(sql, params);
    const entered = [
      {key:"nitrogen", label:"N", value:n, min:"nitrogen_min_mg_kg", max:"nitrogen_max_mg_kg"},
      {key:"phosphorus", label:"P", value:p, min:"phosphorus_min_mg_kg", max:"phosphorus_max_mg_kg"},
      {key:"potassium", label:"K", value:k, min:"potassium_min_mg_kg", max:"potassium_max_mg_kg"},
      {key:"pH", label:"pH", value:ph, min:"ph_min", max:"ph_max"},
      {key:"moisture", label:"moisture", value:moisture, min:"moisture_min_pct", max:"moisture_max_pct"}
    ].filter(d => d.value !== null);
    const sortedRows = result.rows.slice().sort((a,b) => {
      const score = candidatePriority(b, region, season, soilType) - candidatePriority(a, region, season, soilType);
      return score || lower(a.crop_name).localeCompare(lower(b.crop_name));
    });
    const rankedRows = [];
    const seenCropKeys = new Set();
    for (const row of sortedRows) {
      const cropKey = canonicalCropKey(row.crop_name);
      if (!cropKey || seenCropKeys.has(cropKey)) continue;
      seenCropKeys.add(cropKey);
      rankedRows.push(row);
      if (rankedRows.length >= 30) break;
    }
    const recommendations = rankedRows.map(row => {
      const missing = entered.filter(d => row[d.min] === null || row[d.min] === undefined || row[d.max] === null || row[d.max] === undefined).map(d => d.label);
      const allNumericRangesPresent = entered.length > 0 && missing.length === 0;
      return {
        ...row,
        recordStatus: row.verified_status === "verified" ? "Verified" : row.verified_status === "reviewed" ? "Reviewed" : "Provisional AI-generated draft — not verified",
        fitStatus: !entered.length ? "Context candidate only; no soil values supplied" :
          allNumericRangesPresent ? "Within stored numeric ranges; still check source and local applicability" :
          "Numeric suitability not established; missing stored thresholds for " + missing.join(", "),
        missingNumericThresholds: missing,
        soilContext: soilType
          ? (row.soil_type ? "Farm soil input: " + soilType + "; stored soil note: " + row.soil_type + " (free-text, not a validated match)" : "Farm soil input: " + soilType + "; no crop-specific soil type recorded")
          : (row.soil_type ? "Stored soil note: " + row.soil_type : "No crop-specific soil type recorded")
      };
    });
    const anyFullyEvaluable = recommendations.some(r => entered.length > 0 && r.missingNumericThresholds.length === 0);
    return res.json({
      available:true,
      source:"FarmWise PostgreSQL crop_knowledge",
      fetchedAt:new Date().toISOString(),
      input:{nitrogen:n,phosphorus:p,potassium:k,ph,moisture,region,season,soilType},
      count:recommendations.length,
      recommendations,
      orderingNote: "Candidates are ordered using broad region/season keywords and common-crop context only. This is not a validated agronomic suitability score or proof the crop will grow well on this farm.",
      assessment: !recommendations.length ? "no_context_candidates" :
        !entered.length ? "context_only" :
        anyFullyEvaluable ? "numeric_ranges_available_for_some_candidates" : "numeric_soil_fit_unavailable",
      message: !recommendations.length
        ? "No crop guidance records match the supplied region/season/soil context. No recommendation was invented."
        : !entered.length
          ? "These are database candidates based on region/season context only, ordered by broad context keywords. They are not a measured soil-fit ranking or a verified planting recommendation."
          : anyFullyEvaluable
            ? "Candidates are retrieved from PostgreSQL. Any record with missing numeric thresholds is provisional and cannot be claimed to match every measured soil value."
            : "PostgreSQL returned preliminary crop guidance, but the database lacks numeric NPK/pH/moisture thresholds for these records. This is not a measured soil-fit recommendation. Do not infer suitability from this list; add source-backed crop-specific thresholds."
    });
  } catch (error) {
    console.error("FarmWise crop recommendations query failed", String(error).slice(0,180));
    return res.status(500).json({ available:false, error:"database_query_failed", message:"Crop guidance could not be retrieved from the database." });
  }
}