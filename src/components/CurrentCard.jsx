import React from 'react'
import { kstats, valuesAt, consensusCode, spreadTone } from '../lib/aggregate.js'
import { describe } from '../lib/weatherCodes.js'
import { temp, wind, precip } from '../lib/convert.js'

const TONE_COLOR = { good: 'var(--good)', warning: 'var(--warning)', serious: 'var(--serious)', muted: 'var(--ink-3)' }
const TONE_ICON = { good: '●', warning: '▲', serious: '◆', muted: '·' }

function fmtClock(iso) {
  if (!iso) return '–'
  const [, hm] = iso.split('T')
  const [h, m] = hm.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

export default function CurrentCard({ data, units, weights, location, nowIndex, isSaved, onToggleSave }) {
  const at = (v) => valuesAt(data.hourly[v], nowIndex)
  const tempStats = kstats(at('temperature_2m'), weights)
  const feels = kstats(at('apparent_temperature'), weights)
  const humidity = kstats(at('relative_humidity_2m'))
  const windSt = kstats(at('wind_speed_10m'))
  const cloud = kstats(at('cloud_cover'))
  const rain = kstats(at('precipitation'))
  const code = consensusCode(Object.values(at('weather_code')))
  const cond = describe(code)

  const hi = kstats(valuesAt(data.daily.temperature_2m_max, 0), weights)
  const lo = kstats(valuesAt(data.daily.temperature_2m_min, 0), weights)
  const sunrise = Object.values(data.daily.sunrise).find(Array.isArray)?.[0]
  const sunset = Object.values(data.daily.sunset).find(Array.isArray)?.[0]

  const range = tempStats ? tempStats.max - tempStats.min : null
  const tone = spreadTone(range)
  const w = wind(windSt?.mean, units)
  const pr = precip(rain?.mean, units)

  return (
    <div className="card">
      <div className="current-head">
        <h2>{location.name}</h2>
        <span className="tz">{[location.admin1, location.country].filter(Boolean).join(' · ')}</span>
        <button className={`star ${isSaved ? 'on' : ''}`} onClick={onToggleSave} title={isSaved ? 'Remove favorite' : 'Add to favorites'}>
          {isSaved ? '★' : '☆'}
        </button>
      </div>

      <div className="current-main">
        <div className="current-icon">{cond.icon}</div>
        <div className="current-temp">{temp(tempStats?.mean, units)}°</div>
        <div className="current-cond">
          <div>{cond.label}</div>
          <div className="feels">Feels like {temp(feels?.mean, units)}°</div>
          <div className="badge">
            <span className="dot" style={{ background: TONE_COLOR[tone.tone] }} />
            {TONE_ICON[tone.tone]} {tone.label} · {temp(tempStats?.min, units)}–{temp(tempStats?.max, units)}° across {tempStats?.count ?? 0} models
            {weights ? ' · accuracy-weighted' : ''}
          </div>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat">
          <div className="k">High / Low</div>
          <div className="v">
            {temp(hi?.mean, units)}° <small>/ {temp(lo?.mean, units)}°</small>
          </div>
        </div>
        <div className="stat">
          <div className="k">Humidity</div>
          <div className="v">{humidity ? Math.round(humidity.mean) : '–'}<small>%</small></div>
        </div>
        <div className="stat">
          <div className="k">Wind</div>
          <div className="v">
            {w.value} <small>{w.unit}</small>
          </div>
        </div>
        <div className="stat">
          <div className="k">Cloud cover</div>
          <div className="v">{cloud ? Math.round(cloud.mean) : '–'}<small>%</small></div>
        </div>
        <div className="stat">
          <div className="k">Precip (now)</div>
          <div className="v">
            {pr.value} <small>{pr.unit}</small>
          </div>
        </div>
        <div className="stat">
          <div className="k">Sunrise / Sunset</div>
          <div className="v" style={{ fontSize: 13.5 }}>
            {fmtClock(sunrise)} <small>/ {fmtClock(sunset)}</small>
          </div>
        </div>
      </div>
    </div>
  )
}
