import { config } from "hatchable";

export const access = "public";
export const methods = ["GET"];

export default async function (_req, res) {
  let configured = false;
  try {
    const token = await config.get("NEXUS_DEVICE_TOKEN");
    configured = typeof token === "string" && token.trim().length > 0;
  } catch (_) {}

  return res.json({
    available: true,
    cloudIngestConfigured: configured,
    message: configured
      ? "ESP32 cloud ingest is configured. The device must send the same token in x-device-token and the signed-in FarmWise account ID as userId."
      : "ESP32 cloud ingest is not configured yet. Add NEXUS_DEVICE_TOKEN in private Hatchable project Setup, then set the same token in the ESP32 firmware and include the signed-in account ID as userId. USB serial/manual readings can still be used locally."
  });
}