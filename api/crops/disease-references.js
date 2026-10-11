import { db } from "hatchable";

export const access = "public";
export const methods = ["GET"];

function clean(value, max = 120) {
  if (value === undefined || value === null || value === "") return null;
  return String(value).trim().slice(0, max);
}

export default async function (req, res) {
  const crop = clean(req.query?.crop);
  const disease = clean(req.query?.disease);
  const status = clean(req.query?.status);
  const conditions = [];
  const params = [];
  if (crop) { params.push(crop); conditions.push("lower(crop_name) LIKE '%' || lower($" + params.length + ") || '%'"); }
  if (disease) { params.push(disease); conditions.push("lower(disease_name) LIKE '%' || lower($" + params.length + ") || '%'"); }
  if (status && ["needs_review", "reviewed", "verified"].includes(status)) {
    params.push(status); conditions.push("verified_status = $" + params.length);
  } else {
    conditions.push("verified_status = 'verified'");
  }
  const sql = "SELECT id, crop_name, disease_name, symptoms, treatment_guidance, source_name, source_url, source_published_at, verified_status, notes FROM disease_references WHERE " + conditions.join(" AND ") + " ORDER BY crop_name, disease_name LIMIT 100";
  try {
    const result = await db.query(sql, params);
    return res.json({
      available: true,
      source: "FarmWise PostgreSQL disease_references",
      fetchedAt: new Date().toISOString(),
      filters: { crop, disease, status: status || "verified" },
      count: result.rows.length,
      references: result.rows,
      message: result.rows.length
        ? "Records include source metadata. Confirm diagnosis and local applicability before treatment."
        : "No matching verified disease reference is available. Do not infer a disease or prescribe a treatment from this empty result."
    });
  } catch (_) {
    return res.status(500).json({ available: false, error: "database_query_failed", message: "Disease reference records could not be retrieved." });
  }
}