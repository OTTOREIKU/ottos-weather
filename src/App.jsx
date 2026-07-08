import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchForecast, fetchAlerts, fetchMinutely, fetchDetails } from './api/openMeteo.js'
import { fetchExtraSources, ALL_MODELS } from './api/sources.js'
import { weightsFromScores, biasFromScores, selectScope } from './lib/aggregate.js'
import * as storage from './lib/storage.js'
import * as sync from './lib/sync.js'
import AlertsBanner from './components/AlertsBanner.jsx'
import SearchBar from './components/SearchBar.jsx'
import CurrentCard from './components/CurrentCard.jsx'
import ModelPanel from './components/ModelPanel.jsx'
import HourlyChart from './components/HourlyChart.jsx'
import DailySection from './components/DailySection.jsx'
import DetailsSection from './components/DetailsSection.jsx'
import SourcesPanel from './components/SourcesPanel.jsx'
import RadarMap from './components/RadarMap.jsx'
import Scorecard from './components/Scorecard.jsx'

const AUTO_OPTIONS = [
  { value: 0, label: 'Auto: off' },
  { value: 5, label: 'Auto: 5 min' },
  { value: 10, label: 'Auto: 10 min' },
  { value: 30, label: 'Auto: 30 min' },
]

// scan the 15-minute precipitation series for a rain start/stop in the next
// ~2.5 hours relative to the location's local clock
function analyzeRainSoon(minutely) {
  if (!minutely?.time?.length) return null
  const nowLocal = new Date(Date.now() + minutely.utcOffsetSeconds * 1000)
  const isoNow = nowLocal.toISOString().slice(0, 16)
  let start = 0
  for (let i = 0; i < minutely.time.length; i++) {
    if (minutely.time[i] <= isoNow) start = i
    else break
  }
  const p = minutely.precipitation
  const val = (i) => (Number.isFinite(p[i]) ? p[i] : 0)
  const HORIZON = 10 // 15-min steps
  const fmt = (iso) => {
    const h = Number(iso.slice(11, 13))
    const h12 = h % 12 === 0 ? 12 : h % 12
    return `${h12}:${iso.slice(14, 16)} ${h >= 12 ? 'PM' : 'AM'}`
  }
  const rainingNow = val(start) > 0.1 || val(start + 1) > 0.1
  if (!rainingNow) {
    for (let i = start + 1; i <= Math.min(start + HORIZON, p.length - 1); i++) {
      if (val(i) > 0.15) return `🌧 Rain expected around ${fmt(minutely.time[i])}`
    }
    return null
  }
  for (let i = start + 1; i <= Math.min(start + HORIZON, p.length - 2); i++) {
    if (val(i) < 0.05 && val(i + 1) < 0.05) return `🌤 Rain easing around ${fmt(minutely.time[i])}`
  }
  return '🌧 Rain continuing for the next 2+ hours'
}

function agoLabel(ts) {
  if (!ts) return ''
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1) return 'updated just now'
  if (mins === 1) return 'updated 1 min ago'
  if (mins < 60) return `updated ${mins} min ago`
  return `updated ${Math.floor(mins / 60)}h ${mins % 60}m ago`
}

