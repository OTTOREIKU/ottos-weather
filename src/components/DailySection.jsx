import React, { useState } from 'react'
import { kstats, valuesAt, consensusCode, agreementAt } from '../lib/aggregate.js'
import { describe } from '../lib/weatherCodes.js'
import { temp, precip } from '../lib/convert.js'
import HourlyChart from './HourlyChart.jsx'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export default function DailySection({ data, units, weights, nowIndex }) {
  const [selected, setSelected] = useState(null)

  const dayName = (iso, i, full) => {
    if (i === 0) return 'Today'
    const [y, mo, d] = iso.split('-').map(Number)
    return (full ? DAYS_FULL : DAYS)[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]
  }

  // hourly start index for a calendar day; string match survives DST oddities
  const dayStart = (iso) => {
    const i = data.hourlyTime.indexOf(`${iso}T00:00`)
    return i >= 0 ? i : 0
  }

  return (
    <>
      <div className="card chart-card">
        <div className="section-title">8-day outlook, tap a day for its hourly detail</div>
        <div className="daily-grid">
          {data.dailyTime.map((iso, i) => {
            const hi = kstats(valuesAt(data.daily.temperature_2m_max, i), weights)
            const lo = kstats(valuesAt(data.daily.temperature_2m_min, i), weights)
            const code = consensusCode(Object.values(valuesAt(data.daily.weather_code, i)))
            const cond = describe(code)
            const rain = agreementAt(data.daily.precipitation_sum, i, 0.2)
            const rainSum = kstats(valuesAt(data.daily.precipitation_sum, i))
            const pr = precip(rainSum?.mean, units)
            const wet = rain.agree > 0 && rainSum?.mean > 0.1
            const [, mo, d] = iso.split('-').map(Number)

            return (
              <button
                className={`day-card ${selected === i ? 'selected' : ''}`}
                key={iso}
                onClick={() => setSelected(selected === i ? null : i)}
              >
                <div className="d">{dayName(iso, i)}</div>
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
              </button>
            )
          })}
        </div>
      </div>

      {selected != null && (
        <HourlyChart
          data={data}
          units={units}
          weights={weights}
          startIndex={dayStart(data.dailyTime[selected])}
          hours={24}
          nowIndex={nowIndex}
          title={`${dayName(data.dailyTime[selected], selected, true)} ${data.dailyTime[selected].slice(5).replace('-', '/')}: hourly detail`}
          headerExtra={
            <button className="close-btn" onClick={() => setSelected(null)}>
              ✕ close
            </button>
          }
        />
      )}
    </>
  )
}
