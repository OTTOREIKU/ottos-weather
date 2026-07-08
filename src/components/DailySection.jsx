import React from 'react'
import { stats, valuesAt, consensusCode, agreementAt } from '../lib/aggregate.js'
import { describe } from '../lib/weatherCodes.js'
import { temp, precip } from '../lib/convert.js'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function DailySection({ data, units }) {
  return (
    <div className="card chart-card">
      <div className="section-title">8-day outlook — mean with model range</div>
      <div className="daily-grid">
        {data.dailyTime.map((iso, i) => {
          const [y, mo, d] = iso.split('-').map(Number)
          const day = i === 0 ? 'Today' : DAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]
          const hi = stats(Object.values(valuesAt(data.daily.temperature_2m_max, i)))
          const lo = stats(Object.values(valuesAt(data.daily.temperature_2m_min, i)))
          const code = consensusCode(Object.values(valuesAt(data.daily.weather_code, i)))
          const cond = describe(code)
          const rain = agreementAt(data.daily.precipitation_sum, i, 0.2)
          const rainSum = stats(Object.values(valuesAt(data.daily.precipitation_sum, i)))
          const pr = precip(rainSum?.mean, units)
          const wet = rain.agree > 0 && rainSum?.mean > 0.1

          return (
            <div className="day-card" key={iso}>
              <div className="d">{day}</div>
              <div className="date">{mo}/{d}</div>
              <div className="ic">{cond.icon}</div>
              <div className="cond">{cond.label}</div>
              <div>
                <span className="hi">{temp(hi?.mean, units)}°</span>{' '}
                <span className="lo">{temp(lo?.mean, units)}°</span>
              </div>
              <div className="range">
                {temp(hi?.min, units)}–{temp(hi?.max, units)}° hi span
              </div>
              <div className={`rain ${wet ? '' : 'none'}`}>
                {wet ? `💧 ${rain.agree}/${rain.total} · ${pr.value} ${pr.unit}` : 'dry'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
