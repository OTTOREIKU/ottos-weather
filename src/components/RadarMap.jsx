import React, { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { fetchRadarFrames } from '../api/openMeteo.js'

// RainViewer tile scheme: 2 = Universal Blue. Radar data exists only up to
// tile zoom 7, so request 512px tiles one zoom back and upscale past that.
const COLOR_SCHEME = 2
const FRAME_MS = 500
const HOLD_LAST_MS = 1600
const REFRESH_MS = 5 * 60 * 1000

function clock(ts) {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export default function RadarMap({ location }) {
  const mapEl = useRef(null)
  const mapRef = useRef(null)
  const layersRef = useRef(new Map())
  const stripRef = useRef(null)
  const [frames, setFrames] = useState([])
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(true)

  const lastPast = frames.length ? frames.filter((f) => !f.nowcast).length - 1 : 0
  const hasNowcast = frames.some((f) => f.nowcast)
  // the loop covers the last hour of past plus all nowcast: where it's heading,
  // not where it's been. Older frames stay reachable through the timeline.
  const loopStart = Math.max(0, lastPast - 6)

  // init map once per location
  useEffect(() => {
    const map = L.map(mapEl.current, { center: [location.lat, location.lon], zoom: 8, zoomControl: true })
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 12,
    }).addTo(map)
    L.circleMarker([location.lat, location.lon], {
      radius: 7,
      color: '#ffffff',
      weight: 2,
      fillColor: '#3987e5',
      fillOpacity: 1,
    }).addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      layersRef.current = new Map()
    }
  }, [location.lat, location.lon])

  // fetch frames and pre-add every layer to the map so the first animation
  // pass doesn't flash while tiles stream in; refresh the set every 5 minutes
  const loadFrames = useCallback(async (initial) => {
    try {
      const { host, frames: next } = await fetchRadarFrames()
      const map = mapRef.current
      if (!map) return
      if (initial) setStatus('loading')

      const old = layersRef.current
      const cache = new Map()
      let loaded = 0
      let settled = false
      const settle = () => {
        if (settled) return
        settled = true
        setFrames(next)
        const lp = next.filter((f) => !f.nowcast).length - 1
        setIdx(Math.max(0, lp))
        setStatus('ready')
        // drop layers that are no longer in the frame list
        for (const [time, layer] of old) if (!cache.has(time)) map.removeLayer(layer)
        layersRef.current = cache
      }

      for (const frame of next) {
        if (old.has(frame.time)) {
          cache.set(frame.time, old.get(frame.time))
          loaded++
          continue
        }
        const layer = L.tileLayer(`${host}${frame.path}/512/{z}/{x}/{y}/${COLOR_SCHEME}/1_1.png`, {
          opacity: 0,
          tileSize: 512,
          zoomOffset: -1,
          maxNativeZoom: 8,
          maxZoom: 12,
          zIndex: 10,
        })
        layer.once('load', () => {
          loaded++
          if (loaded >= next.length) settle()
        })
        layer.addTo(map)
        cache.set(frame.time, layer)
      }
      if (loaded >= next.length) settle()
      // don't wait forever on a slow tile server
      setTimeout(settle, 8000)
    } catch (e) {
      if (initial) setStatus('error')
    }
  }, [])

  useEffect(() => {
    loadFrames(true)
    const t = setInterval(() => loadFrames(false), REFRESH_MS)
    return () => clearInterval(t)
  }, [loadFrames])

  // show the active frame
  useEffect(() => {
    if (!frames.length) return
    const active = frames[idx]?.time
    for (const [time, layer] of layersRef.current) {
      layer.setOpacity(time === active ? 0.72 : 0)
    }
  }, [idx, frames])

  // playback: step forward, hold on the most-future frame, wrap to loop start
  useEffect(() => {
    if (!playing || status !== 'ready' || frames.length < 2) return
    const atEnd = idx >= frames.length - 1
    const t = setTimeout(() => setIdx(atEnd ? loopStart : idx + 1), atEnd ? HOLD_LAST_MS : FRAME_MS)
    return () => clearTimeout(t)
  }, [playing, status, idx, frames, loopStart])

  const scrub = (e) => {
    if (!frames.length || !stripRef.current) return
    const rect = stripRef.current.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    setPlaying(false)
    setIdx(Math.round(frac * (frames.length - 1)))
  }

  const frame = frames[idx]
  const minutesFromNow = frame ? Math.round((idx - lastPast) * 10) : 0
  const nowPct = frames.length > 1 ? ((lastPast + 0.5) / frames.length) * 100 : 100

  return (
    <div className="card radar-card">
      <div className="radar-map-wrap">
        <div className="radar-map" ref={mapEl} />
        {status === 'loading' && <div className="radar-overlay">Loading radar animation…</div>}
        {status === 'error' && <div className="radar-overlay">Radar unavailable right now</div>}
      </div>

      <div className="radar-controls">
        <button className="play" onClick={() => setPlaying((p) => !p)} title={playing ? 'Pause' : 'Play'} disabled={status !== 'ready'}>
          {playing ? '⏸' : '▶'}
        </button>
        <div className="radar-time">
          <span className="rt-clock">{frame ? clock(frame.time) : '–:–'}</span>
          {frame && (
            <span className={`rt-tag ${frame.nowcast ? 'future' : ''}`}>
              {minutesFromNow === 0 ? 'now' : minutesFromNow > 0 ? `+${minutesFromNow} min` : `${minutesFromNow} min`}
            </span>
          )}
        </div>
        <div
          className="radar-strip"
          ref={stripRef}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            scrub(e)
          }}
          onPointerMove={(e) => e.buttons > 0 && scrub(e)}
        >
          {frames.map((f, i) => (
            <span key={f.time} className={`seg ${f.nowcast ? 'future' : ''} ${i === idx ? 'active' : ''}`} />
          ))}
          <span className="now-tick" style={{ left: `${nowPct}%` }}>
            <i>NOW</i>
          </span>
        </div>
      </div>
      <div className="radar-strip-labels">
        <span>{frames.length ? clock(frames[0].time) : ''}</span>
        <span className="fut">{hasNowcast ? `${clock(frames[frames.length - 1].time)} forecast` : 'nowcast unavailable'}</span>
      </div>
      <div className="radar-note">
        Radar by RainViewer: past 2 hours plus a ~30 minute forecast (amber). Loops over the last hour and where it's heading.
      </div>
    </div>
  )
}
