import React from 'react'
import { MODELS } from '../api/openMeteo.js'

// Model accuracy scoreboard, fed by data/scores.json which a scheduled GitHub
// Action updates daily (verified next-day forecasts vs observed history).
export default function Scorecard({ scores, units, weighting, onToggleWeighting, weightsActive }) {
  const rows = MODELS.map((m) => {
    const s = scores?.models?.[m.id]
    if (!s || !s.nT) return { ...m, n: 0 }
    const maeC = s.sumErr / s.nT
    const rainTotal = s.rain ? s.rain.hit + s.rain.miss + s.rain.fa + s.rain.cn : 0
    return {
      ...m,
      n: s.nT,
      maeC,
      mae: units === 'imperial' ? maeC * 1.8 : maeC,
      rainAcc: rainTotal ? (s.rain.hit + s.rain.cn) / rainTotal : null,
    }
  }).sort((a, b) => (a.maeC ?? Infinity) - (b.maeC ?? Infinity))

  const hasData = rows.some((r) => r.n > 0)
  const maxMae = Math.max(0.1, ...rows.filter((r) => r.n > 0).map((r) => r.mae))

  return (
    <div className="card chart-card">
      <div className="chart-head">
        <div className="section-title">Model scorecard: verified next-day accuracy</div>
        {hasData && (
          <label className="weight-toggle">
            <input type="checkbox" checked={weighting} onChange={(e) => onToggleWeighting(e.target.checked)} />
            weight means by accuracy{weightsActive ? '' : ' (needs 14+ days)'}
          </label>
        )}
      </div>

      {!hasData ? (
        <div className="score-empty">
          A scheduled GitHub Action snapshots every model's forecast daily and scores it against
          observed conditions once the day has passed. Scores appear here after the first few days
          of data collection. With 2+ weeks of history the app can weight the mean toward the models
          with the best local track record.
        </div>
      ) : (
        <>
          <div className="score-rows">
            {rows.map((r, i) => (
              <div className="score-row" key={r.id}>
                <span className="rank">{r.n > 0 ? `#${i + 1}` : ''}</span>
                <span className="swatch" style={{ background: r.color }} />
                <span className="name">
                  {r.label}
                  <small>{r.agency}</small>
                </span>
                {r.n > 0 ? (
                  <>
                    <span className="mae-bar">
                      <span className="bar" style={{ width: `${(r.mae / maxMae) * 100}%`, background: r.color }} />
                    </span>
                    <span className="mae">
                      ±{r.mae.toFixed(1)}°<small> avg error</small>
                    </span>
                    <span className="rain-acc">{r.rainAcc != null ? `${Math.round(r.rainAcc * 100)}% rain` : ''}</span>
                    <span className="days">{r.n}d</span>
                  </>
                ) : (
                  <span className="score-nodata">no verified days yet</span>
                )}
              </div>
            ))}
          </div>
          <div className="panel-foot">
            Average error is the mean absolute miss on next-day high/low temps. Rain % is how often
            the model correctly called rain vs no rain (1 mm threshold). Shorter bar = better.
          </div>
        </>
      )}
    </div>
  )
}
