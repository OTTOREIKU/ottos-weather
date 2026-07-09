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
  let radarBadge = null
  if (radarNow && modelCalls.length) {
    if (radarNow.raining) {
      radarBadge = `${RADAR_WORDS[radarNow.intensity]} at your location · ${
        wetModels.length ? `${wetModels.length}/${modelCalls.length} models are calling it` : 'no model saw it coming'
      }`
    } else if (wetModels.length >= 2) {
      radarBadge = `dry at your location · ${wetModels.length}/${modelCalls.length} models expect rain this hour`
    }
  }
  // rain-soon strings arrive as "🌧 Rain expected around 3:40 PM"; split into
  // a title emoji and the detail line for the stacked badge
  const rainEmoji = rainSoon ? rainSoon.split(' ')[0] : ''
  const rainSub = rainSoon ? rainSoon.replace(/^\S+\s+Rain\s+/, '') : null

  return (
    <div className="card">
      <div className="current-head">
        <h2>{location.name}</h2>
        <span className="tz">{[location.admin1, location.country].filter(Boolean).join(' · ')}</span>
        <button className={`star ${isSaved ? 'on' : ''}`} onClick={onToggleSave} title={isSaved ? 'Remove favorite' : 'Add to favorites'}>
          {isSaved ? '★' : '☆'}
        </button>
      </div>

      <div className="hero-main">
        <div className="hero-id">
          <div className="current-icon">{cond.icon}</div>
          <div className="current-temp">{temp(tempStats?.mean, units)}°</div>
          <div className="hero-cond">
            <div className="cond-label">{cond.label}</div>
            <div className="feels">Feels like {temp(feels?.mean, units)}°</div>
            <div className="hilo">
              High {temp(hi?.mean, units)}° / Low {temp(lo?.mean, units)}°
            </div>
          </div>
        </div>
        <div className="hero-badges">
          <div className="hbadge">
            <div className="hb-title">
              <span className="dot" style={{ background: TONE_COLOR[tone.tone] }} />
              {TONE_ICON[tone.tone]} {tone.label}
            </div>
            <div className="hb-sub">
              {temp(tempStats?.min, units)}–{temp(tempStats?.max, units)}° across {tempStats?.count ?? 0} models
              {smart ? ` · ${smart}` : ''}
            </div>
          </div>
          {radarBadge && (
            <div className="hbadge radar">
              <div className="hb-title">📡 Radar</div>
              <div className="hb-sub">{radarBadge}</div>
            </div>
          )}
          {rainSub && (
            <div className="hbadge rain">
              <div className="hb-title">{rainEmoji} Rain soon</div>
              <div className="hb-sub">{rainSub}</div>
            </div>
          )}
        </div>
      </div>

      <div className="stat-row">
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
