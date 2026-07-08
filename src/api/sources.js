// Extra forecast sources beyond the Open-Meteo multi-model core:
//   NWS         official US forecaster-curated point forecast (free, no key)
//   OpenWeather proprietary blended model (free key, ~1000 calls/day tier)
//   PirateWeather open Dark Sky replacement over NOAA models (free key, ~10k/month)
// Each adapter maps its response onto the core forecast's hourly time grid so
// the aggregation, charts, and consensus treat them exactly like models.
// Client-side call budgets keep the keyed services safely under their free tiers.
import { MODELS } from './openMeteo.js'
import * as storage from '../lib/storage.js'

export const EXTRA_SOURCES = [
  {
    id: 'nws',
    label: 'NWS',
    agency: 'NWS · official US',
    color: '#35c4dc',
    extra: true,
    needsKey: false,
    note: 'US only · free, no key needed',
  },
  {
    id: 'openweather',
    label: 'OWM',
    agency: 'OpenWeather · blend',
    color: '#a9b421',
    extra: true,
    needsKey: true,
    dayCap: 900,
    note: 'free key at openweathermap.org',
  },
  {
    id: 'pirate',
    label: 'Pirate',
    agency: 'PirateWeather · NOAA',
    color: '#b08968',
    extra: true,
    needsKey: true,
    dayCap: 300,
    monthCap: 9000,
    note: 'free key at pirateweather.net',
  },
]

export const ALL_MODELS = [...MODELS, ...EXTRA_SOURCES]

const nullArr = (n) => new Array(n).fill(null)

function hourIndex(hourlyTime) {
  const m = new Map()
  hourlyTime.forEach((t, i) => m.set(t, i))
  return m
}

// NWS shortForecast text → approximate WMO code (order matters)
function nwsCode(text) {
  const t = (text || '').toLowerCase()
  if (t.includes('thunder')) return 95
  if (t.includes('sleet') || t.includes('freezing')) return 66
  if (t.includes('snow') || t.includes('flurr')) return 71
  if (t.includes('drizzle')) return 51
  if (t.includes('rain') || t.includes('shower')) return 61
  if (t.includes('fog') || t.includes('haze')) return 45
  if (t.includes('mostly cloudy') || t.includes('overcast') || t === 'cloudy') return 3
  if (t.includes('partly')) return 2
  if (t.includes('mostly sunny') || t.includes('mostly clear')) return 1
  if (t.includes('sunny') || t.includes('clear')) return 0
  return null
}

// OpenWeather condition id → WMO code
function owmCode(id) {
  if (id >= 200 && id < 300) return 95
  if (id >= 300 && id < 400) return 51
  if (id >= 500 && id < 600) return 61
  if (id >= 600 && id < 700) return 71
  if (id >= 700 && id < 800) return 45
  if (id === 800) return 0
  if (id === 801) return 1
  if (id === 802) return 2
  return 3
}

const PIRATE_CODE = {
  'clear-day': 0,
  'clear-night': 0,
  'partly-cloudy-day': 2,
  'partly-cloudy-night': 2,
  cloudy: 3,
  rain: 61,
  snow: 71,
  sleet: 66,
  fog: 45,
  thunderstorm: 95,
  hail: 96,
}

// daily hi/lo/precip/code computed from a source's hourly arrays; days without
// solid coverage stay null so a partial horizon can't fake a low "high"
function computeDaily(core, hourly) {
  const out = {
    temperature_2m_max: nullArr(core.dailyTime.length),
    temperature_2m_min: nullArr(core.dailyTime.length),
    precipitation_sum: nullArr(core.dailyTime.length),
    weather_code: nullArr(core.dailyTime.length),
    wind_speed_10m_max: nullArr(core.dailyTime.length),
  }
  core.dailyTime.forEach((date, di) => {
    const idxs = []
    core.hourlyTime.forEach((t, i) => {
      if (t.startsWith(date)) idxs.push(i)
    })
    const temps = idxs.map((i) => hourly.temperature_2m?.[i]).filter(Number.isFinite)
    if (temps.length >= 18) {
      out.temperature_2m_max[di] = Math.max(...temps)
      out.temperature_2m_min[di] = Math.min(...temps)
    }
    const rain = idxs.map((i) => hourly.precipitation?.[i]).filter(Number.isFinite)
    if (rain.length >= 20) out.precipitation_sum[di] = rain.reduce((a, b) => a + b, 0)
    const codes = idxs.map((i) => hourly.weather_code?.[i]).filter(Number.isFinite)
    if (codes.length >= 18) out.weather_code[di] = Math.max(...codes)
    const winds = idxs.map((i) => hourly.wind_speed_10m?.[i]).filter(Number.isFinite)
    if (winds.length >= 18) out.wind_speed_10m_max[di] = Math.max(...winds)
  })
  return out
}

