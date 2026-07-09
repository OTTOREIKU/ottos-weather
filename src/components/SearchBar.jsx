import React, { useEffect, useRef, useState } from 'react'
import { geocode } from '../api/openMeteo.js'

// "35.78, -78.64" style input selects an exact point, no geocoding involved
// (handy for campsites and other places with no searchable name)
function parseCoords(q) {
  const m = q.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/)
  if (!m) return null
  const lat = Number(m[1])
  const lon = Number(m[2])
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { name: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, admin1: 'exact coordinates', country: '', lat, lon, isCoord: true }
}

export default function SearchBar({ onPick, onGeolocate }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const boxRef = useRef(null)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setOpen(false)
      return
    }
    const coords = parseCoords(q)
    if (coords) {
      setResults([coords])
      setOpen(true)
      setHi(0)
      return
    }
    const t = setTimeout(async () => {
      try {
        const r = await geocode(q)
        setResults(r)
        setOpen(r.length > 0)
        setHi(0)
      } catch {
        setResults([])
      }
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    const close = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const pick = (r) => {
    setQuery('')
    setResults([])
    setOpen(false)
    onPick(r)
  }

  const onKeyDown = (e) => {
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHi((h) => Math.min(h + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHi((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter' && results[hi]) {
      pick(results[hi])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="search" ref={boxRef}>
      <div className="search-box">
        <span style={{ color: 'var(--ink-3)' }}>⌕</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Search a city or coordinates"
          aria-label="Search location"
        />
        <button className="icon-btn" title="Use my location" onClick={onGeolocate}>
          ◎
        </button>
      </div>
      {open && (
        <div className="search-results">
          {results.map((r, i) => (
            <button key={`${r.lat},${r.lon}`} className={i === hi ? 'active' : ''} onClick={() => pick(r)}>
              {r.isCoord ? '📍 ' : ''}
              {r.name} <span className="sub">{[r.admin1, r.country].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
