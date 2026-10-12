export const access = "public";
export const methods = ["GET"];

const URL = "https://api.agmarknet.gov.in/v1/daily-price-arrival/filters";
const HEADERS = {
  "Accept": "application/json, text/plain, */*",
  "Origin": "https://agmarknet.gov.in",
  "Referer": "https://agmarknet.gov.in/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
};

export default async function (req, res) {
  try {
    const response = await fetch(URL, { headers: HEADERS, timeout_ms: 10000 });
    const raw = await response.text();
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (_) {
      console.warn("AGMARKNET commodity filters returned non-JSON", response.status, raw.slice(0, 120));
      return res.status(502).json({
        available: false,
        error: "commodity_list_unavailable",
        message: "The official AGMARKNET commodity list could not be read right now. Please retry shortly.",
        source: "AGMARKNET 2.0",
        sourceUrl: "https://agmarknet.gov.in/home"
      });
    }
    if (!response.ok) {
      return res.status(502).json({
        available: false,
        error: "commodity_list_unavailable",
        message: "The official AGMARKNET commodity list returned HTTP " + response.status + ". Please retry shortly.",
        source: "AGMARKNET 2.0",
        sourceUrl: "https://agmarknet.gov.in/home"
      });
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
      return res.status(502).json({
        available: false,
        error: "commodity_list_empty",
        message: "AGMARKNET did not provide a usable commodity list. Please retry shortly.",
        source: "AGMARKNET 2.0",
        sourceUrl: "https://agmarknet.gov.in/home"
      });
    }
    return res.json({
      available: true,
      source: "AGMARKNET 2.0",
      sourceUrl: "https://agmarknet.gov.in/home",
      count: commodities.length,
      commodities,
      fetchedAt: new Date().toISOString(),
      message: "Official crop and commodity names returned by AGMARKNET 2.0."
    });
  } catch (error) {
    console.error("FarmWise official commodity list failed", String(error && error.message || error).slice(0, 180));
    return res.status(502).json({
      available: false,
      error: "commodity_list_unavailable",
      message: "Could not connect to the official AGMARKNET commodity list. Please retry shortly.",
      source: "AGMARKNET 2.0",
      sourceUrl: "https://agmarknet.gov.in/home"
    });
  }
}