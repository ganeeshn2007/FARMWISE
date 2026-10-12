export const access = "public";
export const methods = ["GET"];

const BASE = "https://api.agmarknet.gov.in/v1";
const HEADERS = {
  "Accept": "application/json, text/plain, */*",
  "Origin": "https://agmarknet.gov.in",
  "Referer": "https://agmarknet.gov.in/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
};

const ALIASES = {
  "tomatoes": "tomato",
  "onions": "onion",
  "potatoes": "potato",
  "corn": "maize",
  "paddy": "rice",
  "wheat grain": "wheat",
  "groundnuts": "groundnut",
  "peanuts": "groundnut",
  "soyabean": "soybean",
  "soya bean": "soybean"
};
const STATE_ALIASES = {
  "kerala": "keralam",
  "chhattisgarh": "chattisgarh",
  "chattisgarh": "chattisgarh",
  "andaman and nicobar islands": "andaman and nicobar",
  "delhi": "nct of delhi",
  "puducherry": "pondicherry"
};

function norm(value) {
  return String(value || "").toLowerCase().trim()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ").trim();
}
function numberOrNull(value) {
  if (value === null || value === undefined || value === "" || String(value).trim().toUpperCase() === "NR") return null;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function latestReported(row, columns) {
  const dates = (Array.isArray(columns) ? columns : [])
    .map(col => col && col.key)
    .filter(key => /^\d{4}-\d{2}-\d{2}$/.test(String(key || "")))
    .sort((a, b) => b.localeCompare(a));
  for (const date of dates) {
    const price = numberOrNull(row[date]);
    if (price !== null) return { date, price };
  }
  return null;
}
async function apiJson(path, timeout = 10000, attempt = 0) {
  const retryableMetadata = path === "/daily-price-arrival/filters" || path.startsWith("/list-comm/");
  let response;
  try {
    response = await fetch(BASE + path, { headers: HEADERS, timeout_ms: timeout });
  } catch (_) {
    if (retryableMetadata && attempt < 1) {
      await new Promise(resolve => setTimeout(resolve, 450));
      return apiJson(path, timeout, attempt + 1);
    }
    throw new Error("Could not connect to the official AGMARKNET v2 service. Please retry shortly.");
  }
  const text = await response.text();
  const contentType = String(response.headers.get("content-type") || "");
  let data;
  try { data = JSON.parse(text); }
  catch (_) {
    if (!response.ok && response.status >= 500 && retryableMetadata && attempt < 1) {
      await new Promise(resolve => setTimeout(resolve, 450));
      return apiJson(path, timeout, attempt + 1);
    }
    console.warn("AGMARKNET returned a non-JSON response", JSON.stringify({status:response.status,contentType,preview:text.slice(0,160).replace(/\\s+/g," ")}));
    throw new Error("AGMARKNET returned a non-JSON response (HTTP " + response.status + ").");
  }
  if (!response.ok) {
    if (response.status >= 500 && retryableMetadata && attempt < 1) {
      await new Promise(resolve => setTimeout(resolve, 450));
      return apiJson(path, timeout, attempt + 1);
    }
    const detail = String(data.detail || data.message || "Official market service request failed").slice(0, 180);
    throw new Error("AGMARKNET v2 returned HTTP " + response.status + ": " + detail);
  }
  return data;
}
function noDataMessage(commodity, state, district) {
  const where = [district, state].filter(Boolean).join(", ");
  return "AGMARKNET returned no numeric reported prices in its last-week feed for " + commodity +
    (where ? " in " + where : "") + ". The source marks missing observations as NR; FarmWise does not convert them to zero.";
}
export default async function (req, res) {
  const query = req.query || {};
  const stateInput = String(query.state || "").trim().slice(0, 100);
  const districtInput = String(query.district || "").trim().slice(0, 100);
  const requestedCommodity = String(query.commodity || "").trim().slice(0, 100);
  if (!requestedCommodity) {
    return res.status(400).json({
      available: false,
      error: "commodity_required",
      message: "Choose a crop or commodity from the official AGMARKNET list at /api/market/commodities. No default crop is assumed."
    });
  }
  const normalizedState = norm(stateInput);
  const wantedState = STATE_ALIASES[normalizedState] || normalizedState;
  const wantedDistrict = norm(districtInput);
  const wantedRaw = norm(requestedCommodity);
  const wantedCommodity = ALIASES[wantedRaw] || wantedRaw;

  try {
    const filterPayload = await apiJson("/daily-price-arrival/filters");
    const filterData = filterPayload && filterPayload.data ? filterPayload.data : {};
    const commodities = Array.isArray(filterData.cmdt_data) ? filterData.cmdt_data : [];
    const stateRows = Array.isArray(filterData.state_data) ? filterData.state_data : [];
    const districtRows = Array.isArray(filterData.district_data) ? filterData.district_data : [];
    const marketRows = Array.isArray(filterData.market_data) ? filterData.market_data : [];

    // Exact official spellings always win; aliases are only a fallback for user-friendly variants.
    let commodity = commodities.find(row => norm(row.cmdt_name) === wantedRaw);
    if (!commodity && wantedCommodity !== wantedRaw) commodity = commodities.find(row => norm(row.cmdt_name) === wantedCommodity);
    if (!commodity) commodity = commodities.find(row => norm(row.cmdt_name).startsWith(wantedCommodity));
    if (!commodity && wantedCommodity.length >= 3) commodity = commodities.find(row => norm(row.cmdt_name).includes(wantedCommodity));
    if (!commodity) {
      return res.status(400).json({
        available: false,
        error: "commodity_not_found",
        message: "No exact or close commodity name was found in the official AGMARKNET list for '" + requestedCommodity + "'. Search the full official list at /api/market/commodities and use a listed name.",
        suggestions: ["Tomato", "Onion", "Potato", "Rice", "Wheat", "Maize"]
      });
    }

    let state = null;
    if (wantedState) {
      state = stateRows.find(row => norm(row.state_name) === wantedState);
      if (!state) state = stateRows.find(row => norm(row.state_name).includes(wantedState) || wantedState.includes(norm(row.state_name)));
      if (!state) {
        return res.status(400).json({
          available: false, error: "state_not_found",
          message: "No official state name matched '" + stateInput + "'. Choose a state name from the list."
        });
      }
    }

    let districtId = null;
    let matchedDistrictName = districtInput;
    if (wantedDistrict) {
      let matchingDistricts = districtRows.filter(row => (!state || Number(row.state_id) === Number(state.state_id)));
      let district = matchingDistricts.find(row => norm(row.district_name) === wantedDistrict);
      if (!district) district = matchingDistricts.find(row => norm(row.district_name).includes(wantedDistrict));
      if (district) {
        districtId = Number(district.id);
        matchedDistrictName = district.district_name;
      }
    }

    const commodityMarketsPayload = await apiJson("/list-comm/" + encodeURIComponent(String(commodity.cmdt_id)));
    let candidates = Array.isArray(commodityMarketsPayload.data) ? commodityMarketsPayload.data : [];
    candidates = candidates.filter(row => row && row.market_id != null && row.state_id != null);
    if (state) candidates = candidates.filter(row => Number(row.state_id) === Number(state.state_id));
    if (districtId !== null) {
      candidates = candidates.filter(row => {
        const marketMeta = marketRows.find(market => Number(market.id) === Number(row.market_id));
        return marketMeta && Number(marketMeta.district_id) === districtId;
      });
    } else if (wantedDistrict) {
      candidates = candidates.filter(row => norm(row.market_name).includes(wantedDistrict));
    }
    const seenMarkets = new Set();
    candidates = candidates.filter(row => {
      const key = String(row.market_id) + "|" + String(row.state_id);
      if (seenMarkets.has(key)) return false;
      seenMarkets.add(key);
      return true;
    });
    candidates.sort((a, b) => {
      if (!state && !wantedDistrict) {
        return norm(a.state_name).localeCompare(norm(b.state_name)) || norm(a.market_name).localeCompare(norm(b.market_name));
      }
      return norm(a.market_name).localeCompare(norm(b.market_name));
    });

    if (!candidates.length) {
      const message = wantedDistrict
        ? "No " + commodity.cmdt_name + " market is listed for " + matchedDistrictName + (state ? ", " + state.state_name : "") + " in the official AGMARKNET filters. Try clearing the market/district filter."
        : "No markets are currently listed for " + commodity.cmdt_name + (state ? " in " + state.state_name : "") + " by the official AGMARKNET source.";
      return res.json({
        available: true, source: "AGMARKNET 2.0",
        sourceNote: message, records: [], total: 0,
        fetchedAt: new Date().toISOString(),
        filters: { state: state ? state.state_name : null, district: districtInput || null, commodity: commodity.cmdt_name },
        message
      });
    }

    // Query only one small page of market histories per user action. AGMARKNET
    // rate-limits bursts, so requests are deliberately sequential. The user can
    // load the next page without forcing dozens of upstream calls in one request.
    // "NR" values are ignored, never interpreted as zero.
    const perPage = 10;
    const rawPage = Number(query.page || 0);
    const page = Number.isFinite(rawPage) ? Math.max(0, Math.min(250, Math.floor(rawPage))) : 0;
    let marketsToFetch = [];
    let hasMore = false;
    let totalMarketPages = 0;
    if (!state && !wantedDistrict) {
      // Interleave the nationwide market list across states on every page.
      const stride = Math.ceil(candidates.length / perPage);
      totalMarketPages = stride;
      if (page < stride) {
        for (let lane = 0; lane < perPage; lane++) {
          const index = lane * stride + page;
          if (index < candidates.length) marketsToFetch.push(candidates[index]);
        }
      }
      hasMore = page + 1 < stride;
    } else {
      const start = page * perPage;
      marketsToFetch = candidates.slice(start, start + perPage);
      totalMarketPages = Math.ceil(candidates.length / perPage);
      hasMore = start + marketsToFetch.length < candidates.length;
    }
    const records = [];
    const attempted = marketsToFetch.length;
    let requestFailures = 0;
    for (const market of marketsToFetch) {
      try {
        const endpoint = "/prices-and-arrivals/market-price/lastweek?marketId=" +
          encodeURIComponent(String(market.market_id)) + "&stateId=" +
          encodeURIComponent(String(market.state_id)) + "&commodityId=" +
          encodeURIComponent(String(commodity.cmdt_id)) + "&includeExcel=false";
        const payload = await apiJson(endpoint, 10000);
        if (!payload || payload.success !== true || !Array.isArray(payload.data)) {
          requestFailures++;
          console.warn("AGMARKNET market history had no usable response", String(market.market_name || market.market_id));
          continue;
        }
        for (const row of payload.data) {
          const latest = latestReported(row, payload.columns);
          if (!latest) continue;
          const marketMeta = marketRows.find(item => Number(item.id) === Number(market.market_id));
          const districtMeta = marketMeta ? districtRows.find(item => Number(item.id) === Number(marketMeta.district_id)) : null;
          records.push({
            state: market.state_name || (state && state.state_name) || "",
            district: districtMeta ? districtMeta.district_name : "",
            market: market.market_name || "",
            commodity: commodity.cmdt_name,
            variety: row.variety && row.variety !== "Unknown" ? row.variety : "Variety not specified",
            grade: "",
            arrivalDate: latest.date,
            price: latest.price,
            unit: row.unitOfPrice && row.unitOfPrice !== "NR" ? row.unitOfPrice : "Rs./Quintal",
            source: "AGMARKNET 2.0",
            sourceDate: latest.date
          });
        }
      } catch (error) {
        requestFailures++;
        console.warn("AGMARKNET market history skipped", String(market.market_name || market.market_id), String(error.message || error).slice(0, 160));
      }
    }

    records.sort((a, b) => b.arrivalDate.localeCompare(a.arrivalDate) ||
      a.state.localeCompare(b.state) || a.market.localeCompare(b.market));
    const limitedRecords = records.slice(0, 20);
    if (!limitedRecords.length && requestFailures > 0) {
      return res.status(502).json({
        available:false,
        error:"agmarknet_upstream_unavailable",
        message:"AGMARKNET did not provide usable responses for the checked markets. This is a source connection/rate-limit problem, not proof that prices were zero or absent. Retry in a moment or narrow the market filter.",
        source:"AGMARKNET 2.0",
        sourceUrl:"https://agmarknet.gov.in/home",
        candidateMarketsChecked:attempted,
        failedRequests:requestFailures
      });
    }
    const latestDate = limitedRecords.reduce((latest, row) => row.arrivalDate > latest ? row.arrivalDate : latest, "");
    let sourceNote = "Official AGMARKNET 2.0 market-wise prices, drawn from its last-week report. Each row shows the latest numeric report available for that market; the date can differ across markets. Values are per quintal where the source reports Rs./Quintal, not live intraday quotes. 'NR' means no report.";
    if (requestFailures > 0) sourceNote += " Some market requests failed; only markets with a successful official response are shown.";
    return res.json({
      available: true,
      source: "AGMARKNET 2.0",
      sourceUrl: "https://agmarknet.gov.in/home",
      sourceNote,
      records: limitedRecords,
      total: limitedRecords.length,
      candidateMarketsChecked: attempted,
      totalMarketsAvailable: candidates.length,
      totalMarketPages,
      page,
      hasMore,
      failedRequests: requestFailures,
      partialData: requestFailures > 0,
      latestReportDate: latestDate || null,
      filters: { state: state ? state.state_name : null, district: districtInput || null, commodity: commodity.cmdt_name },
      fetchedAt: new Date().toISOString(),
      message: limitedRecords.length ? sourceNote : noDataMessage(commodity.cmdt_name, state ? state.state_name : null, districtInput || null)
    });
  } catch (error) {
    console.error("FarmWise AGMARKNET v2 request failed", String(error && error.message || error).slice(0, 240));
    return res.status(502).json({
      available: false,
      error: "agmarknet_unavailable",
      message: String(error && error.message || "Official AGMARKNET price data is temporarily unavailable.").slice(0, 500),
      source: "AGMARKNET 2.0",
      sourceUrl: "https://agmarknet.gov.in/home"
    });
  }
}