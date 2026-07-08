// Open-Meteo API: forecast (multi-model), geocoding. No key required.
// Colors are the dark-mode categorical palette slots, fixed order per model.
export const MODELS = [
  { id: 'ecmwf_ifs025', label: 'ECMWF', agency: 'ECMWF · Europe', color: '#3987e5' },
  { id: 'gfs_seamless', label: 'GFS', agency: 'NOAA · USA', color: '#199e70' },
  { id: 'icon_seamless', label: 'ICON', agency: 'DWD · Germany', color: '#c98500' },
  { id: 'meteofrance_seamless', label: 'ARPEGE', agency: 'Météo-France', color: '#008300' },
  { id: 'ukmo_seamless', label: 'UKMO', agency: 'UK Met Office', color: '#9085e9' },
  { id: 'jma_seamless', label: 'JMA', agency: 'JMA · Japan', color: '#e66767' },
  { id: 'gem_seamless', label: 'GEM', agency: 'ECCC · Canada', color: '#d55181' },
]

const HOURLY_VARS = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation',
  'weather_code',
  'wind_speed_10m',
  'relative_humidity_2m',
  'cloud_cover',
]

const DAILY_VARS = [
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'weather_code',
  'wind_speed_10m_max',
  'sunrise',
  'sunset',
]

// With multiple models requested, Open-Meteo suffixes every variable key
// with the model id (e.g. temperature_2m_ecmwf_ifs025).
function pick(block, varName, modelId) {
  return block[`${varName}_${modelId}`] ?? block[varName] ?? null
}

function groupByModel(block, vars) {
  const out = {}
  for (const v of vars) {
    out[v] = {}
    for (const m of MODELS) out[v][m.id] = pick(block, v, m.id)
  }
  return out
}

export async function fetchForecast(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: HOURLY_VARS.join(','),
    daily: DAILY_VARS.join(','),
    models: MODELS.map((m) => m.id).join(','),
    timezone: 'auto',
    forecast_days: '8',
  })
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
  if (!res.ok) throw new Error(`Forecast request failed (${res.status})`)
  const json = await res.json()
  if (json.error) throw new Error(json.reason || 'Forecast request failed')
  return {
    timezone: json.timezone,
    utcOffsetSeconds: json.utc_offset_seconds,
    hourlyTime: json.hourly.time,
    hourly: groupByModel(json.hourly, HOURLY_VARS),
    dailyTime: json.daily.time,
    daily: groupByModel(json.daily, DAILY_VARS),
  }
}

export async function geocode(query) {
  const params = new URLSearchParams({ name: query, count: '6', language: 'en', format: 'json' })
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`)
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`)
  const json = await res.json()
  return (json.results || []).map((r) => ({
    name: r.name,
    admin1: r.admin1 || '',
    country: r.country_code || '',
    lat: r.latitude,
    lon: r.longitude,
  }))
}

// RainViewer radar frames: ~2h of past frames plus a short nowcast. No key.
export async function fetchRadarFrames() {
  const res = await fetch('https://api.rainviewer.com/public/weather-maps.json')
  if (!res.ok) throw new Error(`Radar frames failed (${res.status})`)
  const json = await res.json()
  const frames = [
    ...(json.radar?.past || []).map((f) => ({ ...f, nowcast: false })),
    ...(json.radar?.nowcast || []).map((f) => ({ ...f, nowcast: true })),
  ]
  return { host: json.host, frames }
}
