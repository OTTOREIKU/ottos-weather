// Model accuracy collector. Runs daily via GitHub Actions:
//  1. snapshots every model's 1/2/3-day-ahead forecast for each tracked
//     location (public/data/locations.json) into public/data/log.json
//  2. once a forecast's target date has passed, verifies it against observed
//     conditions (Open-Meteo analysis for recent days, ERA5 archive for older)
//  3. maintains running accuracy scores per model in public/data/scores.json
//     (temp mean-absolute-error on highs/lows, rain hit/miss at 1 mm)
// The app reads scores.json to rank models and optionally weight the mean.
import { readFileSync, writeFileSync } from 'node:fs'

const MODELS = [
  'ecmwf_ifs025',
  'gfs_seamless',
  'icon_seamless',
  'meteofrance_seamless',
  'ukmo_seamless',
  'jma_seamless',
  'gem_seamless',
  'cma_grapes_global',
]
const LEADS = [1, 2, 3] // days ahead
const RAIN_MM = 1.0
const RAIN_HOURLY_MM = 0.2 // per-hour rain threshold for timing scores
const DAILY_VARS = 'temperature_2m_max,temperature_2m_min,precipitation_sum'

const read = (path, fallback) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

async function getJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  const json = await res.json()
  if (json.error) throw new Error(`${json.reason} ${url}`)
  return json
}

// ---- extra sources: NWS is keyless; OpenWeather/PirateWeather join the
// scoring when their API keys are set as GitHub Actions repository secrets
// (OPENWEATHER_API_KEY / PIRATEWEATHER_API_KEY) ----

async function nwsDaily(loc) {
  const pt = await getJson(`https://api.weather.gov/points/${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}`)
  const url = pt?.properties?.forecastHourly
  if (!url) return null
  const fc = await getJson(`${url}?units=si`)
  const byDate = {}
  for (const p of fc.properties.periods) {
    if (!Number.isFinite(p.temperature)) continue
    ;(byDate[p.startTime.slice(0, 10)] ||= []).push(p.temperature)
  }
  const out = {}
  for (const [date, temps] of Object.entries(byDate)) {
    if (temps.length >= 18) out[date] = { hi: Math.max(...temps), lo: Math.min(...temps), pr: null }
  }
  return out
}

async function owmDaily(loc, key) {
  const j = await getJson(
    `https://api.openweathermap.org/data/2.5/forecast?lat=${loc.lat.toFixed(4)}&lon=${loc.lon.toFixed(4)}&units=metric&appid=${key}`,
  )
  const off = j.city?.timezone ?? 0
  const byDate = {}
  for (const item of j.list) {
    const date = new Date((item.dt + off) * 1000).toISOString().slice(0, 10)
    const d = (byDate[date] ||= { temps: [], pr: 0 })
    if (Number.isFinite(item.main?.temp)) d.temps.push(item.main.temp)
    d.pr += (item.rain?.['3h'] ?? 0) + (item.snow?.['3h'] ?? 0)
  }
  const out = {}
  for (const [date, d] of Object.entries(byDate)) {
    // 3-hourly feed: 8 points on a full day
    if (d.temps.length >= 7) out[date] = { hi: Math.max(...d.temps), lo: Math.min(...d.temps), pr: d.pr }
  }
  return out
}

async function pirateDaily(loc, key) {
  const j = await getJson(
    `https://api.pirateweather.net/forecast/${key}/${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}?units=si&extend=hourly&exclude=minutely,alerts,daily`,
  )
  const off = (j.offset ?? 0) * 3600
  const byDate = {}
  for (const item of j.hourly?.data || []) {
    const date = new Date((item.time + off) * 1000).toISOString().slice(0, 10)
    const d = (byDate[date] ||= { temps: [], pr: 0 })
    if (Number.isFinite(item.temperature)) d.temps.push(item.temperature)
    d.pr += item.precipIntensity ?? 0
  }
  const out = {}
  for (const [date, d] of Object.entries(byDate)) {
    if (d.temps.length >= 18) out[date] = { hi: Math.max(...d.temps), lo: Math.min(...d.temps), pr: d.pr }
  }
  return out
}

// ---- user API keys come from the private settings repo (the same
// settings.json the app's device-sync maintains), read with the sync PAT set
// as the single SETTINGS_REPO_TOKEN secret. Keys therefore live in ONE place:
// rotate them in the app and the collector follows automatically. Explicit
// OPENWEATHER_API_KEY / PIRATEWEATHER_API_KEY secrets still win if set.
async function loadSettingsKeys() {
  const token = process.env.SETTINGS_REPO_TOKEN
  if (!token) return {}
  try {
    const res = await fetch('https://api.github.com/repos/OTTOREIKU/weather-settings/contents/settings.json', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) throw new Error(`settings repo read failed (${res.status})`)
    const j = await res.json()
    const s = JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'))
    return {
      openweather: s?.sources?.openweather?.key || null,
      pirate: s?.sources?.pirate?.key || null,
    }
  } catch (e) {
    console.error(`settings keys unavailable: ${e.message}`)
    return {}
  }
}

