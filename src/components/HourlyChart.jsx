import React, { useEffect, useMemo, useRef, useState } from 'react'
import { MODELS } from '../api/openMeteo.js'
import { aggregateSeries, agreementAt } from '../lib/aggregate.js'
import { cToF, precip } from '../lib/convert.js'

const HOURS = 48
const M = { left: 46, right: 14, top: 14 }
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

export default function HourlyChart({ data, units, nowIndex }) {
  const wrapRef = useRef(null)
  const [width, setWidth] = useState(900)
  const [hover, setHover] = useState(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setWidth(Math.max(300, el.getBoundingClientRect().width))
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    window.addEventListener('resize', measure)
    // fallback poll — setWidth with an unchanged value is a no-op re-render
    const poll = setInterval(measure, 1000)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
      clearInterval(poll)
    }
  }, [])

  const u = (c) => (units === 'imperial' ? cToF(c) : c)

  const view = useMemo(() => {
    const start = nowIndex
    const end = Math.min(start + HOURS, data.hourlyTime.length)
    const n = end - start
    const times = data.hourlyTime.slice(start, end)

    const perModelTemp = {}
    for (const m of MODELS) {
      const arr = data.hourly.temperature_2m[m.id]
      perModelTemp[m.id] = Array.isArray(arr) ? arr.slice(start, end) : null
    }
    const agg = aggregateSeries(perModelTemp)

    const perModelPrecip = {}
    for (const m of MODELS) {
      const arr = data.hourly.precipitation[m.id]
      perModelPrecip[m.id] = Array.isArray(arr) ? arr.slice(start, end) : null
    }
    const precipAgg = aggregateSeries(perModelPrecip)

    return { start, n, times, perModelTemp, agg, perModelPrecip, precipAgg }
  }, [data, nowIndex])

  const innerW = width - M.left - M.right
  const hourW = innerW / view.n
  const x = (i) => M.left + (i + 0.5) * hourW

  // temperature y-scale over all model values in the window
  const allTemps = Object.values(view.perModelTemp)
    .filter(Boolean)
    .flat()
    .filter(Number.isFinite)
    .map(u)
  const tMin = Math.min(...allTemps)
  const tMax = Math.max(...allTemps)
  const pad = Math.max(1.5, (tMax - tMin) * 0.12)
  const yLo = tMin - pad
  const yHi = tMax + pad
  const yT = (v) => M.top + TEMP_H - ((v - yLo) / (yHi - yLo)) * TEMP_H

  const step = niceStep(yHi - yLo, 5)
  const ticks = []
  for (let t = Math.ceil(yLo / step) * step; t <= yHi; t += step) ticks.push(t)

  // precipitation scale (native mm)
  const pMax = Math.max(0.5, ...view.precipAgg.mean.filter(Number.isFinite))
  const pTop = M.top + TEMP_H + GAP
  const yP = (v) => pTop + PRECIP_H - (v / pMax) * PRECIP_H

  const height = M.top + TEMP_H + GAP + PRECIP_H + AXIS_H

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

  const onMove = (e) => {
    const rect = wrapRef.current.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const i = Math.max(0, Math.min(view.n - 1, Math.floor((mx - M.left) / hourW)))
    setHover(i)
  }

  const ttLeft = hover != null ? Math.min(x(hover) + 12, width - 196) : 0
  const rain = hover != null ? agreementAt(view.perModelPrecip, hover) : null
  const rainMean = hover != null ? view.precipAgg.mean[hover] : null
  const pr = precip(rainMean, units)

  return (
    <div className="card chart-card">
      <div className="section-title">Next 48 hours — temperature per model</div>
      <div className="chart-wrap" ref={wrapRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg width={width} height={height} role="img" aria-label="Hourly temperature forecast per model">
          {/* gridlines + y ticks */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={yT(t)} y2={yT(t)} stroke="var(--grid)" strokeWidth="1" />
              <text x={M.left - 8} y={yT(t) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)">
                {Math.round(t)}°
              </text>
            </g>
          ))}

          {/* day boundaries + x labels */}
          {view.times.map((iso, i) => {
            const h = Number(iso.slice(11, 13))
            const els = []
            if (h === 0 && i > 0) {
              els.push(
                <line key="d" x1={x(i) - hourW / 2} x2={x(i) - hourW / 2} y1={M.top} y2={pTop + PRECIP_H} stroke="var(--surface-3)" strokeWidth="1" />,
                <text key="dl" x={x(i)} y={height - 4} fontSize="11" fontWeight="700" fill="var(--ink-2)">
                  {weekday(iso)}
                </text>,
              )
            }
            if (i === 0) {
              els.push(
                <text key="now" x={x(i) - hourW / 2} y={height - 4} fontSize="11" fontWeight="700" fill="var(--ink)">
                  Now
                </text>,
              )
            } else if (h % 6 === 0 && h !== 0 && i > 2) {
              els.push(
                <text key="h" x={x(i)} y={height - 4} textAnchor="middle" fontSize="11" fill="var(--ink-3)">
                  {hourLabel(iso)}
                </text>,
              )
            }
            return els.length ? <g key={iso}>{els}</g> : null
          })}

          {/* spread band */}
          <path d={bandPath} fill="rgba(255,255,255,0.07)" />

          {/* per-model lines */}
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

          {/* mean line */}
          <path d={linePath(view.agg.mean)} fill="none" stroke="var(--ink)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

          {/* precipitation bars (mean across models) */}
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

          {/* crosshair */}
          {hover != null && (
            <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={pTop + PRECIP_H} stroke="var(--ink-3)" strokeWidth="1" />
          )}
        </svg>

        {hover != null && (
          <div className="chart-tooltip" style={{ left: ttLeft, top: 8 }}>
            <div className="tt-time">
              {weekday(view.times[hover])} {hourLabel(view.times[hover])}
            </div>
            {MODELS.map((m) => {
              const v = view.perModelTemp[m.id]?.[hover]
              if (!Number.isFinite(v)) return null
              return (
                <div className="tt-row" key={m.id}>
                  <span className="l">
                    <span className="swatch" style={{ background: m.color }} />
                    {m.label}
                  </span>
                  <span>{Math.round(u(v))}°</span>
                </div>
              )
            })}
            <div className="tt-row tt-mean">
              <span>Mean</span>
              <span>{Number.isFinite(view.agg.mean[hover]) ? Math.round(u(view.agg.mean[hover])) : '–'}°</span>
            </div>
            {rain && rain.agree > 0 && (
              <div className="tt-row">
                <span className="l">Rain</span>
                <span>
                  {rain.agree}/{rain.total} models · {pr.value} {pr.unit}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="legend">
        <span className="item">
          <span className="line-key" /> Mean
        </span>
        <span className="item">
          <span className="swatch" style={{ background: 'rgba(255,255,255,0.14)', borderRadius: 2, width: 12 }} /> Model spread
        </span>
        {MODELS.map((m) => (
          <span className="item" key={m.id}>
            <span className="swatch" style={{ background: m.color }} /> {m.label}
          </span>
        ))}
      </div>
    </div>
  )
}
