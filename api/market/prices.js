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
  // Let Hatchable surface its secure Setup prompt if the required secret has not been saved yet.
  const apiKey = await config.get("DATA_GOV_IN_API_KEY");
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
  url.searchParams.set("sort[arrival_date]", "desc");
  if (state) url.searchParams.set("filters[state.keyword]", state);
  if (district) url.searchParams.set("filters[district]", district);
  if (commodity) url.searchParams.set("filters[commodity]", commodity);

  let upstream;
  try {
    upstream = await fetch(url.toString(), { timeout_ms: 10000 });
  } catch (_) {
    return res.status(502).json({ error: "market_provider_unavailable", message: "The official market-data service could not be reached." });
  }
  if (!upstream.ok) {
    let upstreamDetail = "";
    try { upstreamDetail = (await upstream.text()).slice(0, 700); } catch (_) {}
    // The Hatchable egress proxy can itself return 502 before data.gov.in is reached.
    // Never label that as bad credentials or provide fabricated/sample prices.
    if (upstream.status === 502 && /proxy_error|HTTP Tunneling|Request was cancelled/i.test(upstreamDetail)) {
      console.error("FarmWise market egress failed", JSON.stringify({status:upstream.status,detail:upstreamDetail.slice(0,240)}));
      return res.status(502).json({
        available:false,
        error:"market_network_proxy_unavailable",
        upstreamStatus:502,
        message:"FarmWise could not reach the official data.gov.in market service through its outbound network connection. No price records were loaded. Retry later or open the official dataset page."
      });
    }
    console.error("FarmWise official market provider returned an error", JSON.stringify({status:upstream.status,detail:upstreamDetail.slice(0,200)}));
    return res.status(502).json({
      available:false,
      error:"market_provider_error",
      upstreamStatus:upstream.status,
      message:upstream.status === 401 || upstream.status === 403
        ? "The data.gov.in service denied access. Verify the API key in private Hatchable Setup and confirm it is enabled for this dataset."
        : upstream.status === 400
          ? "The data.gov.in service rejected the query parameters."
          : "The official market-data service returned HTTP " + upstream.status + ". No substitute or simulated prices were shown."
    });
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