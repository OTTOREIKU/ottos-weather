// Data is fetched in metric (°C, km/h, mm) and converted at render time,
// so the unit toggle is instant with no refetch.

export const cToF = (c) => (c * 9) / 5 + 32

export function temp(c, units) {
  if (!Number.isFinite(c)) return '–'
  return Math.round(units === 'imperial' ? cToF(c) : c)
}

export function temp1(c, units) {
  if (!Number.isFinite(c)) return '–'
  return (units === 'imperial' ? cToF(c) : c).toFixed(1)
}

export function wind(kmh, units) {
  if (!Number.isFinite(kmh)) return { value: '–', unit: units === 'imperial' ? 'mph' : 'km/h' }
  return units === 'imperial'
    ? { value: Math.round(kmh * 0.621371), unit: 'mph' }
    : { value: Math.round(kmh), unit: 'km/h' }
}

export function pressure(hPa, units) {
  if (!Number.isFinite(hPa)) return { value: '–', unit: units === 'imperial' ? 'inHg' : 'hPa' }
  return units === 'imperial'
    ? { value: (hPa * 0.02953).toFixed(2), unit: 'inHg' }
    : { value: Math.round(hPa), unit: 'hPa' }
}

export function precip(mm, units) {
  if (!Number.isFinite(mm)) return { value: '–', unit: units === 'imperial' ? 'in' : 'mm' }
  return units === 'imperial'
    ? { value: (mm * 0.0393701).toFixed(2), unit: 'in' }
    : { value: mm.toFixed(1), unit: 'mm' }
}
