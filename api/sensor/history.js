import { db } from "hatchable";

export const access = "user";
export const methods = ["GET", "DELETE"];

export default async function (req, res) {
  if (req.method === "DELETE") {
    const result = await db.query("DELETE FROM sensor_readings WHERE user_id = $1", [String(req.user.id)]);
    return res.json({ ok: true, deleted: result.rowCount });
  }
  const rawLimit = Number((req.query || {}).limit || 24);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, Math.floor(rawLimit))) : 24;
  const { rows } = await db.query(
    "SELECT device_id, nitrogen, phosphorus, potassium, received_at, device_timestamp FROM sensor_readings WHERE user_id = $1 ORDER BY received_at DESC LIMIT $2",
    [String(req.user.id), limit]
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