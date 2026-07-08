import React, { useEffect, useRef, useState } from 'react'
import { geocode } from '../api/openMeteo.js'

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
          placeholder="Search a city or place…"
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
              {r.name} <span className="sub">{[r.admin1, r.country].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
