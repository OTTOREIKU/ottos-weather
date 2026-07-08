import React from 'react'
import { kstats, valuesAt } from '../lib/aggregate.js'
import { moonPhase } from '../lib/astro.js'
import { temp, pressure } from '../lib/convert.js'

const AQI_LEVELS = [
  [50, 'Good', 'var(--good)'],
  [100, 'Moderate', 'var(--warning)'],
  [150, 'Sensitive groups', 'var(--serious)'],
  [200, 'Unhealthy', '#d03b3b'],
  [300, 'Very unhealthy', '#d03b3b'],
  [Infinity, 'Hazardous', '#d03b3b'],
]

const UV_LEVELS = [
  [3, 'Low', 'var(--good)'],
  [6, 'Moderate', 'var(--warning)'],
  [8, 'High', 'var(--serious)'],
  [11, 'Very high', '#d03b3b'],
  [Infinity, 'Extreme', '#d03b3b'],
]

const level = (levels, v) => levels.find(([max]) => v <= max)

function Ring({ frac, color, children }) {
  const R = 42
  const C = 2 * Math.PI * R
  const f = Math.max(0.02, Math.min(1, frac))
  return (
    <div className="ring-wrap">
      <svg viewBox="0 0 100 100" className="ring">
        <circle cx="50" cy="50" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="7" />
        <circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${C * f} ${C}`}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div className="ring-content">{children}</div>
    </div>
  )
}

function clock12(iso) {
  if (!iso) return '–'
  const h = Number(iso.slice(11, 13))
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${iso.slice(14, 16)} ${h >= 12 ? 'PM' : 'AM'}`
}

const isoMinutes = (iso) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16))

export default function DetailsSection({ data, details, units, nowIndex }) {
  const humidity = kstats(valuesAt(data.hourly.relative_humidity_2m, nowIndex))
  const dew = kstats(valuesAt(data.hourly.dew_point_2m, nowIndex))
  const press = kstats(valuesAt(data.hourly.pressure_msl, nowIndex))
  const pressAgo = nowIndex >= 3 ? kstats(valuesAt(data.hourly.pressure_msl, nowIndex - 3)) : null
  const ps = pressure(press?.mean, units)
  const delta = press && pressAgo ? press.mean - pressAgo.mean : null
  const trend = delta == null ? null : delta > 1 ? ['↑', 'rising'] : delta < -1 ? ['↓', 'falling'] : ['→', 'steady']

  const sunrise = Object.values(data.daily.sunrise).find(Array.isArray)?.[0]
  const sunset = Object.values(data.daily.sunset).find(Array.isArray)?.[0]
  let sunFrac = null
  if (sunrise && sunset) {
    const nowLocal = new Date(Date.now() + data.utcOffsetSeconds * 1000)
    const nowMin = nowLocal.getUTCHours() * 60 + nowLocal.getUTCMinutes()
    sunFrac = (nowMin - isoMinutes(sunrise)) / Math.max(1, isoMinutes(sunset) - isoMinutes(sunrise))
  }
  const daylight = sunFrac != null && sunFrac >= 0 && sunFrac <= 1
  const sunX = daylight ? 75 - 60 * Math.cos(Math.PI * sunFrac) : null
  const sunY = daylight ? 85 - 60 * Math.sin(Math.PI * sunFrac) : null

  const moon = moonPhase()

  const aqiLevel = details?.aqi != null ? level(AQI_LEVELS, details.aqi) : null
  const uvLevel = details?.uvNow != null ? level(UV_LEVELS, details.uvNow) : null
  const visKm = details?.visibility != null ? details.visibility / 1000 : null
  const visVal =
    visKm == null ? null : units === 'imperial' ? `${(visKm * 0.621371).toFixed(1)}` : `${visKm.toFixed(1)}`
  const visQual = visKm == null ? '' : visKm >= 10 ? 'Good' : visKm >= 4 ? 'Moderate' : 'Poor'

  return (
    <div className="card chart-card">
      <div className="section-title">Details</div>
      <div className="details-grid">
        <div className="tile">
          <div className="tile-k">💧 Humidity</div>
          <div className="tile-v">{humidity ? Math.round(humidity.mean) : '–'}<small>%</small></div>
          <div className="tile-sub">Dew point {temp(dew?.mean, units)}°</div>
        </div>

        <div className="tile">
          <div className="tile-k">🫧 Air quality</div>
          {details?.aqi != null ? (
            <Ring frac={details.aqi / 300} color={aqiLevel[2]}>
              <div className="tile-v">{Math.round(details.aqi)}</div>
              <div className="tile-sub">{aqiLevel[1]}</div>
            </Ring>
          ) : (
            <div className="tile-sub">unavailable</div>
          )}
        </div>

        <div className="tile">
          <div className="tile-k">☀️ UV index</div>
          {details?.uvNow != null ? (
            <Ring frac={details.uvNow / 11} color={uvLevel[2]}>
              <div className="tile-v">{details.uvNow.toFixed(1)}</div>
              <div className="tile-sub">{uvLevel[1]}</div>
            </Ring>
          ) : (
            <div className="tile-sub">unavailable</div>
          )}
          {details?.uvMax != null && <div className="tile-sub">peak today {details.uvMax.toFixed(1)}</div>}
        </div>

        <div className="tile">
          <div className="tile-k">👁 Visibility</div>
          <div className="tile-v">
            {visVal ?? '–'}<small> {units === 'imperial' ? 'mi' : 'km'}</small>
          </div>
          <div className="tile-sub">{visQual}</div>
        </div>

        <div className="tile">
          <div className="tile-k">🌡 Pressure</div>
          <div className="tile-v">
            {ps.value}<small> {ps.unit}</small>
          </div>
          <div className="tile-sub">{trend ? `${trend[0]} ${trend[1]}` : ''}</div>
        </div>

        <div className="tile">
          <div className="tile-k">☀️ Sun</div>
          <svg viewBox="0 0 150 95" className="sun-arc">
            <path d="M 15 85 A 60 60 0 0 1 135 85" fill="none" stroke="var(--ink-3)" strokeWidth="1.5" strokeDasharray="3 5" />
            <line x1="8" y1="85" x2="142" y2="85" stroke="var(--surface-3)" strokeWidth="1" />
            {daylight && <circle cx={sunX} cy={sunY} r="7" fill="var(--warning)" />}
          </svg>
          <div className="sun-times">
            <span>{clock12(sunrise)}</span>
            {!daylight && <span className="tile-sub">night</span>}
            <span>{clock12(sunset)}</span>
          </div>
        </div>

        <div className="tile">
          <div className="tile-k">🌙 Moon</div>
          <div className="moon-emoji">{moon.emoji}</div>
          <div className="tile-sub">
            {moon.name} · {moon.illumination}% lit
          </div>
        </div>
      </div>
    </div>
  )
}
