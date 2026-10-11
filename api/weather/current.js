export const access = "public";
export const methods = ["GET"];

const asNumber = value => typeof value === "number" && Number.isFinite(value) ? value : null;

export default async function (req, res) {
  const query = req.query || {};
  const latInput = query.lat;
  const lonInput = query.lon;
  let lat = null, lon = null, place = null;

  if (latInput !== undefined || lonInput !== undefined) {
    lat = Number(latInput);
    lon = Number(lonInput);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return res.status(400).json({ error: "invalid_location", message: "Provide valid latitude and longitude coordinates." });
    }
    place = "Farm location";
  } else {
    const name = String(query.location || "").trim().slice(0, 120);
    if (!name) return res.status(400).json({ error: "location_required", message: "Enter a town or use the location button." });
    const geocodeUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geocodeUrl.searchParams.set("name", name);
    geocodeUrl.searchParams.set("count", "1");
    geocodeUrl.searchParams.set("language", "en");
    geocodeUrl.searchParams.set("format", "json");
    let geocodeResponse;
    try { geocodeResponse = await fetch(geocodeUrl.toString(), { timeout_ms: 8000 }); } catch (_) {
      return res.status(502).json({ error: "weather_provider_unavailable", message: "The weather location service could not be reached." });
    }
    if (!geocodeResponse.ok) return res.status(502).json({ error: "weather_provider_unavailable", message: "The weather location service could not be reached." });
    const geocode = await geocodeResponse.json();
    const match = geocode.results && geocode.results[0];
    if (!match) return res.status(404).json({ error: "location_not_found", message: "No matching town was found. Check the spelling or use device location." });
    lat = match.latitude;
    lon = match.longitude;
    place = [match.name, match.admin1, match.country].filter(Boolean).join(", ");
  }

  const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
  weatherUrl.searchParams.set("latitude", String(lat));
  weatherUrl.searchParams.set("longitude", String(lon));
  weatherUrl.searchParams.set("current", "temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,precipitation,weather_code");
  weatherUrl.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_sum,uv_index_max,et0_fao_evapotranspiration");
  weatherUrl.searchParams.set("timezone", "auto");
  weatherUrl.searchParams.set("forecast_days", "5");
  let weatherResponse;
  try { weatherResponse = await fetch(weatherUrl.toString(), { timeout_ms: 10000 }); } catch (_) {
    return res.status(502).json({ error: "weather_provider_unavailable", message: "The weather provider could not be reached." });
  }
  if (!weatherResponse.ok) return res.status(502).json({ error: "weather_provider_unavailable", message: "The weather provider did not return a usable forecast." });
  const payload = await weatherResponse.json();
  const current = payload.current || {};
  const daily = payload.daily || {};
  if (asNumber(current.temperature_2m) === null) return res.status(502).json({ error: "weather_data_unavailable", message: "The weather provider returned no current conditions." });

  const forecast = (daily.time || []).map((date, index) => ({
    date,
    minC: asNumber((daily.temperature_2m_min || [])[index]),
    maxC: asNumber((daily.temperature_2m_max || [])[index]),
    precipitationMm: asNumber((daily.precipitation_sum || [])[index]),
    uvMax: asNumber((daily.uv_index_max || [])[index]),
    et0Mm: asNumber((daily.et0_fao_evapotranspiration || [])[index])
  }));

  return res.json({
    available: true,
    source: "Open-Meteo",
    sourceNote: "Forecast model data; not a farm weather-station measurement.",
    location: { label: place, latitude: lat, longitude: lon, timezone: payload.timezone || null },
    current: {
      time: current.time || null,
      temperatureC: asNumber(current.temperature_2m),
      humidityPct: asNumber(current.relative_humidity_2m),
      feelsLikeC: asNumber(current.apparent_temperature),
      windKmh: asNumber(current.wind_speed_10m),
      precipitationMm: asNumber(current.precipitation),
      weatherCode: asNumber(current.weather_code)
    },
    forecast,
    fetchedAt: new Date().toISOString()
  });
}