export default function App() {
  const [units, setUnits] = useState(storage.loadUnits)
  const [saved, setSaved] = useState(storage.loadLocations)
  const [location, setLocation] = useState(null)
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('idle') // idle | loading | ready | error
  const [errorMsg, setErrorMsg] = useState('')
  const [tab, setTab] = useState('forecast')
  const [hourlyWindow, setHourlyWindow] = useState(() => storage.loadSetting('window', 24))
  const [autoRefresh, setAutoRefresh] = useState(() => storage.loadSetting('autorefresh', 10))
  const [weighting, setWeighting] = useState(() => storage.loadSetting('weighting', true))
  const [biasCorrect, setBiasCorrect] = useState(() => storage.loadSetting('biascorrect', true))
  const [scores, setScores] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [rainSoon, setRainSoon] = useState(null)
  const [details, setDetails] = useState(null)
  const [sources, setSources] = useState(storage.loadSources)
  const [sourceStatus, setSourceStatus] = useState({})
  const [syncToken, setSyncToken] = useState(() => storage.loadSetting('synctoken', ''))
  const [syncStatus, setSyncStatus] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)
  const [, setTick] = useState(0) // re-render for the "updated x ago" label
  const locationRef = useRef(null)

  const select = useCallback(async (loc, isRefresh = false, force = false) => {
    locationRef.current = loc
    setLocation(loc)
    if (!isRefresh) setStatus('loading')
    // side data is best-effort and never blocks the forecast
    fetchAlerts(loc.lat, loc.lon, force).then((a) => locationRef.current === loc && setAlerts(a))
    fetchMinutely(loc.lat, loc.lon, force)
      .then((m) => locationRef.current === loc && setRainSoon(analyzeRainSoon(m)))
      .catch(() => setRainSoon(null))
    fetchDetails(loc.lat, loc.lon, force)
      .then((d) => locationRef.current === loc && setDetails(d))
      .catch(() => setDetails(null))
    try {
      const d = await fetchForecast(loc.lat, loc.lon, force)
      setData(d)
      setStatus('ready')
      setUpdatedAt(Date.now())
      storage.logSnapshot(loc, d)
      // enrich with the extra sources once they respond
      fetchExtraSources(d, loc, storage.loadSources(), force)
        .then(({ merged, status }) => {
          if (locationRef.current !== loc) return
          setSourceStatus(status)
          if (merged) setData(merged)
        })
        .catch(() => {})
    } catch (e) {
      if (!isRefresh) {
        setErrorMsg(e.message)
        setStatus('error')
      }
    }
  }, [])

  // manual refresh bypasses the cache; auto refresh lets TTLs decide
  const refresh = useCallback(() => {
    if (locationRef.current) select(locationRef.current, true, true)
  }, [select])
  const autoTick = useCallback(() => {
    if (locationRef.current) select(locationRef.current, true, false)
  }, [select])

  const geolocate = useCallback(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        select({
          name: 'My location',
          admin1: '',
          country: '',
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
        }),
      () => {},
      { timeout: 8000 },
    )
  }, [select])

  // reload every state slice from storage (after a cloud sync pull)
  const reloadFromStorage = useCallback(() => {
    setUnits(storage.loadUnits())
    setSaved(storage.loadLocations())
    setSources(storage.loadSources())
    setHourlyWindow(storage.loadSetting('window', 24))
    setAutoRefresh(storage.loadSetting('autorefresh', 10))
    setWeighting(storage.loadSetting('weighting', true))
    setBiasCorrect(storage.loadSetting('biascorrect', true))
  }, [])

  useEffect(() => {
    ;(async () => {
      const token = storage.loadSetting('synctoken', '')
      if (token) {
        try {
          const { data } = await sync.pull(token)
          if (data) {
            sync.apply(data)
            reloadFromStorage()
            setSyncStatus('synced from cloud')
          }
        } catch (e) {
          setSyncStatus(`sync error: ${String(e.message || e)}`)
        }
      }
      const list = storage.loadLocations()
      if (list.length) select(list[0])
      else geolocate()
    })()
  }, [select, geolocate, reloadFromStorage])

  const pushSync = useCallback(() => sync.schedulePush(setSyncStatus), [])

  const connectSync = useCallback(
    async (token) => {
      setSyncStatus('connecting…')
      try {
        const result = await sync.connect(token)
        storage.saveSetting('synctoken', token)
        setSyncToken(token)
        if (result === 'pulled') {
          reloadFromStorage()
          const list = storage.loadLocations()
          if (list.length) select(list[0])
          setSyncStatus('connected, settings loaded from cloud')
        } else {
          setSyncStatus('connected, this device seeded the cloud copy')
        }
      } catch (e) {
        setSyncStatus(`sync error: ${String(e.message || e)}`)
      }
    },
    [reloadFromStorage, select],
  )

  const disconnectSync = useCallback(() => {
    storage.saveSetting('synctoken', '')
    setSyncToken('')
    setSyncStatus('disconnected (settings stay on this device)')
  }, [])

  // model accuracy scores, produced by the scheduled GitHub Action
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/scores.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setScores)
      .catch(() => setScores(null))
  }, [])

  // auto refresh + "updated x ago" ticker
  useEffect(() => {
    const tick = setInterval(() => setTick((t) => t + 1), 30000)
    return () => clearInterval(tick)
  }, [])
  useEffect(() => {
    if (!autoRefresh) return
    const t = setInterval(autoTick, autoRefresh * 60000)
    return () => clearInterval(t)
  }, [autoRefresh, autoTick])

  const changeUnits = (u) => {
    setUnits(u)
    storage.saveUnits(u)
    pushSync()
  }
  const changeWindow = (w) => {
    setHourlyWindow(w)
    storage.saveSetting('window', w)
    pushSync()
  }
  const changeAutoRefresh = (v) => {
    setAutoRefresh(v)
    storage.saveSetting('autorefresh', v)
    pushSync()
  }
  const toggleWeighting = (on) => {
    setWeighting(on)
    storage.saveSetting('weighting', on)
    pushSync()
  }
  const toggleBias = (on) => {
    setBiasCorrect(on)
    storage.saveSetting('biascorrect', on)
    pushSync()
  }
  const changeSources = (next) => {
    setSources(next)
    storage.saveSources(next)
    pushSync()
    if (locationRef.current) select(locationRef.current, true)
  }

  const isSaved = useMemo(
    () => !!location && saved.some((s) => storage.locationKey(s) === storage.locationKey(location)),
    [saved, location],
  )

  const toggleSave = () => {
    if (!location) return
    const key = storage.locationKey(location)
    const next = isSaved ? saved.filter((s) => storage.locationKey(s) !== key) : [...saved, location]
    setSaved(next)
    storage.saveLocations(next)
    pushSync()
  }

  const removeSaved = (loc) => {
    const next = saved.filter((s) => storage.locationKey(s) !== storage.locationKey(loc))
    setSaved(next)
    storage.saveLocations(next)
    pushSync()
  }

  // index of the current hour in the forecast arrays (times are local to the
  // searched location; shift the clock by the location's UTC offset)
  const nowIndex = useMemo(() => {
    if (!data) return 0
    const nowLocal = new Date(Date.now() + data.utcOffsetSeconds * 1000)
    const iso = `${nowLocal.toISOString().slice(0, 13)}:00`
    let idx = 0
    for (let i = 0; i < data.hourlyTime.length; i++) {
      if (data.hourlyTime[i] <= iso) idx = i
      else break
    }
    return idx
  }, [data, updatedAt])

  // accuracy weights + learned bias corrections kick in once enough models
  // have 14+ verified days; location-specific scores win over pooled ones
  const scope = useMemo(
    () => (location ? selectScope(scores, storage.locationKey(location)) : null),
    [scores, location],
  )
  const modelIds = useMemo(() => ALL_MODELS.map((m) => m.id), [])
  const weights = useMemo(
    () => (weighting && scope ? weightsFromScores(scope.models, modelIds) : null),
    [scope, weighting, modelIds],
  )
  const bias = useMemo(
    () => (biasCorrect && scope ? biasFromScores(scope.models, modelIds) : null),
    [scope, biasCorrect, modelIds],
  )

  return (
    <div className="container">
      <div className="header">
        <div className="brand">
          OTTO's Weather
          <small>Multi-model forecast · mean &amp; spread</small>
        </div>
        <SearchBar onPick={select} onGeolocate={geolocate} />
        <div className="segmented">
          <button className={units === 'imperial' ? 'active' : ''} onClick={() => changeUnits('imperial')}>
            °F
          </button>
          <button className={units === 'metric' ? 'active' : ''} onClick={() => changeUnits('metric')}>
            °C
          </button>
        </div>
      </div>

      <div className="fav-row">
        <span className="fav-label">★ Favorites</span>
        {saved.length === 0 && <span className="fav-hint">tap the ☆ next to a location's name to save it here</span>}
        {saved.map((s) => (
          <span
            className={`chip ${location && storage.locationKey(s) === storage.locationKey(location) ? 'active' : ''}`}
            key={storage.locationKey(s)}
          >
            <button onClick={() => select(s)}>{s.name}</button>
            <button className="x" onClick={() => removeSaved(s)} title="Remove">
              ✕
            </button>
          </span>
        ))}
      </div>

      {location && status !== 'idle' && (
        <div className="tabs">
          <button className={tab === 'forecast' ? 'active' : ''} onClick={() => setTab('forecast')}>
            Forecast
          </button>
          <button className={tab === 'radar' ? 'active' : ''} onClick={() => setTab('radar')}>
            Radar
          </button>
          <span className="toolbar">
            <span className="updated">{agoLabel(updatedAt)}</span>
            <button className="refresh-btn" onClick={refresh} title="Refresh now" disabled={status === 'loading'}>
              ↻
            </button>
            <select className="auto-select" value={autoRefresh} onChange={(e) => changeAutoRefresh(Number(e.target.value))}>
              {AUTO_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </span>
        </div>
      )}

      {status === 'ready' && <AlertsBanner alerts={alerts} />}

      {status === 'idle' && (
        <div className="notice">Search for a city above, or hit ◎ to use your location.</div>
      )}
      {status === 'loading' && <div className="notice">Fetching forecast models…</div>}
      {status === 'error' && <div className="notice error">Couldn't load forecast: {errorMsg}</div>}

      {status === 'ready' && data && location && tab === 'forecast' && (
        <>
          <CurrentCard
            data={data}
            units={units}
            weights={weights}
            bias={bias}
            rainSoon={rainSoon}
            location={location}
            nowIndex={nowIndex}
            isSaved={isSaved}
            onToggleSave={toggleSave}
          />
          <ModelPanel data={data} units={units} weights={weights} nowIndex={nowIndex} />
          <DetailsSection data={data} details={details} units={units} nowIndex={nowIndex} />
          <HourlyChart
            data={data}
            units={units}
            weights={weights}
            bias={bias}
            startIndex={nowIndex}
            hours={hourlyWindow}
            nowIndex={nowIndex}
            title={`Next ${hourlyWindow} hours: temperature per model`}
            headerExtra={
              <div className="segmented small">
                {[12, 24, 48].map((w) => (
                  <button key={w} className={hourlyWindow === w ? 'active' : ''} onClick={() => changeWindow(w)}>
                    {w}h
                  </button>
                ))}
              </div>
            }
          />
          <DailySection data={data} units={units} weights={weights} bias={bias} nowIndex={nowIndex} />
          <Scorecard
            scores={scores}
            units={units}
            weighting={weighting}
            onToggleWeighting={toggleWeighting}
            weightsActive={!!weights}
            biasCorrect={biasCorrect}
            onToggleBias={toggleBias}
            biasActive={!!bias}
            scope={scope?.scope}
          />
          <SourcesPanel
            settings={sources}
            onChange={changeSources}
            status={sourceStatus}
            syncToken={syncToken}
            syncStatus={syncStatus}
            onConnect={connectSync}
            onDisconnect={disconnectSync}
          />
        </>
      )}

      {status === 'ready' && location && tab === 'radar' && <RadarMap location={location} />}

      <div className="footer">
        Forecast data by <a href="https://open-meteo.com/">Open-Meteo</a> (8 global models), with optional
        NWS, OpenWeather, and PirateWeather sources · Alerts by NWS · Radar by{' '}
        <a href="https://librewxr.net/">LibreWXR</a> (CC BY 4.0) · Map &copy; OpenStreetMap &amp; CARTO
      </div>
    </div>
  )
}
