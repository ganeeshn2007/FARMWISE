import { db } from "hatchable";

export const access = "public";
export const methods = ["GET"];

export default async function (_req, res) {
  try {
    const [crops, diseases] = await Promise.all([
      db.query("SELECT verified_status, COUNT(*)::int AS count FROM crop_knowledge GROUP BY verified_status"),
      db.query("SELECT verified_status, COUNT(*)::int AS count FROM disease_references GROUP BY verified_status")
    ]);
    const cropCounts = Object.fromEntries(crops.rows.map(row => [row.verified_status, row.count]));
    const diseaseCounts = Object.fromEntries(diseases.rows.map(row => [row.verified_status, row.count]));
    return res.json({
      available: true,
      database: "FarmWise PostgreSQL",
      cropKnowledge: { total: Object.values(cropCounts).reduce((a,b)=>a+b,0), verified: cropCounts.verified || 0, needsReview: cropCounts.needs_review || 0, reviewed: cropCounts.reviewed || 0 },
      diseaseReferences: { total: Object.values(diseaseCounts).reduce((a,b)=>a+b,0), verified: diseaseCounts.verified || 0, needsReview: diseaseCounts.needs_review || 0, reviewed: diseaseCounts.reviewed || 0 },
      policy: "Only records explicitly marked verified are eligible for recommendations. An empty result is reported honestly."
    });
  } catch (_) {
    return res.status(500).json({ available: false, error: "database_query_failed" });
  }
}