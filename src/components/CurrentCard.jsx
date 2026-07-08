import React from 'react'
import { kstats, valuesAt, consensusCode, spreadTone } from '../lib/aggregate.js'
import { describe } from '../lib/weatherCodes.js'
import { temp, precip } from '../lib/convert.js'

const TONE_COLOR = { good: 'var(--good)', warning: 'var(--warning)', serious: 'var(--serious)', muted: 'var(--ink-3)' }
const TONE_ICON = { good: '●', warning: '▲', serious: '◆', muted: '·' }

const RADAR_WORDS = ['', 'light rain', 'moderate rain', 'heavy rain']

export default function CurrentCard({ data, units, weights, bias, rainSoon, radarNow, location, nowIndex, isSaved, onToggleSave }) {
  const at = (v) => valuesAt(data.hourly[v], nowIndex)
  // bias corrections are learned on temperature, so they apply only there
  const tempStats = kstats(at('temperature_2m'), weights, bias)
  const feels = kstats(at('apparent_temperature'), weights)
  const humidity = kstats(at('relative_humidity_2m'))
  const rain = kstats(at('precipitation'))
  const code = consensusCode(Object.values(at('weather_code')))
  const cond = describe(code)

  const hi = kstats(valuesAt(data.daily.temperature_2m_max, 0), weights, bias)
  const lo = kstats(valuesAt(data.daily.temperature_2m_min, 0), weights, bias)

  const range = tempStats ? tempStats.max - tempStats.min : null
  const tone = spreadTone(range)
  const pr = precip(rain?.mean, units)
  const smart = [weights && 'weighted', bias && 'bias-corrected'].filter(Boolean).join(' · ')

  // reality check: live radar at this point vs what each model claims for
  // this hour. Shown whenever radar and the models disagree, or during rain.
  const precipNow = at('precipitation')
  const modelCalls = Object.entries(precipNow)
    .filter(([, v]) => Number.isFinite(v))
    .map(([id, v]) => ({ id, wet: v > 0.05 }))
  const wetModels = modelCalls.filter((m) => m.wet)
  let reality = null
  if (radarNow && modelCalls.length) {
    if (radarNow.raining) {
      reality = `📡 Radar: ${RADAR_WORDS[radarNow.intensity]} at your location · ${
        wetModels.length ? `${wetModels.length}/${modelCalls.length} models are calling it` : 'no model saw it coming'
      }`
    } else if (wetModels.length >= 2) {
      reality = `📡 Radar: dry at your location · ${wetModels.length}/${modelCalls.length} models expect rain this hour`
    }
  }

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
            {smart ? ` · ${smart}` : ''}
          </div>
          {reality && <div className="reality">{reality}</div>}
          {rainSoon && <div className="rain-soon">{rainSoon}</div>}
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
          <div className="k">Precip (now)</div>
          <div className="v">
            {pr.value} <small>{pr.unit}</small>
          </div>
        </div>
      </div>
    </div>
  )
}
