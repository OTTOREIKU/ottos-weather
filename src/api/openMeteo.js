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
  { id: 'cma_grapes_global', label: 'CMA', agency: 'CMA · China', color: '#d95926' },
]

const HOURLY_VARS = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation',
  'weather_code',
  'wind_speed_10m',
  'relative_humidity_2m',
  'cloud_cover',
  'dew_point_2m',
  'pressure_msl',
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

const US_STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia',
}

// The geocoder only matches place names, so "Milford MI" finds nothing useful.
// Peel a trailing state abbreviation, state name, or ", region" off the query
// and use it to filter results instead.
function parseQuery(query) {
  const q = query.trim()
  const comma = q.includes(',')
  const parts = comma ? q.split(',').map((s) => s.trim()) : q.split(/\s+/)
  if (parts.length >= 2) {
    const tail = comma ? parts.slice(1).join(' ') : parts[parts.length - 1]
    const name = comma ? parts[0] : parts.slice(0, -1).join(' ')
    if (name) {
      const abbrev = US_STATES[tail.toUpperCase()]
      if (abbrev) return { name, region: abbrev }
      const full = Object.values(US_STATES).find((s) => s.toLowerCase() === tail.toLowerCase())
      if (full) return { name, region: full }
      if (comma) return { name, region: tail }
    }
  }
  return { name: q, region: null }
}

export async function geocode(query) {
  const { name, region } = parseQuery(query)
  const params = new URLSearchParams({
    name,
    count: region ? '20' : '10',
    language: 'en',
    format: 'json',
  })
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`)
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`)
  const json = await res.json()
  let results = (json.results || []).map((r) => ({
    name: r.name,
    admin1: r.admin1 || '',
    country: r.country_code || '',
    countryName: r.country || '',
    lat: r.latitude,
    lon: r.longitude,
  }))
  if (region) {
    const rx = region.toLowerCase()
    const matches = results.filter(
      (r) =>
        r.admin1.toLowerCase().startsWith(rx) ||
        r.country.toLowerCase() === rx ||
        r.countryName.toLowerCase().startsWith(rx),
    )
    // a bad qualifier still shows something rather than nothing
    if (matches.length) results = matches
  }
  return results.slice(0, 8)
}

// 15-minute precipitation for the next hours (best-match model). Used for the
// "rain starting soon" readout; unavailable regions return nulls.
export async function fetchMinutely(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    minutely_15: 'precipitation',
    // 2 days so the 2.5h horizon survives late-evening checks near local midnight
    forecast_days: '2',
    timezone: 'auto',
  })
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
  if (!res.ok) throw new Error(`Minutely request failed (${res.status})`)
  const json = await res.json()
  return {
    utcOffsetSeconds: json.utc_offset_seconds,
    time: json.minutely_15?.time || [],
    precipitation: json.minutely_15?.precipitation || [],
  }
}

// Air quality, UV index, and visibility for the details tiles. Both endpoints
// are keyless; failures degrade to empty tiles rather than blocking anything.
export async function fetchDetails(lat, lon) {
  const out = { aqi: null, uvNow: null, uvMax: null, visibility: null }
  const ll = { latitude: lat.toFixed(4), longitude: lon.toFixed(4), timezone: 'auto' }
  const [aq, fc] = await Promise.allSettled([
    fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${new URLSearchParams({ ...ll, current: 'us_aqi' })}`).then((r) => r.json()),
    fetch(
      `https://api.open-meteo.com/v1/forecast?${new URLSearchParams({
        ...ll,
        hourly: 'uv_index,visibility',
        daily: 'uv_index_max',
        forecast_days: '1',
      })}`,
    ).then((r) => r.json()),
  ])
  if (aq.status === 'fulfilled' && Number.isFinite(aq.value?.current?.us_aqi)) {
    out.aqi = aq.value.current.us_aqi
  }
  if (fc.status === 'fulfilled' && fc.value?.hourly) {
    const j = fc.value
    const nowLocal = new Date(Date.now() + j.utc_offset_seconds * 1000)
    const iso = `${nowLocal.toISOString().slice(0, 13)}:00`
    let idx = 0
    for (let i = 0; i < j.hourly.time.length; i++) {
      if (j.hourly.time[i] <= iso) idx = i
      else break
    }
    out.uvNow = j.hourly.uv_index?.[idx] ?? null
    out.visibility = j.hourly.visibility?.[idx] ?? null
    out.uvMax = j.daily?.uv_index_max?.[0] ?? null
  }
  return out
}

const SEVERITY_RANK = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 }

// Active NWS alerts for a point (official US National Weather Service, no key).
// Non-US locations get an empty list.
export async function fetchAlerts(lat, lon) {
  try {
    const res = await fetch(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, {
      headers: { Accept: 'application/geo+json' },
    })
    if (!res.ok) return []
    const json = await res.json()
    return (json.features || [])
      .map((f) => ({
        id: f.properties.id || f.id,
        event: f.properties.event,
        headline: f.properties.headline,
        severity: f.properties.severity || 'Unknown',
        description: f.properties.description,
        instruction: f.properties.instruction,
        ends: f.properties.ends || f.properties.expires,
        areaDesc: f.properties.areaDesc,
      }))
      .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 4) - (SEVERITY_RANK[b.severity] ?? 4))
  } catch {
    return []
  }
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