async function fetchNWS(core, loc) {
  const pt = await (await fetch(`https://api.weather.gov/points/${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}`)).json()
  const url = pt?.properties?.forecastHourly
  if (!url) return null
  const fc = await (await fetch(`${url}?units=si`)).json()
  const periods = fc?.properties?.periods
  if (!periods?.length) return null
  const n = core.hourlyTime.length
  const idx = hourIndex(core.hourlyTime)
  const hourly = {
    temperature_2m: nullArr(n),
    weather_code: nullArr(n),
    relative_humidity_2m: nullArr(n),
    dew_point_2m: nullArr(n),
    wind_speed_10m: nullArr(n),
  }
  for (const p of periods) {
    // startTime carries the location's own UTC offset, matching our local grid
    const i = idx.get(`${p.startTime.slice(0, 13)}:00`)
    if (i == null) continue
    if (Number.isFinite(p.temperature)) hourly.temperature_2m[i] = p.temperature
    hourly.weather_code[i] = nwsCode(p.shortForecast)
    if (Number.isFinite(p.relativeHumidity?.value)) hourly.relative_humidity_2m[i] = p.relativeHumidity.value
    if (Number.isFinite(p.dewpoint?.value)) hourly.dew_point_2m[i] = p.dewpoint.value
    const wind = parseFloat(p.windSpeed)
    if (Number.isFinite(wind)) hourly.wind_speed_10m[i] = wind // si = km/h
  }
  return { hourly, daily: computeDaily(core, hourly) }
}

// linear interpolation between the 3-hourly OpenWeather points
function interpolate(arr, maxGap = 3) {
  let last = -1
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) continue
    if (last >= 0 && i - last > 1 && i - last <= maxGap) {
      for (let j = last + 1; j < i; j++) {
        arr[j] = arr[last] + ((arr[i] - arr[last]) * (j - last)) / (i - last)
      }
    }
    last = i
  }
  return arr
}

async function fetchOpenWeather(core, loc, key) {
  const params = new URLSearchParams({ lat: loc.lat.toFixed(4), lon: loc.lon.toFixed(4), units: 'metric', appid: key })
  const j = await (await fetch(`https://api.openweathermap.org/data/2.5/forecast?${params}`)).json()
  if (String(j.cod) !== '200' || !j.list?.length) throw new Error(j.message || 'OpenWeather error')
  const n = core.hourlyTime.length
  const idx = hourIndex(core.hourlyTime)
  const hourly = {
    temperature_2m: nullArr(n),
    precipitation: nullArr(n),
    weather_code: nullArr(n),
    relative_humidity_2m: nullArr(n),
    pressure_msl: nullArr(n),
    wind_speed_10m: nullArr(n),
    cloud_cover: nullArr(n),
  }
  for (const item of j.list) {
    const local = new Date((item.dt + core.utcOffsetSeconds) * 1000)
    const i = idx.get(`${local.toISOString().slice(0, 13)}:00`)
    if (i == null) continue
    hourly.temperature_2m[i] = item.main?.temp ?? null
    hourly.relative_humidity_2m[i] = item.main?.humidity ?? null
    hourly.pressure_msl[i] = item.main?.sea_level ?? item.main?.pressure ?? null
    hourly.wind_speed_10m[i] = Number.isFinite(item.wind?.speed) ? item.wind.speed * 3.6 : null
    hourly.cloud_cover[i] = item.clouds?.all ?? null
    hourly.weather_code[i] = item.weather?.[0] ? owmCode(item.weather[0].id) : null
    // rain/snow volumes cover the prior 3 hours; spread them back
    const vol = (item.rain?.['3h'] ?? 0) + (item.snow?.['3h'] ?? 0)
    for (let b = 0; b < 3; b++) {
      const bi = i - b
      if (bi >= 0 && bi < n) hourly.precipitation[bi] = (hourly.precipitation[bi] ?? 0) + vol / 3
    }
  }
  interpolate(hourly.temperature_2m)
  interpolate(hourly.relative_humidity_2m)
  interpolate(hourly.pressure_msl)
  interpolate(hourly.cloud_cover)
  // the 3-hourly feed starts in the future; extend its first point back a
  // couple of hours so OpenWeather participates in the "now" readouts too
  for (const arr of [hourly.temperature_2m, hourly.relative_humidity_2m, hourly.pressure_msl, hourly.cloud_cover, hourly.weather_code]) {
    const first = arr.findIndex(Number.isFinite)
    if (first > 0) for (let j = Math.max(0, first - 2); j < first; j++) arr[j] = arr[first]
  }
  return { hourly, daily: computeDaily(core, hourly) }
}

