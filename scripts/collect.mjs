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
]
const LEADS = [1, 2, 3] // days ahead
const RAIN_MM = 1.0
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
      models: MODELS.join(','),
      timezone: 'auto',
      forecast_days: '4',
    })
    const j = await getJson(`https://api.open-meteo.com/v1/forecast?${params}`)
    for (const lead of LEADS) {
      const date = j.daily.time[lead]
      if (!date) continue
      const key = `${locKey(loc)}|${date}|L${lead}`
      if (log[key]) continue // keep the earliest forecast for a target date
      const models = {}
      for (const id of MODELS) {
        models[id] = {
          hi: j.daily[`temperature_2m_max_${id}`]?.[lead] ?? null,
          lo: j.daily[`temperature_2m_min_${id}`]?.[lead] ?? null,
          pr: j.daily[`precipitation_sum_${id}`]?.[lead] ?? null,
        }
      }
      log[key] = { name: loc.name, lat: loc.lat, lon: loc.lon, date, lead, savedAt: today, models }
    }
    console.log(`snapshot ok: ${loc.name}`)
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
  const recent = entries.filter((e) => e.date >= addDays(today, -7))
  const older = entries.filter((e) => e.date < addDays(today, -7))

  try {
    if (recent.length) {
      // recent days: the forecast API's past_days is analysis (assimilated
      // observations), available next day
      const params = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        daily: DAILY_VARS,
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
    }
    if (older.length) {
      // catch-up path if the workflow missed runs: ERA5 archive (has ~5 day lag)
      const dates = older.map((e) => e.date).sort()
      const params = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        daily: DAILY_VARS,
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
    }
  } catch (e) {
    console.error(`actuals failed: ${name}: ${e.message}`)
    continue
  }

  for (const entry of entries) {
    const actual = actualByDate[entry.date]
    if (!actual || !Number.isFinite(actual.hi) || !Number.isFinite(actual.lo)) continue
    for (const id of MODELS) {
      const f = entry.models[id]
      if (!f || !Number.isFinite(f.hi) || !Number.isFinite(f.lo)) continue
      const err = (Math.abs(f.hi - actual.hi) + Math.abs(f.lo - actual.lo)) / 2

      const bump = (s) => {
        s.nT = (s.nT || 0) + 1
        s.sumErr = (s.sumErr || 0) + err
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
