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
// bias: { modelId: correction°C } or null, applied to the MEAN only (a model's
// learned systematic offset is subtracted before averaging); min/max stay raw
// so the spread always shows what the models actually said.
export function kstats(byModel, weights, bias) {
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
    sum += (v + (bias?.[id] ?? 0)) * w
    wsum += w
    count++
  }
  if (!count || wsum <= 0) return null
  return { mean: sum / wsum, min, max, count }
}

// perModel: { modelId: number[] | null } → column-wise stats arrays
export function aggregateSeries(perModel, weights, bias) {
  const entries = Object.entries(perModel).filter(([, a]) => Array.isArray(a))
  const len = Math.max(0, ...entries.map(([, a]) => a.length))
  const mean = new Array(len).fill(null)
  const min = new Array(len).fill(null)
  const max = new Array(len).fill(null)
  for (let i = 0; i < len; i++) {
    const byModel = {}
    for (const [id, arr] of entries) byModel[id] = arr[i]
    const s = kstats(byModel, weights, bias)
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

const MIN_SCORED_MODELS = 5

// Pick the scoring scope for a location: location-specific scores once that
// location has enough verified data, otherwise the pooled global scores.
export function selectScope(scores, locKey, minDays = 14) {
  const enough = (models) =>
    models && Object.values(models).filter((m) => (m.nT || 0) >= minDays).length >= MIN_SCORED_MODELS
  const local = scores?.locations?.[locKey]?.models
  if (enough(local)) return { models: local, scope: 'local' }
  if (enough(scores?.models)) return { models: scores.models, scope: 'global' }
  return null
}

// Turn accuracy scores into normalized mean-weights. Models with at least
// minDays of verified forecasts get 1/(0.5 + MAE°C); models still accumulating
// data (e.g. newly added ones) get a neutral average weight so they neither
// stall the system nor skew it. Needs MIN_SCORED_MODELS scored models to
// activate at all.
export function weightsFromScores(models, modelIds, minDays = 14) {
  if (!models) return null
  const raw = {}
  const scored = []
  for (const id of modelIds) {
    const m = models[id]
    if (m && m.nT >= minDays) {
      raw[id] = 1 / (0.5 + m.sumErr / m.nT)
      scored.push(id)
    }
  }
  if (scored.length < MIN_SCORED_MODELS) return null
  const neutral = scored.reduce((a, id) => a + raw[id], 0) / scored.length
  for (const id of modelIds) if (!(id in raw)) raw[id] = neutral
  const total = modelIds.reduce((a, id) => a + raw[id], 0)
  const out = {}
  for (const id of modelIds) out[id] = raw[id] / total
  return out
}

// Learned temperature corrections: the negated mean signed error, so a model
// that runs 2° hot gets -2 applied before averaging. Clamped to ±5°C sanity.
export function biasFromScores(models, modelIds, minDays = 14) {
  if (!models) return null
  const out = {}
  let any = false
  for (const id of modelIds) {
    const m = models[id]
    if (m && m.nT >= minDays && Number.isFinite(m.sumBiasHi) && Number.isFinite(m.sumBiasLo)) {
      const meanBias = (m.sumBiasHi + m.sumBiasLo) / (2 * m.nT)
      out[id] = -Math.max(-5, Math.min(5, meanBias))
      any = true
    } else {
      out[id] = 0
    }
  }
  return any ? out : null
}
