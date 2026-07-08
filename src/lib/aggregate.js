// Aggregation across models: mean + spread, consensus, rain agreement.
// All aggregation accepts optional per-model weights (from accuracy scores);
// the weighted part is only ever the mean. Min/max/spread stay unweighted.

export function stats(values) {
  const nums = (values || []).filter((v) => Number.isFinite(v))
  if (!nums.length) return null
  let min = Infinity
  let max = -Infinity
  let sum = 0
  for (const v of nums) {
    if (v < min) min = v
    if (v > max) max = v
    sum += v
  }
  return { mean: sum / nums.length, min, max, count: nums.length }
}

// byModel: { modelId: value } → weighted stats. weights: { modelId: w } or null.
export function kstats(byModel, weights) {
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let wsum = 0
  let count = 0
  for (const [id, v] of Object.entries(byModel)) {
    if (!Number.isFinite(v)) continue
    const w = weights?.[id] ?? 1
    if (v < min) min = v
    if (v > max) max = v
    sum += v * w
    wsum += w
    count++
  }
  if (!count || wsum <= 0) return null
  return { mean: sum / wsum, min, max, count }
}

// perModel: { modelId: number[] | null } → column-wise stats arrays
export function aggregateSeries(perModel, weights) {
  const entries = Object.entries(perModel).filter(([, a]) => Array.isArray(a))
  const len = Math.max(0, ...entries.map(([, a]) => a.length))
  const mean = new Array(len).fill(null)
  const min = new Array(len).fill(null)
  const max = new Array(len).fill(null)
  for (let i = 0; i < len; i++) {
    const byModel = {}
    for (const [id, arr] of entries) byModel[id] = arr[i]
    const s = kstats(byModel, weights)
    if (s) {
      mean[i] = s.mean
      min[i] = s.min
      max[i] = s.max
    }
  }
  return { mean, min, max }
}

export function valuesAt(perModel, index) {
  const out = {}
  for (const [id, arr] of Object.entries(perModel)) {
    out[id] = Array.isArray(arr) ? arr[index] : null
  }
  return out
}

// Most frequent weather code; ties break toward the more severe (higher) code.
export function consensusCode(values) {
  const counts = new Map()
  for (const v of values) {
    if (Number.isFinite(v)) counts.set(v, (counts.get(v) || 0) + 1)
  }
  if (!counts.size) return null
  let best = null
  let bestN = 0
  for (const [code, n] of counts) {
    if (n > bestN || (n === bestN && code > best)) {
      best = code
      bestN = n
    }
  }
  return best
}

// Fraction of models predicting a value above threshold (e.g. rain > 0.1mm).
export function agreementAt(perModel, index, threshold = 0.1) {
  let agree = 0
  let total = 0
  for (const arr of Object.values(perModel)) {
    const v = Array.isArray(arr) ? arr[index] : null
    if (Number.isFinite(v)) {
      total++
      if (v > threshold) agree++
    }
  }
  return { agree, total }
}

// Temperature spread (°C) → agreement badge. Status tones, never series colors.
export function spreadTone(rangeC) {
  if (rangeC == null) return { label: 'No data', tone: 'muted' }
  if (rangeC <= 2) return { label: 'Models agree', tone: 'good' }
  if (rangeC <= 5) return { label: 'Some disagreement', tone: 'warning' }
  return { label: 'Models diverge', tone: 'serious' }
}

// Turn accuracy scores into normalized mean-weights. Requires every model to
// have at least minDays of verified forecasts, so early sparse data can't
// skew the mean. Weight shape: 1/(0.5 + MAE°C), then normalized to sum 1.
export function weightsFromScores(scores, modelIds, minDays = 14) {
  if (!scores?.models) return null
  const raw = {}
  for (const id of modelIds) {
    const m = scores.models[id]
    if (!m || !m.nT || m.nT < minDays) return null
    raw[id] = 1 / (0.5 + m.sumErr / m.nT)
  }
  const total = Object.values(raw).reduce((a, b) => a + b, 0)
  const out = {}
  for (const id of modelIds) out[id] = raw[id] / total
  return out
}
