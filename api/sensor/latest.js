import { db } from "hatchable";
export const access = "user";
export const methods = ["GET"];
export default async function (req, res) {
  const { rows } = await db.query("SELECT device_id, nitrogen, phosphorus, potassium, received_at, device_timestamp FROM sensor_readings WHERE user_id = $1 ORDER BY received_at DESC LIMIT 1", [String(req.user.id)]);
  if (!rows.length) return res.json({ available: false, mode: "awaiting_hardware", message: "No sensor reading has been received yet." });
  const r = rows[0];
  const timestamp = r.device_timestamp || r.received_at;
  return res.json({ available: true, reading: { deviceId: r.device_id, n: Number(r.nitrogen), p: Number(r.phosphorus), k: Number(r.potassium), timestamp } });
}