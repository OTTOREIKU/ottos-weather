import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ALL_MODELS as MODELS } from '../api/sources.js'
import { aggregateSeries, agreementAt, consensusCode } from '../lib/aggregate.js'
import { describe } from '../lib/weatherCodes.js'
import { cToF, precip } from '../lib/convert.js'

// top margin holds the consensus sky-condition icon row
const M = { left: 46, right: 14, top: 40 }
const TEMP_H = 220
const GAP = 10
const PRECIP_H = 64
const AXIS_H = 26

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function weekday(iso) {
  const [y, mo, d] = iso.slice(0, 10).split('-').map(Number)
  return DAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]
}

function hourLabel(iso) {
  const h = Number(iso.slice(11, 13))
  if (h === 0) return '12 AM'
  if (h === 12) return '12 PM'
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

function niceStep(span, target) {
  const raw = span / target
  for (const s of [1, 2, 5, 10, 20]) if (s >= raw) return s
  return 50
}

// Generic multi-model hourly chart for any window of the forecast:
// the main "next N hours" view and the per-day detail both render through this.
export default function HourlyChart({ data, units, weights, bias, startIndex, hours, nowIndex, title, headerExtra }) {
  const wrapRef = useRef(null)
  const [width, setWidth] = useState(720)
  const [hover, setHover] = useState(null)
  const [pinned, setPinned] = useState(0) // last selected hour, for the mobile readout

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setWidth(Math.max(300, el.getBoundingClientRect().width))
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    window.addEventListener('resize', measure)
    // fallback poll for environments where neither fires; no-op when unchanged
    const poll = setInterval(measure, 1000)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
      clearInterval(poll)
    }
  }, [])

  const u = (c) => (units === 'imperial' ? cToF(c) : c)

  const view = useMemo(() => {
    const start = Math.max(0, startIndex)
    const end = Math.min(start + hours, data.hourlyTime.length)
    const n = Math.max(1, end - start)
    const times = data.hourlyTime.slice(start, end)

    const slice = (variable) => {
      const out = {}
      for (const m of MODELS) {
        const arr = data.hourly[variable][m.id]
        out[m.id] = Array.isArray(arr) ? arr.slice(start, end) : null
      }
      return out
    }
    const perModelTemp = slice('temperature_2m')
    const perModelPrecip = slice('precipitation')
    const perModelCode = slice('weather_code')
    const codeArrays = Object.values(perModelCode).filter(Array.isArray)
    const conds = []
    for (let i = 0; i < n; i++) {
      const code = consensusCode(codeArrays.map((a) => a[i]))
      conds.push(code == null ? null : describe(code))
    }
    return {
      start,
      n,
      times,
      perModelTemp,
      agg: aggregateSeries(perModelTemp, weights, bias),
      perModelPrecip,
      precipAgg: aggregateSeries(perModelPrecip),
      conds,
    }
  }, [data, startIndex, hours, weights, bias])

  // reset the selection when the window moves
  useEffect(() => {
    const nowInWindow = nowIndex - view.start
    setPinned(nowInWindow >= 0 && nowInWindow < view.n ? nowInWindow : 0)
    setHover(null)
  }, [view.start, view.n, nowIndex])

  const innerW = width - M.left - M.right
  const hourW = innerW / view.n
  const x = (i) => M.left + (i + 0.5) * hourW

  const allTemps = Object.values(view.perModelTemp)
    .filter(Boolean)
    .flat()
    .filter(Number.isFinite)
    .map(u)
  const tMin = allTemps.length ? Math.min(...allTemps) : 0
  const tMax = allTemps.length ? Math.max(...allTemps) : 1
  const pad = Math.max(1.5, (tMax - tMin) * 0.12)
  const yLo = tMin - pad
  const yHi = tMax + pad
  const yT = (v) => M.top + TEMP_H - ((v - yLo) / (yHi - yLo)) * TEMP_H

  const step = niceStep(yHi - yLo, 5)
  const ticks = []
  for (let t = Math.ceil(yLo / step) * step; t <= yHi; t += step) ticks.push(t)

  const pMax = Math.max(0.5, ...view.precipAgg.mean.filter(Number.isFinite))
  const pTop = M.top + TEMP_H + GAP
  const yP = (v) => pTop + PRECIP_H - (v / pMax) * PRECIP_H

  const height = M.top + TEMP_H + GAP + PRECIP_H + AXIS_H

  // x-label cadence: denser for short windows, sparser on narrow screens
  const labelEvery = useMemo(() => {
    const base = view.n <= 12 ? 2 : view.n <= 24 ? 3 : 6
    return width < 520 ? base * 2 : base
  }, [view.n, width])

  const linePath = (arr) => {
    let d = ''
    let pen = false
    for (let i = 0; i < view.n; i++) {
      const v = arr?.[i]
      if (Number.isFinite(v)) {
        d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${yT(u(v)).toFixed(1)}`
        pen = true
      } else {
        pen = false
      }
    }
    return d
  }

  const bandPath = useMemo(() => {
    const top = []
    const bot = []
    for (let i = 0; i < view.n; i++) {
      const hi = view.agg.max[i]
      const lo = view.agg.min[i]
      if (Number.isFinite(hi) && Number.isFinite(lo)) {
        top.push(`${x(i).toFixed(1)},${yT(u(hi)).toFixed(1)}`)
        bot.push(`${x(i).toFixed(1)},${yT(u(lo)).toFixed(1)}`)
      }
    }
    if (!top.length) return ''
    return `M${top.join('L')}L${bot.reverse().join('L')}Z`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, width, units])

  const indexFromEvent = (e) => {
    const rect = wrapRef.current.getBoundingClientRect()
    const mx = e.clientX - rect.left
    return Math.max(0, Math.min(view.n - 1, Math.floor((mx - M.left) / hourW)))
  }

  const onPointerMove = (e) => {
    // mouse hovers freely; touch scrubs while the finger is down
    if (e.pointerType !== 'mouse' && e.buttons === 0) return
    const i = indexFromEvent(e)
    setHover(i)
    setPinned(i)
  }

  const onPointerDown = (e) => {
    const i = indexFromEvent(e)
    setHover(i)
    setPinned(i)
  }

  const onPointerLeave = (e) => {
    if (e.pointerType === 'mouse') setHover(null)
  }

  // clamp: hover/pinned can briefly exceed the window right after it shrinks
  // (e.g. scrubbed to hour 40, then switched 48h -> 12h)
  const sel = Math.max(0, Math.min(hover ?? pinned, view.n - 1))
  const nowInWindow = nowIndex - view.start
  const showNow = nowInWindow >= 0 && nowInWindow < view.n

  const ttLeft = hover != null ? Math.min(x(sel) + 12, width - 196) : 0
  const selRain = agreementAt(view.perModelPrecip, sel)
  const selRainMean = view.precipAgg.mean[sel]
  const selPr = precip(selRainMean, units)

  const readoutRows = MODELS.map((m) => {
    const v = view.perModelTemp[m.id]?.[sel]
    return Number.isFinite(v) ? { ...m, temp: Math.round(u(v)) } : null
  }).filter(Boolean)

  return (
    <div className="card chart-card">
      <div className="chart-head">
        <div className="section-title">{title}</div>
        {headerExtra}
      </div>
      <div
        className="chart-wrap"
        ref={wrapRef}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerLeave={onPointerLeave}
      >
        <svg width={width} height={height} role="img" aria-label="Hourly temperature forecast per model">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={yT(t)} y2={yT(t)} stroke="var(--grid)" strokeWidth="1" />
              <text x={M.left - 8} y={yT(t) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)">
                {Math.round(t)}°
              </text>
            </g>
          ))}

          {view.times.map((iso, i) => {
            const h = Number(iso.slice(11, 13))
            const els = []
            if (h === 0 && i > 0) {
              els.push(
                <line
                  key="d"
                  x1={x(i) - hourW / 2}
                  x2={x(i) - hourW / 2}
                  y1={M.top}
                  y2={pTop + PRECIP_H}
                  stroke="var(--surface-3)"
                  strokeWidth="1"
                />,
                <text key="dl" x={x(i)} y={height - 4} fontSize="11" fontWeight="700" fill="var(--ink-2)">
                  {weekday(iso)}
                </text>,
              )
            } else if (h % labelEvery === 0 && h !== 0 && i !== nowInWindow) {
              els.push(
                <text key="h" x={x(i)} y={height - 4} textAnchor="middle" fontSize="11" fill="var(--ink-3)">
                  {hourLabel(iso)}
                </text>,
              )
            }
            return els.length ? <g key={iso}>{els}</g> : null
          })}

          {/* consensus sky-condition icons */}
          {view.times.map((iso, i) => {
            const h = Number(iso.slice(11, 13))
            const isCadence = h % labelEvery === 0
            // also show one on the first hour unless a cadence icon is right next to it
            if (!(isCadence || (i === 0 && h % labelEvery > 1))) return null
            const c = view.conds[i]
            if (!c) return null
            return (
              <text key={`ic${iso}`} x={x(i)} y={24} textAnchor="middle" fontSize="15">
                {c.icon}
              </text>
            )
          })}

          <path d={bandPath} fill="rgba(255,255,255,0.07)" />

          {MODELS.map((m) => (
            <path
              key={m.id}
              d={linePath(view.perModelTemp[m.id])}
              fill="none"
              stroke={m.color}
              strokeWidth="1.5"
              strokeOpacity="0.6"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          <path
            d={linePath(view.agg.mean)}
            fill="none"
            stroke="var(--ink)"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {view.precipAgg.mean.map((v, i) =>
            Number.isFinite(v) && v > 0.01 ? (
              <rect
                key={i}
                x={x(i) - Math.max(1, hourW / 2 - 1)}
                y={yP(v)}
                width={Math.max(2, hourW - 2)}
                height={pTop + PRECIP_H - yP(v)}
                rx="2"
                fill="var(--accent)"
                fillOpacity="0.9"
              />
            ) : null,
          )}
          <line x1={M.left} x2={width - M.right} y1={pTop + PRECIP_H} y2={pTop + PRECIP_H} stroke="var(--grid)" strokeWidth="1" />
          <text x={M.left - 8} y={pTop + 10} textAnchor="end" fontSize="10" fill="var(--ink-3)">
            rain
          </text>

          {/* now marker */}
          {showNow && (
            <g>
              <line
                x1={x(nowInWindow)}
                x2={x(nowInWindow)}
                y1={M.top}
                y2={pTop + PRECIP_H}
                stroke="var(--ink-2)"
                strokeWidth="1"
                strokeDasharray="1 3"
              />
              <text x={x(nowInWindow)} y={height - 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--ink)">
                Now
              </text>
            </g>
          )}

          {/* selection crosshair */}
          <line x1={x(sel)} x2={x(sel)} y1={M.top} y2={pTop + PRECIP_H} stroke="var(--ink-3)" strokeWidth="1" />
        </svg>

        {hover != null && (
          <div className="chart-tooltip" style={{ left: ttLeft, top: 8 }}>
            <div className="tt-time">
              {weekday(view.times[sel])} {hourLabel(view.times[sel])}
            </div>
            {view.conds[sel] && (
              <div className="tt-cond">
                {view.conds[sel].icon} {view.conds[sel].label}
              </div>
            )}
            {readoutRows.map((m) => (
              <div className="tt-row" key={m.id}>
                <span className="l">
                  <span className="swatch" style={{ background: m.color }} />
                  {m.label}
                </span>
                <span>{m.temp}°</span>
              </div>
            ))}
            <div className="tt-row tt-mean">
              <span>Mean</span>
              <span>{Number.isFinite(view.agg.mean[sel]) ? Math.round(u(view.agg.mean[sel])) : '–'}°</span>
            </div>
            {selRain.agree > 0 && (
              <div className="tt-row">
                <span className="l">Rain</span>
                <span>
                  {selRain.agree}/{selRain.total} models · {selPr.value} {selPr.unit}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* pinned readout for touch devices: drag across the chart to scrub */}
      <div className="pin-readout">
        <div className="pr-head">
          <span className="pr-time">
            {weekday(view.times[sel])} {hourLabel(view.times[sel])}
          </span>
          {view.conds[sel] && (
            <span className="pr-cond">
              {view.conds[sel].icon} {view.conds[sel].label}
            </span>
          )}
          <span className="pr-mean">
            {Number.isFinite(view.agg.mean[sel]) ? Math.round(u(view.agg.mean[sel])) : '–'}°
            <small>
              {' '}
              ({Number.isFinite(view.agg.min[sel]) ? Math.round(u(view.agg.min[sel])) : '–'}–
              {Number.isFinite(view.agg.max[sel]) ? Math.round(u(view.agg.max[sel])) : '–'}°)
            </small>
          </span>
          <span className="pr-rain">
            {selRain.agree > 0 ? `💧 ${selRain.agree}/${selRain.total} · ${selPr.value} ${selPr.unit}` : 'dry'}
          </span>
        </div>
        <div className="pr-models">
          {readoutRows.map((m) => (
            <span className="pr-chip" key={m.id}>
              <span className="swatch" style={{ background: m.color }} />
              {m.label} {m.temp}°
            </span>
          ))}
        </div>
      </div>

      <div className="legend">
        <span className="item">
          <span className="line-key" /> Mean
        </span>
        <span className="item">
          <span className="swatch" style={{ background: 'rgba(255,255,255,0.14)', borderRadius: 2, width: 12 }} /> Model spread
        </span>
        {MODELS.filter((m) => Array.isArray(view.perModelTemp[m.id])).map((m) => (
          <span className="item" key={m.id}>
            <span className="swatch" style={{ background: m.color }} /> {m.label}
          </span>
        ))}
      </div>
    </div>
  )
}
