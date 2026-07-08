import React, { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { fetchRadarFrames } from '../api/openMeteo.js'

// RainViewer tile scheme: 2 = Universal Blue, smoothed, snow shown separately
const COLOR_SCHEME = 2

function frameLabel(frame) {
  const d = new Date(frame.time * 1000)
  const label = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return frame.nowcast ? { label, suffix: ' forecast' } : { label, suffix: '' }
}

export default function RadarMap({ location }) {
  const mapEl = useRef(null)
  const mapRef = useRef(null)
  const layersRef = useRef(new Map())
  const hostRef = useRef('')
  const [frames, setFrames] = useState([])
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [error, setError] = useState(null)

  // init map
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

  // load frames
  useEffect(() => {
    let alive = true
    fetchRadarFrames()
      .then(({ host, frames }) => {
        if (!alive) return
        hostRef.current = host
        setFrames(frames)
        // start on the most recent past frame ("now")
        const lastPast = frames.filter((f) => !f.nowcast).length - 1
        setIdx(Math.max(0, lastPast))
      })
      .catch((e) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [])

  // show active frame
  useEffect(() => {
    const map = mapRef.current
    if (!map || !frames.length) return
    const frame = frames[idx]
    const cache = layersRef.current
    if (!cache.has(frame.time)) {
      // RainViewer serves radar only up to tile zoom 7 (higher zooms return a
      // "Zoom Level Not Supported" placeholder). Request 512px tiles one zoom
      // back and let Leaflet upscale past the native resolution.
      const layer = L.tileLayer(
        `${hostRef.current}${frame.path}/512/{z}/{x}/{y}/${COLOR_SCHEME}/1_1.png`,
        { opacity: 0, tileSize: 512, zoomOffset: -1, maxNativeZoom: 8, maxZoom: 12, zIndex: 10 },
      )
      layer.addTo(map)
      cache.set(frame.time, layer)
    }
    for (const [time, layer] of cache) {
      layer.setOpacity(time === frame.time ? 0.72 : 0)
    }
  }, [idx, frames])

  // animation loop
  useEffect(() => {
    if (!playing || frames.length < 2) return
    const t = setInterval(() => setIdx((i) => (i + 1) % frames.length), 550)
    return () => clearInterval(t)
  }, [playing, frames])

  const frame = frames[idx]
  const info = frame ? frameLabel(frame) : null

  return (
    <div className="card radar-card">
      <div className="radar-map" ref={mapEl} />
      <div className="radar-controls">
        <button className="play" onClick={() => setPlaying((p) => !p)} title={playing ? 'Pause' : 'Play'}>
          {playing ? '⏸' : '▶'}
        </button>
        <input
          type="range"
          min="0"
          max={Math.max(0, frames.length - 1)}
          value={idx}
          onChange={(e) => {
            setPlaying(false)
            setIdx(Number(e.target.value))
          }}
        />
        <span className="ts">
          {error ? 'radar unavailable' : info ? (
            <>
              {info.label}
              {info.suffix && <span className="fc">{info.suffix}</span>}
            </>
          ) : 'loading…'}
        </span>
      </div>
      <div className="radar-note">Radar: RainViewer — past 2 hours plus short-term forecast (amber timestamps)</div>
    </div>
  )
}
