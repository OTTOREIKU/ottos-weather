// Sample the newest radar frame at a point: is it actually raining there
// right now, and how hard? Powers the current-card reality check that
// compares live radar against what each model claims for this hour.
import { cached } from './cache.js'

const Z = 7 // native radar detail
const WINDOW = 5 // sample a 5x5 px neighborhood (~±2.4 km at z7)

function loadTile(url) {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

// Universal Blue scheme: blues = light/moderate, yellows = heavy, reds = intense
function pixelLevel(r, g, b, a) {
  if (a < 40) return 0
  if (r > 170 && g < 150) return 3 // red/orange core
  if (r > 150 && g > 150 && b < 140) return 3 // yellow
  if (b > 140 && r < 120) return g > 150 ? 2 : 1 // blues
  return 2
}

export async function sampleRadarAt(lat, lon) {
  return cached(`rsample:${lat.toFixed(2)},${lon.toFixed(2)}`, 5 * 60000, async () => {
    const meta = await (await fetch('https://api.librewxr.net/public/weather-maps.json')).json()
    const past = meta?.radar?.past
    if (!past?.length) return null
    const frame = past[past.length - 1]

    const n = 2 ** Z
    const xf = ((lon + 180) / 360) * n
    const yf = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n
    const tx = Math.floor(xf)
    const ty = Math.floor(yf)
    const px = Math.min(255, Math.floor((xf - tx) * 256))
    const py = Math.min(255, Math.floor((yf - ty) * 256))

    const img = await loadTile(`${meta.host}${frame.path}/256/${Z}/${((tx % n) + n) % n}/${ty}/2/1_1.png`)
    if (!img) return null
    const c = document.createElement('canvas')
    c.width = 256
    c.height = 256
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const half = Math.floor(WINDOW / 2)
    const x0 = Math.max(0, Math.min(256 - WINDOW, px - half))
    const y0 = Math.max(0, Math.min(256 - WINDOW, py - half))
    const d = ctx.getImageData(x0, y0, WINDOW, WINDOW).data

    let wet = 0
    let level = 0
    for (let i = 0; i < d.length; i += 4) {
      const l = pixelLevel(d[i], d[i + 1], d[i + 2], d[i + 3])
      if (l > 0) wet++
      if (l > level) level = l
    }
    const coverage = wet / (d.length / 4)
    return {
      raining: coverage >= 0.2,
      intensity: coverage >= 0.2 ? level : 0, // 1 light, 2 moderate, 3 heavy
      time: frame.time,
    }
  })
}
