import React from 'react'
import { ALL_MODELS } from '../api/sources.js'

// Model accuracy scoreboard, fed by data/scores.json which a scheduled GitHub
// Action updates daily (verified next-day forecasts vs observed history).
export default function Scorecard({
  scores,
  units,
  weighting,
  onToggleWeighting,
  weightsActive,
  biasCorrect,
  onToggleBias,
  biasActive,
  scope,
}) {
  // extra sources appear once the collector has verified days for them
  const rows = ALL_MODELS.filter((m) => !m.extra || scores?.models?.[m.id]?.nT).map((m) => {
    const s = scores?.models?.[m.id]
    if (!s || !s.nT) return { ...m, n: 0 }
    const maeC = s.sumErr / s.nT
    const rainTotal = s.rain ? s.rain.hit + s.rain.miss + s.rain.fa + s.rain.cn : 0
    const biasC = Number.isFinite(s.sumBiasHi) ? (s.sumBiasHi + s.sumBiasLo) / (2 * s.nT) : null
    return {
      ...m,
      n: s.nT,
      maeC,
      mae: units === 'imperial' ? maeC * 1.8 : maeC,
      bias: biasC == null ? null : units === 'imperial' ? biasC * 1.8 : biasC,
      rainAcc: rainTotal ? (s.rain.hit + s.rain.cn) / rainTotal : null,
    }
  }).sort((a, b) => (a.maeC ?? Infinity) - (b.maeC ?? Infinity))

  const hasData = rows.some((r) => r.n > 0)
  const maxMae = Math.max(0.1, ...rows.filter((r) => r.n > 0).map((r) => r.mae))

  const biasLabel = (b) => {
    if (b == null || Math.abs(b) < 0.3) return ''
    return b > 0 ? `runs ${b.toFixed(1)}° hot` : `runs ${Math.abs(b).toFixed(1)}° cold`
  }

  return (
    <div className="card chart-card">
      <div className="chart-head">
        <div className="section-title">
          Model scorecard: verified next-day accuracy
          {hasData && scope && <span className="scope-tag">{scope === 'local' ? 'local scores' : 'all locations pooled'}</span>}
        </div>
        {hasData && (
          <span className="score-toggles">
            <label className="weight-toggle">
              <input type="checkbox" checked={weighting} onChange={(e) => onToggleWeighting(e.target.checked)} />
              weight by accuracy{weighting && !weightsActive ? ' (needs 14+ days)' : ''}
            </label>
            <label className="weight-toggle">
              <input type="checkbox" checked={biasCorrect} onChange={(e) => onToggleBias(e.target.checked)} />
              correct known bias{biasCorrect && !biasActive ? ' (needs 14+ days)' : ''}
            </label>
          </span>
        )}
      </div>

      {!hasData ? (
        <div className="score-empty">
          A scheduled GitHub Action snapshots every model's forecast daily and scores it against
          observed conditions once the day has passed. Scores appear here after the first few days
          of data collection. With 2+ weeks of history the app weights the mean toward the models
          with the best local track record and corrects each model's known temperature bias.
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
                    <span className="bias-note">{biasLabel(r.bias)}</span>
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
            the model correctly called rain vs no rain (1 mm threshold). Shorter bar = better. When
            enabled, the mean is weighted toward accurate models and each model's systematic
            hot/cold bias is subtracted before averaging.
          </div>
        </>
      )}
    </div>
  )
}