async function fetchPirate(core, loc, key) {
  const j = await (
    await fetch(
      `https://api.pirateweather.net/forecast/${key}/${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}?units=si&extend=hourly&exclude=minutely,daily,alerts`,
    )
  ).json()
  const items = j?.hourly?.data
  if (!items?.length) throw new Error(j?.message || 'PirateWeather error')
  const n = core.hourlyTime.length
  const idx = hourIndex(core.hourlyTime)
  const hourly = {
    temperature_2m: nullArr(n),
    precipitation: nullArr(n),
    weather_code: nullArr(n),
    relative_humidity_2m: nullArr(n),
    dew_point_2m: nullArr(n),
    pressure_msl: nullArr(n),
    wind_speed_10m: nullArr(n),
    cloud_cover: nullArr(n),
  }
  for (const item of items) {
    const local = new Date((item.time + core.utcOffsetSeconds) * 1000)
    const i = idx.get(`${local.toISOString().slice(0, 13)}:00`)
    if (i == null) continue
    hourly.temperature_2m[i] = item.temperature ?? null
    hourly.precipitation[i] = item.precipIntensity ?? null
    hourly.weather_code[i] = PIRATE_CODE[item.icon] ?? null
    hourly.relative_humidity_2m[i] = Number.isFinite(item.humidity) ? item.humidity * 100 : null
    hourly.dew_point_2m[i] = item.dewPoint ?? null
    hourly.pressure_msl[i] = item.pressure ?? null
    hourly.wind_speed_10m[i] = Number.isFinite(item.windSpeed) ? item.windSpeed * 3.6 : null
    hourly.cloud_cover[i] = Number.isFinite(item.cloudCover) ? item.cloudCover * 100 : null
  }
  return { hourly, daily: computeDaily(core, hourly) }
}

// Fetch every enabled extra source and merge it into a copy of the core
// forecast. Returns { merged, status } where merged is null when nothing was
// added and status carries a per-source result string for the sources panel.
export async function fetchExtraSources(core, loc, settings) {
  const jobs = []
  const status = {}
  const wrap = (id, promise) =>
    promise
      .then((d) => {
        if (d) {
          const hours = d.hourly.temperature_2m.filter(Number.isFinite).length
          status[id] = `active · ${hours}h of data`
          return [id, d]
        }
        status[id] = 'no data for this location'
        return null
      })
      .catch((e) => {
        status[id] = `error: ${String(e.message || e).slice(0, 60)}`
        return null
      })

  if (settings.nws?.on) {
    storage.bumpCall('nws')
    jobs.push(wrap('nws', fetchNWS(core, loc)))
  }
  if (settings.openweather?.on && settings.openweather.key) {
    if (storage.underCap('openweather', 900)) {
      storage.bumpCall('openweather')
      jobs.push(wrap('openweather', fetchOpenWeather(core, loc, settings.openweather.key.trim())))
    } else {
      status.openweather = 'daily budget reached, paused'
    }
  }
  if (settings.pirate?.on && settings.pirate.key) {
    if (storage.underCap('pirate', 300, 9000)) {
      storage.bumpCall('pirate')
      jobs.push(wrap('pirate', fetchPirate(core, loc, settings.pirate.key.trim())))
    } else {
      status.pirate = 'budget reached, paused'
    }
  }
  if (!jobs.length) return { merged: null, status }

  const done = (await Promise.all(jobs)).filter(Boolean)
  if (!done.length) return { merged: null, status }

  const merged = { ...core, hourly: { ...core.hourly }, daily: { ...core.daily } }
  for (const v of Object.keys(merged.hourly)) merged.hourly[v] = { ...merged.hourly[v] }
  for (const v of Object.keys(merged.daily)) merged.daily[v] = { ...merged.daily[v] }
  for (const [id, src] of done) {
    for (const [v, arr] of Object.entries(src.hourly)) {
      if (merged.hourly[v]) merged.hourly[v][id] = arr
    }
    for (const [v, arr] of Object.entries(src.daily)) {
      if (merged.daily[v]) merged.daily[v][id] = arr
    }
  }
  return { merged, status }
}
