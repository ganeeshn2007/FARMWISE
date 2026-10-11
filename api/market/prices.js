import { config } from "hatchable";

export const access = "public";
export const methods = ["GET"];

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cleanFilter(value, name) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (text.length > 100) throw new Error(name + " must be 100 characters or fewer.");
  return text;
}

export default async function (req, res) {
  let apiKey = null;
  try { apiKey = await config.get("DATA_GOV_IN_API_KEY"); } catch (_) {}
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    return res.status(503).json({
      error: "setup_required",
      message: "Official market prices need a data.gov.in API key. Add DATA_GOV_IN_API_KEY in the project's private Hatchable Setup."
    });
  }

  let state, district, commodity;
  try {
    const query = req.query || {};
    state = cleanFilter(query.state, "State");
    district = cleanFilter(query.district, "District");
    commodity = cleanFilter(query.commodity, "Commodity");
  } catch (error) {
    return res.status(400).json({ error: "invalid_filter", message: error.message });
  }

  const url = new URL("https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070");
  url.searchParams.set("api-key", apiKey.trim());
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "100");
  url.searchParams.set("offset", "0");
  url.searchParams.set("fields", "state,district,market,commodity,variety,grade,arrival_date,min_price,max_price,modal_price");
  if (state) url.searchParams.set("filters[State]", state);
  if (district) url.searchParams.set("filters[District]", district);
  if (commodity) url.searchParams.set("filters[Commodity]", commodity);

  let upstream;
  try {
    upstream = await fetch(url.toString(), { timeout_ms: 10000 });
  } catch (_) {
    return res.status(502).json({ error: "market_provider_unavailable", message: "The official market-data service could not be reached." });
  }
  if (!upstream.ok) {
    return res.status(502).json({ error: "market_provider_error", message: "The official market-data service rejected the request. Check the API key and try again." });
  }

  let data;
  try { data = await upstream.json(); } catch (_) {
    return res.status(502).json({ error: "invalid_market_response", message: "The official market-data service returned an unreadable response." });
  }
  const records = (Array.isArray(data.records) ? data.records : []).map(row => ({
    state: row.state || "",
    district: row.district || "",
    market: row.market || "",
    commodity: row.commodity || "",
    variety: row.variety || "",
    grade: row.grade || "",
    arrivalDate: row.arrival_date || "",
    minPrice: safeNumber(row.min_price),
    modalPrice: safeNumber(row.modal_price),
    maxPrice: safeNumber(row.max_price)
  }));
  return res.json({
    available: true,
    source: "AGMARKNET · data.gov.in",
    sourceNote: "Official daily mandi reports; values are not a real-time exchange quote.",
    records,
    fetchedAt: new Date().toISOString(),
    total: Number.isFinite(Number(data.total)) ? Number(data.total) : records.length
  });
}