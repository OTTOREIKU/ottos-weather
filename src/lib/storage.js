// localStorage persistence: saved locations, unit preference, and daily
// forecast snapshots per model (groundwork for V3 accuracy scoring).

const LOC_KEY = 'wa.locations'
const UNITS_KEY = 'wa.units'
const HISTORY_KEY = 'wa.history'
const HISTORY_MAX = 400

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full or unavailable, non-fatal */
  }
}

export const loadLocations = () => read(LOC_KEY, [])
export const saveLocations = (list) => write(LOC_KEY, list)

export const loadUnits = () => read(UNITS_KEY, 'imperial')
export const saveUnits = (units) => write(UNITS_KEY, units)

// generic persisted settings (hourly window, auto-refresh, weighting toggle)
export const loadSetting = (key, fallback) => read(`wa.${key}`, fallback)
export const saveSetting = (key, value) => write(`wa.${key}`, value)

// ---- per-source API call counters (this device only) ----
const CALLS_KEY = 'wa.calls'

export function bumpCall(id, n = 1) {
  const all = read(CALLS_KEY, {})
  const today = new Date().toISOString().slice(0, 10)
  const month = today.slice(0, 7)
  const s = all[id] || {}
  all[id] = {
    date: today,
    day: (s.date === today ? s.day : 0) + n,
    month,
    monthCount: (s.month === month ? s.monthCount : 0) + n,
  }
  write(CALLS_KEY, all)
}

export function callCounts(id) {
  const all = read(CALLS_KEY, {})
  const today = new Date().toISOString().slice(0, 10)
  const s = all[id] || {}
  return {
    day: s.date === today ? s.day : 0,
    month: s.month === today.slice(0, 7) ? s.monthCount : 0,
  }
}

// true when another call would still be under the caps
export function underCap(id, dayCap, monthCap) {
  const c = callCounts(id)
  if (dayCap && c.day >= dayCap) return false
  if (monthCap && c.month >= monthCap) return false
  return true
}

// ---- extra forecast source settings ----
const SOURCES_KEY = 'wa.sources'
export const loadSources = () =>
  read(SOURCES_KEY, {
    nws: { on: true },
    openweather: { on: false, key: '' },
    pirate: { on: false, key: '' },
  })
export const saveSources = (s) => write(SOURCES_KEY, s)

export const locationKey = (loc) => `${loc.lat.toFixed(2)},${loc.lon.toFixed(2)}`

// Record each model's hi/lo/precip forecast for today and tomorrow. Once
// enough days accumulate, these can be scored against observed history
// (Open-Meteo archive API) to weight models by local accuracy.
export function logSnapshot(loc, data) {
  try {
    const history = read(HISTORY_KEY, {})
    const locKey = locationKey(loc)
    for (let i = 0; i < 2 && i < data.dailyTime.length; i++) {
      const date = data.dailyTime[i]
      const key = `${locKey}|${date}`
      const models = {}
      for (const [id, arr] of Object.entries(data.daily.temperature_2m_max)) {
        if (!Array.isArray(arr)) continue
        models[id] = {
          hi: arr[i],
          lo: data.daily.temperature_2m_min[id]?.[i] ?? null,
          precip: data.daily.precipitation_sum[id]?.[i] ?? null,
        }
      }
      // Keep the earliest forecast for a date (don't overwrite with later runs)
      if (!history[key]) {
        history[key] = { savedAt: new Date().toISOString(), name: loc.name, date, models }
      }
    }
    const keys = Object.keys(history)
    if (keys.length > HISTORY_MAX) {
      keys
        .sort((a, b) => (history[a].savedAt < history[b].savedAt ? -1 : 1))
        .slice(0, keys.length - HISTORY_MAX)
        .forEach((k) => delete history[k])
    }
    write(HISTORY_KEY, history)
  } catch {
    /* snapshot logging is best-effort */
  }
}
