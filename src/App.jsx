import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchForecast } from './api/openMeteo.js'
import * as storage from './lib/storage.js'
import SearchBar from './components/SearchBar.jsx'
import CurrentCard from './components/CurrentCard.jsx'
import ModelPanel from './components/ModelPanel.jsx'
import HourlyChart from './components/HourlyChart.jsx'
import DailySection from './components/DailySection.jsx'
import RadarMap from './components/RadarMap.jsx'

export default function App() {
  const [units, setUnits] = useState(storage.loadUnits)
  const [saved, setSaved] = useState(storage.loadLocations)
  const [location, setLocation] = useState(null)
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('idle') // idle | loading | ready | error
  const [errorMsg, setErrorMsg] = useState('')
  const [tab, setTab] = useState('forecast')

  const select = useCallback(async (loc) => {
    setLocation(loc)
    setStatus('loading')
    try {
      const d = await fetchForecast(loc.lat, loc.lon)
      setData(d)
      setStatus('ready')
      storage.logSnapshot(loc, d)
    } catch (e) {
      setErrorMsg(e.message)
      setStatus('error')
    }
  }, [])

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
      () => {
        setStatus((s) => (s === 'idle' ? 'idle' : s))
      },
      { timeout: 8000 },
    )
  }, [select])

  useEffect(() => {
    const list = storage.loadLocations()
    if (list.length) select(list[0])
    else geolocate()
  }, [select, geolocate])

  const changeUnits = (u) => {
    setUnits(u)
    storage.saveUnits(u)
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
  }

  const removeSaved = (loc) => {
    const next = saved.filter((s) => storage.locationKey(s) !== storage.locationKey(loc))
    setSaved(next)
    storage.saveLocations(next)
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
  }, [data])

  return (
    <div className="container">
      <div className="header">
        <div className="brand">
          Weather Aggregator
          <small>7 independent forecast models · mean &amp; spread</small>
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

      {saved.length > 0 && (
        <div className="chips">
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
      )}

      {location && status !== 'idle' && (
        <div className="tabs">
          <button className={tab === 'forecast' ? 'active' : ''} onClick={() => setTab('forecast')}>
            Forecast
          </button>
          <button className={tab === 'radar' ? 'active' : ''} onClick={() => setTab('radar')}>
            Radar
          </button>
        </div>
      )}

      {status === 'idle' && (
        <div className="notice">Search for a city above, or hit ◎ to use your location.</div>
      )}
      {status === 'loading' && <div className="notice">Fetching 7 forecast models…</div>}
      {status === 'error' && <div className="notice error">Couldn't load forecast: {errorMsg}</div>}

      {status === 'ready' && data && location && tab === 'forecast' && (
        <>
          <div className="grid-top">
            <CurrentCard
              data={data}
              units={units}
              location={location}
              nowIndex={nowIndex}
              isSaved={isSaved}
              onToggleSave={toggleSave}
            />
            <ModelPanel data={data} units={units} nowIndex={nowIndex} />
          </div>
          <HourlyChart data={data} units={units} nowIndex={nowIndex} />
          <DailySection data={data} units={units} />
        </>
      )}

      {status === 'ready' && location && tab === 'radar' && <RadarMap location={location} />}

      <div className="footer">
        Forecast data by <a href="https://open-meteo.com/">Open-Meteo</a> (ECMWF, GFS, ICON, ARPEGE, UKMO,
        JMA, GEM) · Radar by <a href="https://www.rainviewer.com/">RainViewer</a> · Map &copy; OpenStreetMap
        &amp; CARTO
      </div>
    </div>
  )
}
