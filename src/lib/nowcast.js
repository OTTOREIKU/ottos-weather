// Client-side radar nowcast. RainViewer discontinued its forecast frames in
// September 2025, so the app builds its own: estimate storm motion by block-
// matching two past radar frames ~30 minutes apart, then advect the newest
// frame forward along that motion (Lagrangian persistence).
//
// Motion is estimated PER REGION: a grid of local vectors (seeded by a global
// match, outlier-clamped, then smoothed) so rotating systems and wind shear
// track correctly. Frames are produced by backward-warping the newest radar
// image through the interpolated motion field. No growth/decay modeling,
// which is why we stop at ~40 minutes out.

const TILE = 256
const SCHEME = 2 // Universal Blue; must match the RadarMap tile scheme
const MAX_TILES = 60
const ALPHA_MIN = 40 // ignore near-transparent pixels
const MIN_COVERAGE = 0.002 // fraction of precip pixels needed to track motion at all
const BLOCK_MIN_COVERAGE = 0.015 // per-block coverage needed for a local vector
const GLOBAL_R = 24 // global search radius (working px)
const LOCAL_R = 12 // local refinement radius around the global vector
const OUTLIER = 18 // local vectors further than this from global fall back to global

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

// mean absolute difference between A shifted by (dx,dy) and B, over precip
// pixels, restricted to the destination window [wx0,wx1) x [wy0,wy1)
function sad(A, B, w, h, dx, dy, stride, wx0 = 0, wy0 = 0, wx1 = w, wy1 = h) {
  let sum = 0
  let n = 0
  const xStart = Math.max(wx0, dx)
  const xEnd = Math.min(wx1, w + dx)
  const yStart = Math.max(wy0, dy)
  const yEnd = Math.min(wy1, h + dy)
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

function searchShift(A, B, w, h, seedX, seedY, radius, coarse, win) {
  let best = { dx: seedX, dy: seedY, cost: sad(A, B, w, h, seedX, seedY, 2, ...win) }
  for (let dy = seedY - radius; dy <= seedY + radius; dy += coarse) {
    for (let dx = seedX - radius; dx <= seedX + radius; dx += coarse) {
      const cost = sad(A, B, w, h, dx, dy, 3, ...win)
      if (cost < best.cost) best = { dx, dy, cost }
    }
  }
  let fine = best
  for (let dy = best.dy - 2; dy <= best.dy + 2; dy++) {
    for (let dx = best.dx - 2; dx <= best.dx + 2; dx++) {
      const cost = sad(A, B, w, h, dx, dy, 2, ...win)
      if (cost < fine.cost) fine = { dx, dy, cost }
    }
  }
  return fine
}

// grid of local motion vectors (working-px per frame gap), normalized coords
function motionGrid(fA, fB) {
  const { arr: A, w, h } = fA
  const B = fB.arr
  const global = searchShift(A, B, w, h, 0, 0, GLOBAL_R, 3, [0, 0, w, h])

  const cols = Math.max(2, Math.min(6, Math.round(w / 80)))
  const rows = Math.max(2, Math.min(5, Math.round(h / 80)))
  const bw = w / cols
  const bh = h / rows
  const grid = []

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const wx0 = Math.floor(c * bw)
      const wy0 = Math.floor(r * bh)
      const wx1 = Math.floor((c + 1) * bw)
      const wy1 = Math.floor((r + 1) * bh)
      // per-block precip coverage in the base frame
      let cover = 0
      for (let y = wy0; y < wy1; y += 2) {
        for (let x = wx0; x < wx1; x += 2) if (B[y * w + x] > 0) cover++
      }
      cover /= ((wx1 - wx0) * (wy1 - wy0)) / 4
      if (cover < BLOCK_MIN_COVERAGE) {
        grid.push({ dx: global.dx, dy: global.dy, local: false })
        continue
      }
      const v = searchShift(A, B, w, h, global.dx, global.dy, LOCAL_R, 2, [wx0, wy0, wx1, wy1])
      // clamp outliers (usually growth/decay masquerading as motion) to global
      if (Math.abs(v.dx - global.dx) > OUTLIER || Math.abs(v.dy - global.dy) > OUTLIER) {
        grid.push({ dx: global.dx, dy: global.dy, local: false })
      } else {
        grid.push({ dx: v.dx, dy: v.dy, local: true })
      }
    }
  }

  // one smoothing pass so neighboring regions don't tear at block seams
  const smooth = grid.map((g, i) => {
    const r = Math.floor(i / cols)
    const c = i % cols
    let sx = 0
    let sy = 0
    let n = 0
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr
        const cc = c + dc
        if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue
        const gg = grid[rr * cols + cc]
        const wgt = (dr === 0 && dc === 0 ? 2 : 1) * (gg.local ? 2 : 1)
        sx += gg.dx * wgt
        sy += gg.dy * wgt
        n += wgt
      }
    }
    return { dx: sx / n, dy: sy / n }
  })

  return { grid: smooth, cols, rows, scaleRef: w }
}

