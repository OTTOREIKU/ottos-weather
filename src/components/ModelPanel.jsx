import React from 'react'
import { MODELS } from '../api/openMeteo.js'
import { stats, valuesAt } from '../lib/aggregate.js'
import { describe } from '../lib/weatherCodes.js'
import { temp1 } from '../lib/convert.js'

// Per-model current readout — doubles as the identity legend and table view.
export default function ModelPanel({ data, units, nowIndex }) {
  const temps = valuesAt(data.hourly.temperature_2m, nowIndex)
  const codes = valuesAt(data.hourly.weather_code, nowIndex)
  const s = stats(Object.values(temps))
  if (!s) return null

  // deviation bar scale: ±4°C from the mean fills half the track
  const SCALE = 4

  return (
    <div className="card">
      <div className="section-title">Model breakdown — now</div>
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
                <span
                  className="bar"
                  style={{ left: `${left}%`, width: `${width}%`, background: m.color }}
                />
              )}
            </span>
          </div>
        )
      })}
      <div className="panel-foot">Bars show each model's deviation from the {temp1(s.mean, units)}° mean (±{units === 'imperial' ? '7.2°F' : '4°C'} full scale)</div>
    </div>
  )
}