const remoteKeys = await loadSettingsKeys()
const OWM_KEY = process.env.OPENWEATHER_API_KEY || remoteKeys.openweather
const PIRATE_KEY = process.env.PIRATEWEATHER_API_KEY || remoteKeys.pirate
console.log(`extra source keys: openweather=${!!OWM_KEY} pirate=${!!PIRATE_KEY}`)

const locations = read('public/data/locations.json', [])
const log = read('public/data/log.json', {})
const scores = read('public/data/scores.json', { models: {} })
scores.models ||= {}
scores.rainThresholdMm = RAIN_MM

const locKey = (l) => `${l.lat.toFixed(2)},${l.lon.toFixed(2)}`
const today = new Date().toISOString().slice(0, 10)

// ---- 1) snapshot new forecasts ----
for (const loc of locations) {
  try {
    const params = new URLSearchParams({
      latitude: loc.lat,
      longitude: loc.lon,
      daily: DAILY_VARS,
      hourly: 'precipitation', // hourly rain for next-day timing scores
      models: MODELS.join(','),
      timezone: 'auto',
      forecast_days: '4',
    })
    const j = await getJson(`https://api.open-meteo.com/v1/forecast?${params}`)

    // extra sources, best-effort per location
    const extras = {}
    try {
      const nws = await nwsDaily(loc)
      if (nws) extras.nws = nws
    } catch (e) {
      console.error(`nws snapshot failed: ${loc.name}: ${e.message}`)
    }
    if (OWM_KEY) {
      try {
        extras.openweather = await owmDaily(loc, OWM_KEY)
      } catch (e) {
        console.error(`openweather snapshot failed: ${loc.name}: ${e.message}`)
      }
    }
    if (PIRATE_KEY) {
      try {
        extras.pirate = await pirateDaily(loc, PIRATE_KEY)
      } catch (e) {
        console.error(`pirate snapshot failed: ${loc.name}: ${e.message}`)
      }
    }

    for (const lead of LEADS) {
      const date = j.daily.time[lead]
      if (!date) continue
      const key = `${locKey(loc)}|${date}|L${lead}`
      if (log[key]) continue // keep the earliest forecast for a target date
      const models = {}
      // hourly indexes belonging to this target date (next-day timing only:
      // storm placement barely means anything at 2-3 days out)
      const hourIdx =
        lead === 1 ? j.hourly.time.map((t, i) => (t.startsWith(date) ? i : -1)).filter((i) => i >= 0) : []
      for (const id of MODELS) {
        models[id] = {
          hi: j.daily[`temperature_2m_max_${id}`]?.[lead] ?? null,
          lo: j.daily[`temperature_2m_min_${id}`]?.[lead] ?? null,
          pr: j.daily[`precipitation_sum_${id}`]?.[lead] ?? null,
        }
        if (hourIdx.length === 24) {
          const arr = j.hourly[`precipitation_${id}`]
          if (Array.isArray(arr)) {
            models[id].prH = hourIdx.map((i) => (Number.isFinite(arr[i]) ? Math.round(arr[i] * 100) / 100 : null))
          }
        }
      }
      for (const [id, byDate] of Object.entries(extras)) {
        if (byDate?.[date]) models[id] = byDate[date]
      }
      log[key] = { name: loc.name, lat: loc.lat, lon: loc.lon, date, lead, savedAt: today, models }
    }
    console.log(`snapshot ok: ${loc.name} (${Object.keys(extras).join('+') || 'core only'})`)
  } catch (e) {
    console.error(`snapshot failed: ${loc.name}: ${e.message}`)
  }
}

// ---- 2) verify forecasts whose target date has fully passed ----
const verifiable = Object.values(log).filter((e) => !e.verified && e.date <= addDays(today, -2))
const byLoc = new Map()
for (const e of verifiable) {
  const k = `${e.lat},${e.lon}`
  if (!byLoc.has(k)) byLoc.set(k, [])
  byLoc.get(k).push(e)
}

