// Moon phase from the synodic cycle, computed locally (no API involved).
const SYNODIC = 29.53058867
const EPOCH_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14)

const NAMES = [
  'New moon',
  'Waxing crescent',
  'First quarter',
  'Waxing gibbous',
  'Full moon',
  'Waning gibbous',
  'Last quarter',
  'Waning crescent',
]
const EMOJI = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘']

export function moonPhase(date = new Date()) {
  const days = (date.getTime() - EPOCH_NEW_MOON) / 86400000
  const phase = (((days % SYNODIC) + SYNODIC) % SYNODIC) / SYNODIC
  const illumination = Math.round(((1 - Math.cos(2 * Math.PI * phase)) / 2) * 100)
  const idx = Math.round(phase * 8) % 8
  return { name: NAMES[idx], emoji: EMOJI[idx], illumination }
}
