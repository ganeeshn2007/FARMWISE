import { db } from "hatchable";

export const access = "public";
export const methods = ["GET"];

export default async function (req, res) {
  const rawLimit = Number((req.query || {}).limit || 24);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, Math.floor(rawLimit))) : 24;
  const { rows } = await db.query(
    "SELECT device_id, nitrogen, phosphorus, potassium, received_at, device_timestamp FROM sensor_readings ORDER BY received_at DESC LIMIT $1",
    [limit]
  );
  return res.json({
    readings: rows.map(row => ({
      deviceId: row.device_id,
      n: Number(row.nitrogen),
      p: Number(row.phosphorus),
      k: Number(row.potassium),
      timestamp: row.device_timestamp || row.received_at
    }))
  });
}