// backward-warp the full-res base image through the motion field.
// factor: fraction of the measured gap to advect (k * stepSec / gapSec)
function warpFrame(baseData, w, h, motion, factor) {
  const { grid, cols, rows, scaleRef } = motion
  const toFull = w / scaleRef // working px -> full-res px
  const src = new Uint32Array(baseData.data.buffer)
  const out = new ImageData(w, h)
  const dst = new Uint32Array(out.data.buffer)

  for (let y = 0; y < h; y++) {
    const gy = Math.min(rows - 1.001, Math.max(0, (y / h) * rows - 0.5))
    const ry = Math.floor(gy)
    const fy = gy - ry
    for (let x = 0; x < w; x++) {
      const gx = Math.min(cols - 1.001, Math.max(0, (x / w) * cols - 0.5))
      const cx = Math.floor(gx)
      const fx = gx - cx
      const i00 = ry * cols + cx
      const i10 = i00 + 1
      const i01 = i00 + cols
      const i11 = i01 + 1
      const vx =
        (grid[i00].dx * (1 - fx) + grid[i10].dx * fx) * (1 - fy) +
        (grid[i01].dx * (1 - fx) + grid[i11].dx * fx) * fy
      const vy =
        (grid[i00].dy * (1 - fx) + grid[i10].dy * fx) * (1 - fy) +
        (grid[i01].dy * (1 - fx) + grid[i11].dy * fx) * fy
      const sx = Math.round(x - vx * toFull * factor)
      const sy = Math.round(y - vy * toFull * factor)
      if (sx >= 0 && sx < w && sy >= 0 && sy < h) dst[y * w + x] = src[sy * w + sx]
    }
  }
  return out
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
  if (fBase.coverage < MIN_COVERAGE && fPrev.coverage < MIN_COVERAGE) return []

  // enough rain to track: build the per-region motion field. Too little in the
  // older frame: fall back to zero motion (pure persistence).
  const motion =
    fPrev.coverage >= MIN_COVERAGE && fBase.coverage >= MIN_COVERAGE
      ? motionGrid(fPrev, fBase)
      : { grid: [{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }, { dx: 0, dy: 0 }, { dx: 0, dy: 0 }], cols: 2, rows: 2, scaleRef: fBase.w }

  const w = cBase.width
  const h = cBase.height
  const baseData = cBase.getContext('2d').getImageData(0, 0, w, h)
  const bounds = [
    [yToLat(y0, z), xToLon(x0, z)],
    [yToLat(y1 + 1, z), xToLon(x1 + 1, z)],
  ]

  const out = []
  const work = document.createElement('canvas')
  work.width = w
  work.height = h
  const wctx = work.getContext('2d')
  for (let k = 1; k <= steps; k++) {
    wctx.putImageData(warpFrame(baseData, w, h, motion, (k * stepSec) / gapSec), 0, 0)
    out.push({
      time: base.time + stepSec * k,
      url: work.toDataURL('image/png'),
      bounds,
      nowcast: true,
      synthetic: true,
    })
  }
  return out
}
