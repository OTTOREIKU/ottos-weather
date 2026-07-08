import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { fetchRadarFrames } from '../api/openMeteo.js'
import { buildNowcast } from '../lib/nowcast.js'

// Tile scheme (RainViewer-compatible, served by LibreWXR): 2 = Universal
// Blue. Native radar detail tops out around tile zoom 7, so request 512px
// tiles one zoom back and upscale past that.
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
  const layersRef = useRef(new Map()) // real frames: tile layers, keyed by time
  const overlaysRef = useRef(new Map()) // synthetic frames: image overlays, keyed by time
  const framesRef = useRef([])
  const stripRef = useRef(null)
  const regenTimer = useRef(null)
  const [frames, setFrames] = useState([]) // real radar frames
  const [synth, setSynth] = useState([]) // extrapolated future frames
  const [source, setSource] = useState(null) // librewxr | rainviewer (fallback)
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(true)

  // timeline = real past frames + (real nowcast if RainViewer ever restores it,
  // otherwise our extrapolated frames)
  const all = useMemo(() => [...frames, ...synth], [frames, synth])
  const lastPast = frames.length ? frames.filter((f) => !f.nowcast).length - 1 : 0
  const hasFuture = all.some((f) => f.nowcast)
  // the loop covers the last hour of past plus the future: where it's heading,
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
      overlaysRef.current = new Map()
    }
  }, [location.lat, location.lon])

  // fetch frames and pre-add every layer to the map so the first animation
  // pass doesn't flash while tiles stream in; refresh the set every 5 minutes
  const loadFrames = useCallback(async (initial) => {
    try {
      const { host, frames: next, source: src } = await fetchRadarFrames()
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
        framesRef.current = next
        framesRef.current.host = host
        setFrames(next)
        setSource(src)
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
    } catch {
      if (initial) setStatus('error')
    }
  }, [])

  useEffect(() => {
    loadFrames(true)
    const t = setInterval(() => loadFrames(false), REFRESH_MS)
    return () => clearInterval(t)
  }, [loadFrames])

  // build extrapolated future frames for the current viewport; reruns when the
  // frame set refreshes and (debounced) when the user pans or zooms
  const regenNowcast = useCallback(async () => {
    const map = mapRef.current
    const real = framesRef.current
    if (!map || !real.length) return
    if (real.some((f) => f.nowcast)) {
      // real nowcast exists (LibreWXR): drop any stale extrapolated overlays
      for (const ov of overlaysRef.current.values()) map.removeLayer(ov)
      overlaysRef.current = new Map()
      setSynth([])
      return
    }
    try {
      const result = await buildNowcast(map, real.host, real.filter((f) => !f.nowcast))
      const current = mapRef.current
      if (!current) return
      const next = new Map()
      for (const f of result) {
        const ov = L.imageOverlay(f.url, f.bounds, { opacity: 0, zIndex: 11 })
        ov.addTo(current)
        next.set(f.time, ov)
      }
      for (const ov of overlaysRef.current.values()) current.removeLayer(ov)
      overlaysRef.current = next
      setSynth(result)
    } catch {
      /* extrapolation is best-effort */
    }
  }, [])

  useEffect(() => {
    if (status !== 'ready') return
    regenNowcast()
  }, [status, frames, regenNowcast])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const onMove = () => {
      clearTimeout(regenTimer.current)
      regenTimer.current = setTimeout(regenNowcast, 700)
    }
    map.on('moveend zoomend', onMove)
    return () => {
      clearTimeout(regenTimer.current)
      map.off('moveend zoomend', onMove)
    }
  }, [regenNowcast, location.lat, location.lon])

  // keep the cursor valid if the frame list shrinks
  useEffect(() => {
    if (all.length && idx >= all.length) setIdx(all.length - 1)
  }, [all, idx])

  // show the active frame
  useEffect(() => {
    if (!all.length) return
    const active = all[Math.min(idx, all.length - 1)]?.time
    for (const [time, layer] of layersRef.current) layer.setOpacity(time === active ? 0.72 : 0)
    for (const [time, ov] of overlaysRef.current) ov.setOpacity(time === active ? 0.72 : 0)
  }, [idx, all])

  // playback: step forward, hold on the most-future frame, wrap to loop start
  useEffect(() => {
    if (!playing || status !== 'ready' || all.length < 2) return
    const atEnd = idx >= all.length - 1
    const t = setTimeout(() => setIdx(atEnd ? loopStart : idx + 1), atEnd ? HOLD_LAST_MS : FRAME_MS)
    return () => clearTimeout(t)
  }, [playing, status, idx, all, loopStart])

  const scrub = (e) => {
    if (!all.length || !stripRef.current) return
    const rect = stripRef.current.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    setPlaying(false)
    setIdx(Math.round(frac * (all.length - 1)))
  }

  const frame = all[Math.min(idx, Math.max(0, all.length - 1))]
  const minutesFromNow = frame ? Math.round((idx - lastPast) * 10) : 0
  const nowPct = all.length > 1 ? ((lastPast + 0.5) / all.length) * 100 : 100

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
              {minutesFromNow === 0
                ? 'now'
                : minutesFromNow > 0
                  ? `+${minutesFromNow} min${frame.synthetic ? ' est' : ''}`
                  : `${minutesFromNow} min`}
            </span>
          )}
        </div>
        <div
          className="radar-strip"
          ref={stripRef}
          onPointerDown={(e) => {
            try {
              e.currentTarget.setPointerCapture(e.pointerId)
            } catch {
              /* capture is a nice-to-have for drag; scrubbing works without it */
            }
            scrub(e)
          }}
          onPointerMove={(e) => e.buttons > 0 && scrub(e)}
        >
          {all.map((f, i) => (
            <span key={f.time} className={`seg ${f.nowcast ? 'future' : ''} ${i === idx ? 'active' : ''}`} />
          ))}
          <span className="now-tick" style={{ left: `${nowPct}%` }}>
            <i>NOW</i>
          </span>
        </div>
      </div>
      <div className="radar-strip-labels">
        <span>{all.length ? clock(all[0].time) : ''}</span>
        <span className="fut">
          {synth.length
            ? `+${synth.length * 10} min estimated`
            : hasFuture
              ? `${clock(all[all.length - 1].time)} forecast`
              : 'no precipitation to project'}
        </span>
      </div>
      <div className="radar-note">
        {source === 'rainviewer' ? (
          <>
            Radar by RainViewer (past 2 hours, fallback source). Amber frames are estimated
            in-app: storm motion is measured across the last 30 minutes of radar and projected
            forward, so treat them as a trend, not gospel.
          </>
        ) : (
          <>
            Radar and 1-hour forecast by <a href="https://librewxr.net/">LibreWXR</a> (open
            source, CC BY 4.0). Amber frames are the model nowcast of where precipitation is
            heading.
          </>
        )}
      </div>
    </div>
  )
}
