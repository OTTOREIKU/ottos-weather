// Client-side radar nowcast. RainViewer discontinued its forecast frames in
// September 2025, so the app builds its own: estimate storm motion by block-
// matching two past radar frames ~30 minutes apart, then advect the newest
// frame forward along that motion (Lagrangian persistence). No growth or
// decay modeling, which is why we stop at ~40 minutes out.

const TILE = 256
const SCHEME = 2 // Universal Blue; must match the RadarMap tile scheme
const MAX_TILES = 60
const ALPHA_MIN = 40 // ignore near-transparent pixels
const MIN_COVERAGE = 0.002 // fraction of pixels with precip needed to track motion

const lonToX = (lon, z) => ((lon + 180) / 360) * 2 ** z
const latToY = (lat, z) => ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z
const xToLon = (x, z) => (x / 2 ** z) * 360 - 180
const yToLat = (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI

function loadTile(url) {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

async function renderFrame(host, frame, z, x0, x1, y0, y1) {
  const canvas = document.createElement('canvas')
  canvas.width = (x1 - x0 + 1) * TILE
  canvas.height = (y1 - y0 + 1) * TILE
  const ctx = canvas.getContext('2d')
  const n = 2 ** z
  const jobs = []
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      if (y < 0 || y >= n) continue
      const xw = ((x % n) + n) % n // wrap around the antimeridian
      jobs.push(
        loadTile(`${host}${frame.path}/${TILE}/${z}/${xw}/${y}/${SCHEME}/1_1.png`).then((img) => {
          if (img) ctx.drawImage(img, (x - x0) * TILE, (y - y0) * TILE)
        }),
      )
    }
  }
  await Promise.all(jobs)
  return canvas
}

// downscaled precipitation-intensity field (alpha channel of the radar tiles)
function intensityField(canvas, scale) {
  const w = Math.max(1, Math.round(canvas.width * scale))
  const h = Math.max(1, Math.round(canvas.height * scale))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  ctx.drawImage(canvas, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  const arr = new Float32Array(w * h)
  let cover = 0
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3]
    if (a > ALPHA_MIN) {
      arr[i] = a
      cover++
    }
  }
  return { arr, w, h, coverage: cover / (w * h) }
}

// mean absolute difference between A shifted by (dx,dy) and B, over precip pixels
function sad(A, B, w, h, dx, dy, stride) {
  let sum = 0
  let n = 0
  const xStart = Math.max(0, dx)
  const xEnd = Math.min(w, w + dx)
  const yStart = Math.max(0, dy)
  const yEnd = Math.min(h, h + dy)
  for (let y = yStart; y < yEnd; y += stride) {
    for (let x = xStart; x < xEnd; x += stride) {
      const a = A[(y - dy) * w + (x - dx)]
      const b = B[y * w + x]
      if (a > 0 || b > 0) {
        sum += Math.abs(a - b)
        n++
      }
    }
  }
  return n ? sum / n : Infinity
}

// coarse-to-fine grid search for the displacement that best maps A onto B
function estimateShift(fieldA, fieldB) {
  const { arr: A, w, h } = fieldA
  const B = fieldB.arr
  const R = 24
  let best = { dx: 0, dy: 0, cost: sad(A, B, w, h, 0, 0, 3) }
  for (let dy = -R; dy <= R; dy += 3) {
    for (let dx = -R; dx <= R; dx += 3) {
      const cost = sad(A, B, w, h, dx, dy, 3)
      if (cost < best.cost) best = { dx, dy, cost }
    }
  }
  let fine = best
  for (let dy = best.dy - 2; dy <= best.dy + 2; dy++) {
    for (let dx = best.dx - 2; dx <= best.dx + 2; dx++) {
      const cost = sad(A, B, w, h, dx, dy, 2)
      if (cost < fine.cost) fine = { dx, dy, cost }
    }
  }
  return fine
}

// Build synthetic future frames for the map's current viewport.
// Returns [{ time, url, bounds, nowcast: true, synthetic: true }], or [] when
// there's nothing to extrapolate (no rain in view, not enough history).
export async function buildNowcast(map, host, pastFrames, { steps = 4, gapFrames = 3, stepSec = 600 } = {}) {
  if (pastFrames.length < 2) return []
  const gap = Math.min(gapFrames, pastFrames.length - 1)
  const base = pastFrames[pastFrames.length - 1]
  const prev = pastFrames[pastFrames.length - 1 - gap]
  const gapSec = base.time - prev.time
  if (gapSec <= 0) return []

  const z = Math.min(7, Math.max(3, Math.round(map.getZoom()) - 1))
  const b = map.getBounds()
  const x0 = Math.floor(lonToX(b.getWest(), z)) - 1
  const x1 = Math.floor(lonToX(b.getEast(), z)) + 1
  const y0 = Math.max(0, Math.floor(latToY(b.getNorth(), z)) - 1)
  const y1 = Math.min(2 ** z - 1, Math.floor(latToY(b.getSouth(), z)) + 1)
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_TILES) return []

  const [cPrev, cBase] = await Promise.all([
    renderFrame(host, prev, z, x0, x1, y0, y1),
    renderFrame(host, base, z, x0, x1, y0, y1),
  ])

  const scale = Math.min(1, 320 / cBase.width)
  const fPrev = intensityField(cPrev, scale)
  const fBase = intensityField(cBase, scale)
  // no precipitation in view: nothing to move, show persistence frames
  let shift = { dx: 0, dy: 0 }
  if (fPrev.coverage >= MIN_COVERAGE && fBase.coverage >= MIN_COVERAGE) {
    shift = estimateShift(fPrev, fBase)
  } else if (fBase.coverage < MIN_COVERAGE && fPrev.coverage < MIN_COVERAGE) {
    return []
  }

  const perStep = {
    x: (shift.dx / scale) * (stepSec / gapSec),
    y: (shift.dy / scale) * (stepSec / gapSec),
  }
  const bounds = [
    [yToLat(y0, z), xToLon(x0, z)],
    [yToLat(y1 + 1, z), xToLon(x1 + 1, z)],
  ]

  const out = []
  for (let k = 1; k <= steps; k++) {
    const c = document.createElement('canvas')
    c.width = cBase.width
    c.height = cBase.height
    c.getContext('2d').drawImage(cBase, Math.round(perStep.x * k), Math.round(perStep.y * k))
    out.push({ time: base.time + stepSec * k, url: c.toDataURL('image/png'), bounds, nowcast: true, synthetic: true })
  }
  return out
}
