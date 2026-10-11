import { db, config } from "hatchable";
export const access = "public";
export const methods = ["POST"];

export default async function (req, res) {
  let expected = null;
  try { expected = await config.get("NEXUS_DEVICE_TOKEN"); } catch (_) {}
  if (typeof expected !== "string" || !expected) {
    return res.status(503).json({ ok: false, error: "Device token is not configured. Add NEXUS_DEVICE_TOKEN in private project setup before connecting hardware." });
  }
  const supplied = req.headers["x-device-token"] || "";
  if (typeof supplied !== "string" || supplied.length !== expected.length || supplied !== expected) {
    return res.status(401).json({ ok: false, error: "Invalid device token." });
  }

  const body = req.body || {};
  const userId = typeof body.userId === "string" ? body.userId.trim().slice(0, 200) : "";
  const n = Number(body.nitrogen), p = Number(body.phosphorus), k = Number(body.potassium);
  if (!userId) return res.status(400).json({ ok: false, error: "userId is required so readings are stored with the correct FarmWise account." });
  if (![n, p, k].every(value => Number.isFinite(value) && value >= 0 && value <= 100000)) {
    return res.status(400).json({ ok: false, error: "nitrogen, phosphorus and potassium must be finite non-negative numbers in mg/kg." });
  }
  const deviceId = String(body.deviceId || "esp32-gateway").slice(0, 100);
  const deviceTimestamp = body.timestamp && !Number.isNaN(Date.parse(body.timestamp)) ? new Date(body.timestamp).toISOString() : null;
  const { rows } = await db.query(
    "INSERT INTO sensor_readings (user_id, device_id, nitrogen, phosphorus, potassium, device_timestamp) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, received_at",
    [userId, deviceId, n, p, k, deviceTimestamp]
  );
  return res.status(201).json({ ok: true, id: rows[0].id, receivedAt: rows[0].received_at });
}