for (const entries of byLoc.values()) {
  const { lat, lon, name } = entries[0]
  const actualByDate = {}
  const actualHourly = {}
  const recent = entries.filter((e) => e.date >= addDays(today, -7))
  const older = entries.filter((e) => e.date < addDays(today, -7))

  const collectHourly = (j) => {
    if (!j.hourly?.time) return
    j.hourly.time.forEach((t, i) => {
      const d = t.slice(0, 10)
      ;(actualHourly[d] ||= []).push(j.hourly.precipitation[i])
    })
  }

  try {
    if (recent.length) {
      // recent days: the forecast API's past_days is analysis (assimilated
      // observations), available next day
      const params = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        daily: DAILY_VARS,
        hourly: 'precipitation',
        past_days: '7',
        forecast_days: '1',
        timezone: 'auto',
      })
      const j = await getJson(`https://api.open-meteo.com/v1/forecast?${params}`)
      j.daily.time.forEach((d, i) => {
        actualByDate[d] = {
          hi: j.daily.temperature_2m_max[i],
          lo: j.daily.temperature_2m_min[i],
          pr: j.daily.precipitation_sum[i],
        }
      })
      collectHourly(j)
    }
    if (older.length) {
      // catch-up path if the workflow missed runs: ERA5 archive (has ~5 day lag)
      const dates = older.map((e) => e.date).sort()
      const params = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        daily: DAILY_VARS,
        hourly: 'precipitation',
        start_date: dates[0],
        end_date: dates[dates.length - 1],
        timezone: 'auto',
      })
      const j = await getJson(`https://archive-api.open-meteo.com/v1/archive?${params}`)
      j.daily.time.forEach((d, i) => {
        actualByDate[d] ||= {
          hi: j.daily.temperature_2m_max[i],
          lo: j.daily.temperature_2m_min[i],
          pr: j.daily.precipitation_sum[i],
        }
      })
      collectHourly(j)
    }
  } catch (e) {
    console.error(`actuals failed: ${name}: ${e.message}`)
    continue
  }

  for (const entry of entries) {
    const actual = actualByDate[entry.date]
    if (!actual || !Number.isFinite(actual.hi) || !Number.isFinite(actual.lo)) continue
    for (const id of Object.keys(entry.models)) {
      const f = entry.models[id]
      if (!f || !Number.isFinite(f.hi) || !Number.isFinite(f.lo)) continue
      const err = (Math.abs(f.hi - actual.hi) + Math.abs(f.lo - actual.lo)) / 2

      const bump = (s) => {
        s.nT = (s.nT || 0) + 1
        s.sumErr = (s.sumErr || 0) + err
        // signed bias: positive = model runs hot. Enables bias correction
        // later, which is stronger than down-weighting alone.
        s.sumBiasHi = (s.sumBiasHi || 0) + (f.hi - actual.hi)
        s.sumBiasLo = (s.sumBiasLo || 0) + (f.lo - actual.lo)
        s.rain ||= { hit: 0, miss: 0, fa: 0, cn: 0 }
        if (Number.isFinite(f.pr) && Number.isFinite(actual.pr)) {
          const predicted = f.pr >= RAIN_MM
          const observed = actual.pr >= RAIN_MM
          if (predicted && observed) s.rain.hit++
          else if (!predicted && observed) s.rain.miss++
          else if (predicted && !observed) s.rain.fa++
          else s.rain.cn++
        }
      }

      const m = (scores.models[id] ||= {})
      bump(m)
      m.byLead ||= {}
      bump((m.byLead[entry.lead] ||= {}))
      // hourly rain timing (next-day forecasts only): did the model put the
      // rain in the right hours, not just the right day
      const obsH = actualHourly[entry.date]
      if (entry.lead === 1 && Array.isArray(f.prH) && obsH?.length === 24) {
        const rh = (m.rainH ||= { hit: 0, miss: 0, fa: 0, cn: 0 })
        for (let h = 0; h < 24; h++) {
          if (!Number.isFinite(f.prH[h]) || !Number.isFinite(obsH[h])) continue
          const predicted = f.prH[h] >= RAIN_HOURLY_MM
          const observed = obsH[h] >= RAIN_HOURLY_MM
          if (predicted && observed) rh.hit++
          else if (!predicted && observed) rh.miss++
          else if (predicted && !observed) rh.fa++
          else rh.cn++
        }
      }
      // per-location scores too: model skill is regional, and the app prefers
      // these once a location has enough verified days
      scores.locations ||= {}
      const lk = `${entry.lat.toFixed(2)},${entry.lon.toFixed(2)}`
      const locScope = (scores.locations[lk] ||= { name: entry.name, models: {} })
      bump((locScope.models[id] ||= {}))
    }
    entry.verified = true
    entry.actual = actual
  }
  console.log(`verified ${entries.filter((e) => e.verified).length}/${entries.length} entries for ${name}`)
}

// ---- 3) prune old verified entries ----
for (const [key, entry] of Object.entries(log)) {
  if (entry.verified && entry.date < addDays(today, -60)) delete log[key]
}

scores.updatedAt = today
writeFileSync('public/data/log.json', JSON.stringify(log, null, 2))
writeFileSync('public/data/scores.json', JSON.stringify(scores, null, 2))
console.log(`done: ${Object.keys(log).length} log entries, ${Object.keys(scores.models).length} scored models`)
