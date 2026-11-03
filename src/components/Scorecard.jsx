import React from 'react'
import usePanelOpen, { isWide } from '../lib/usePanelOpen.js'
import { ALL_MODELS } from '../api/sources.js'
import { BENCHED } from '../lib/aggregate.js'

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
  place,
  placeKm,
  borrowedFrom,
}) {
  // collapsed by default on phones, like the model breakdown and details
  const [open, setOpen] = usePanelOpen('scorecard', isWide)
  // extra sources appear once the collector has verified days for them
  const rows = ALL_MODELS.filter((m) => !m.extra || scores?.models?.[m.id]?.nT)
    .map((m) => {
      const s = scores?.models?.[m.id]
      if (!s || !s.nT) return { ...m, n: 0 }
      const maeC = s.sumErr / s.nT
      const rainTotal = s.rain ? s.rain.hit + s.rain.miss + s.rain.fa + s.rain.cn : 0
      // hot/cold notes describe what is actually corrected: the recent window,
      // split into highs and lows (falls back to the all-time record)
      const r = scores?.recent?.models?.[m.id]?.nT >= 14 ? scores.recent.models[m.id] : s
      const toU = (c) => (units === 'imperial' ? c * 1.8 : c)
      const biasHi = Number.isFinite(r.sumBiasHi) ? toU(r.sumBiasHi / r.nT) : null
      const biasLo = Number.isFinite(r.sumBiasLo) ? toU(r.sumBiasLo / r.nT) : null
      // storm timing: critical success index over rainy hours (hits vs misses
      // and false alarms), so quiet dry hours don't inflate the number
      const rhEvents = s.rainH ? s.rainH.hit + s.rainH.miss + s.rainH.fa : 0
      const timing = rhEvents >= 10 ? s.rainH.hit / rhEvents : null
      return {
        ...m,
        n: s.nT,
        maeC,
        mae: units === 'imperial' ? maeC * 1.8 : maeC,
        biasHi,
        biasLo,
        rainAcc: rainTotal ? (s.rain.hit + s.rain.cn) / rainTotal : null,
        timing,
      }
    })
    .sort((a, b) => (a.maeC ?? Infinity) - (b.maeC ?? Infinity))

  const hasData = rows.some((r) => r.n > 0)
  const maxMae = Math.max(0.1, ...rows.filter((r) => r.n > 0).map((r) => r.mae))

  const biasLabel = (hi, lo) => {
    if (hi == null || lo == null || (Math.abs(hi) < 0.3 && Math.abs(lo) < 0.3)) return ''
    const f = (v) => `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(1)}°`
    return `hi ${f(hi)} / lo ${f(lo)}`
  }

  return (
    <div className="card chart-card">
      <button className="panel-toggle" onClick={() => setOpen((o) => !o)}>
        <span className="section-title" style={{ margin: 0 }}>
          Model scorecard: verified next-day accuracy
          {place && (
            <span className="scope-tag">
              {place}
              {placeKm >= 5 ? ` · ${Math.round(placeKm * 0.621)} mi away` : ''}
            </span>
          )}
        </span>
        <span className="chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="panel-body">
          {borrowedFrom && (
            <div className="score-borrow">
              {place} is still building its own track record, so corrections use {borrowedFrom} for now. They switch to{' '}
              {place}'s own data automatically after about two weeks.
            </div>
          )}
          <div className="chart-head">
            {hasData && (
              <span className="score-toggles">
                <label className="weight-toggle">
                  <input type="checkbox" checked={weighting} onChange={(e) => onToggleWeighting(e.target.checked)} />
                  weight by accuracy
                  {weighting && !weightsActive ? ' (needs 14+ days)' : ''}
                </label>
                <label className="weight-toggle">
                  <input type="checkbox" checked={biasCorrect} onChange={(e) => onToggleBias(e.target.checked)} />
                  correct known bias
                  {biasCorrect && !biasActive ? ' (needs 14+ days)' : ''}
                </label>
              </span>
            )}
          </div>

          {!hasData ? (
            <div className="score-empty">
              A scheduled GitHub Action snapshots every model's forecast daily and scores it against observed conditions
              once the day has passed. Scores appear here after the first few days of data collection. With 2+ weeks of
              history the app weights the mean toward the models with the best local track record and corrects each
              model's known temperature bias.
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
                      <small>{BENCHED.has(r.id) ? 'benched · not in mean' : r.agency}</small>
                    </span>
                    {r.n > 0 ? (
                      <>
                        <span className="mae-bar">
                          <span
                            className="bar"
                            style={{
                              width: `${(r.mae / maxMae) * 100}%`,
                              background: r.color,
                            }}
                          />
                        </span>
                        <span className="mae">
                          ±{r.mae.toFixed(1)}°<small> avg error</small>
                        </span>
                        <span className="bias-note">{biasLabel(r.biasHi, r.biasLo)}</span>
                        <span
                          className="rain-acc"
                          title={
                            r.timing != null
                              ? `storm timing skill (right hours): ${Math.round(r.timing * 100)}%`
                              : undefined
                          }
                        >
                          {r.rainAcc != null ? `${Math.round(r.rainAcc * 100)}% rain` : ''}
                          {r.timing != null ? ` · ${Math.round(r.timing * 100)}% hr` : ''}
                        </span>
                        <span className="days">{r.n}d</span>
                      </>
                    ) : (
                      <span className="score-nodata">no verified days yet</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="panel-foot">
                Average error is the mean absolute miss on next-day high/low temps. Rain % is how often the model
                correctly called rain vs no rain (1 mm threshold); the hr % is storm timing, how well the model put
                next-day rain in the right hours. Shorter bar = better. Rankings use the full record; corrections use
                the last 30 days, since model biases drift with the seasons. The hi/lo note is each model's recent miss
                on highs and lows (+ = too warm), corrected separately before averaging.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
