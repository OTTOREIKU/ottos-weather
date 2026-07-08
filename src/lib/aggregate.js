// Aggregation across models: mean + spread, consensus, rain agreement.

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

// perModel: { modelId: number[] | null } → column-wise stats arrays
export function aggregateSeries(perModel) {
  const arrays = Object.values(perModel).filter(Array.isArray)
  const len = Math.max(0, ...arrays.map((a) => a.length))
  const mean = new Array(len).fill(null)
  const min = new Array(len).fill(null)
  const max = new Array(len).fill(null)
  for (let i = 0; i < len; i++) {
    const s = stats(arrays.map((a) => a[i]))
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
