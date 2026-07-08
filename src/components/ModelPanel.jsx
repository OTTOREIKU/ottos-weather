import React, { useState } from 'react'
import { MODELS } from '../api/openMeteo.js'
import { kstats, valuesAt } from '../lib/aggregate.js'
import { describe } from '../lib/weatherCodes.js'
import { temp1 } from '../lib/convert.js'

// Per-model current readout; doubles as the identity legend and table view.
// Collapsible so it stays out of the way on phones (collapsed by default there).
export default function ModelPanel({ data, units, weights, nowIndex }) {
  // collapsed by default on phones; a reported width of 0 (headless embeds) counts as desktop
  const [open, setOpen] = useState(() => typeof window === 'undefined' || !window.innerWidth || window.innerWidth > 820)
  const temps = valuesAt(data.hourly.temperature_2m, nowIndex)
  const codes = valuesAt(data.hourly.weather_code, nowIndex)
  const s = kstats(temps, weights)
  if (!s) return null

  // deviation bar scale: ±4°C from the mean fills half the track
  const SCALE = 4

  return (
    <div className="card">
      <button className="panel-toggle" onClick={() => setOpen((o) => !o)}>
        <span className="section-title" style={{ margin: 0 }}>Model breakdown: now</span>
        <span className="chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="panel-body">
          {MODELS.map((m) => {
            const t = temps[m.id]
            const has = Number.isFinite(t)
            const dev = has ? t - s.mean : 0
            const frac = Math.max(-1, Math.min(1, dev / SCALE)) / 2
            const left = frac < 0 ? 50 + frac * 100 : 50
            const width = Math.abs(frac) * 100
            return (
              <div className="model-row" key={m.id}>
                <span className="swatch" style={{ background: m.color }} />
                <span className="name">
                  {m.label}
                  <small>{m.agency}</small>
                </span>
                <span>{has ? describe(codes[m.id]).icon : ''}</span>
                <span className="t">{has ? `${temp1(t, units)}°` : '–'}</span>
                <span className="dev-track">
                  <span className="zero" />
                  {has && width > 0.5 && (
                    <span className="bar" style={{ left: `${left}%`, width: `${width}%`, background: m.color }} />
                  )}
                </span>
              </div>
            )
          })}
          <div className="panel-foot">
            Bars show each model's deviation from the {temp1(s.mean, units)}° mean (±{units === 'imperial' ? '7.2°F' : '4°C'} full scale)
          </div>
        </div>
      )}
    </div>
  )
}
