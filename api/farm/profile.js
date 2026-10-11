import { db } from "hatchable";

export const access = "user";
export const methods = ["GET", "PUT"];

const stringFields = ["farmName", "farmerName", "farmVillage", "farmPlot", "farmSoilType", "farmSeason", "farmIrrigation"];

function cleanProfile(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const profile = {};
  for (const key of stringFields) {
    if (input[key] !== undefined && input[key] !== null && typeof input[key] !== "string") return null;
    profile[key] = String(input[key] || "").trim().slice(0, 120);
  }
  const area = input.farmArea == null ? "" : String(input.farmArea).trim();
  if (area && (!/^\d{1,7}(?:\.\d{1,2})?$/.test(area) || !Number.isFinite(Number(area)) || Number(area) > 1000000)) return null;
  profile.farmArea = area;
  return profile;
}

export default async function (req, res) {
  const userId = String(req.user.id);
  if (req.method === "GET") {
    const { rows } = await db.query(
      "SELECT profile, updated_at FROM farm_profiles WHERE user_id = $1 LIMIT 1",
      [userId]
    );
    return res.json({
      profile: rows.length ? rows[0].profile : null,
      updatedAt: rows.length ? rows[0].updated_at : null
    });
  }

  const profile = cleanProfile(req.body);
  if (!profile) {
    return res.status(400).json({
      error: "invalid_profile",
      message: "Provide valid farm profile fields and a non-negative area."
    });
  }
  const { rows } = await db.query(
    "INSERT INTO farm_profiles (user_id, profile, updated_at) VALUES ($1, $2::jsonb, now()) " +
    "ON CONFLICT (user_id) DO UPDATE SET profile = EXCLUDED.profile, updated_at = now() " +
    "RETURNING updated_at",
    [userId, JSON.stringify(profile)]
  );
  return res.json({ ok: true, profile, updatedAt: rows[0].updated_at });
}