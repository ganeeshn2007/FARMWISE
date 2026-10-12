import { db } from "hatchable";

export const access = "public";
export const methods = ["GET"];

const URL = "https://api.agmarknet.gov.in/v1/daily-price-arrival/filters";
const CACHE_KEY = "agmarknet:commodities:v1";
const HEADERS = {
  "Accept": "application/json, text/plain, */*",
  "Origin": "https://agmarknet.gov.in",
  "Referer": "https://agmarknet.gov.in/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
};

async function readCache() {
  try {
    const result = await db.query("SELECT payload, updated_at FROM market_data_cache WHERE cache_key=$1 LIMIT 1", [CACHE_KEY]);
    if (!result.rows.length) return null;
    return { payload: result.rows[0].payload, updatedAt: result.rows[0].updated_at };
  } catch (_) {
    return null;
  }
}
async function saveCache(payload) {
  try {
    await db.query(
      "INSERT INTO market_data_cache (cache_key,payload,updated_at) VALUES ($1,$2::jsonb,now()) ON CONFLICT (cache_key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()",
      [CACHE_KEY, JSON.stringify(payload)]
    );
  } catch (error) {
    console.warn("FarmWise commodity cache write failed", String(error && error.message || error).slice(0, 120));
  }
}
async function cachedFallback(reason) {
  const cached = await readCache();
  if (!cached) return null;
  const savedAt = cached.updatedAt ? new Date(cached.updatedAt).toISOString() : null;
  return {
    ...cached.payload,
    stale: true,
    cacheSavedAt: savedAt,
    message: reason + " Showing the last successfully fetched official AGMARKNET commodity list; cached at " +
      (savedAt || "an unknown time") + ". The list may be out of date; retry to refresh."
  };
}
function unavailable(message) {
  return {
    available: false,
    error: "commodity_list_unavailable",
    message,
    source: "AGMARKNET 2.0",
    sourceUrl: "https://agmarknet.gov.in/home"
  };
}

export default async function (req, res) {
  try {
    const response = await fetch(URL, { headers: HEADERS, timeout_ms: 10000 });
    const raw = await response.text();
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (_) {
      console.warn("AGMARKNET commodity filters returned non-JSON", response.status, raw.slice(0, 120));
      const cached = await cachedFallback("AGMARKNET could not return a readable crop list.");
      if (cached) return res.json(cached);
      return res.status(502).json(unavailable("The official AGMARKNET commodity list could not be read right now. Please retry shortly."));
    }
    if (!response.ok) {
      const cached = await cachedFallback("AGMARKNET returned HTTP " + response.status + ".");
      if (cached) return res.json(cached);
      return res.status(502).json(unavailable("The official AGMARKNET commodity list returned HTTP " + response.status + ". Please retry shortly."));
    }
    const rows = payload && payload.data && Array.isArray(payload.data.cmdt_data)
      ? payload.data.cmdt_data : [];
    const seen = new Set();
    const commodities = rows
      .filter(row => row && row.cmdt_name != null && String(row.cmdt_name).trim())
      .map(row => ({
        id: row.cmdt_id == null ? null : String(row.cmdt_id),
        name: String(row.cmdt_name).trim()
      }))
      .filter(row => {
        const key = row.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
    if (!commodities.length) {
      const cached = await cachedFallback("AGMARKNET returned an empty commodity list.");
      if (cached) return res.json(cached);
      return res.status(502).json(unavailable("AGMARKNET did not provide a usable commodity list. Please retry shortly."));
    }
    const result = {
      available: true,
      source: "AGMARKNET 2.0",
      sourceUrl: "https://agmarknet.gov.in/home",
      count: commodities.length,
      commodities,
      fetchedAt: new Date().toISOString(),
      stale: false,
      message: "Official crop and commodity names returned by AGMARKNET 2.0."
    };
    await saveCache(result);
    return res.json(result);
  } catch (error) {
    console.error("FarmWise official commodity list failed", String(error && error.message || error).slice(0, 180));
    const cached = await cachedFallback("The official AGMARKNET commodity service could not be reached.");
    if (cached) return res.json(cached);
    return res.status(502).json(unavailable("Could not connect to the official AGMARKNET commodity list. Please retry shortly."));
  }
}