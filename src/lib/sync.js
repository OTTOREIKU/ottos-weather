// Device sync through a private GitHub repo (OTTOREIKU/weather-settings).
// The app reads/writes settings.json there with a fine-grained personal
// access token scoped to just that repo. Everything syncs: API keys,
// favorites, units, and preferences. GitHub's API is CORS-open, so this
// works from the static site with no backend.
import * as storage from './storage.js'

const FILE_API = 'https://api.github.com/repos/OTTOREIKU/weather-settings/contents/settings.json'

const headers = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
})

const encode = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj, null, 2))))
const decode = (b64) => JSON.parse(decodeURIComponent(escape(atob(b64.replace(/\n/g, '')))))

// everything worth carrying between devices
export function gather() {
  return {
    updatedAt: new Date().toISOString(),
    units: storage.loadUnits(),
    locations: storage.loadLocations(),
    sources: storage.loadSources(),
    window: storage.loadSetting('window', 24),
    autorefresh: storage.loadSetting('autorefresh', 10),
    weighting: storage.loadSetting('weighting', true),
    biascorrect: storage.loadSetting('biascorrect', true),
  }
}

export function apply(s) {
  if (!s) return
  if (s.units) storage.saveUnits(s.units)
  if (Array.isArray(s.locations)) storage.saveLocations(s.locations)
  if (s.sources) storage.saveSources(s.sources)
  for (const k of ['window', 'autorefresh', 'weighting', 'biascorrect']) {
    if (s[k] !== undefined) storage.saveSetting(k, s[k])
  }
}

export async function pull(token) {
  const res = await fetch(FILE_API, { headers: headers(token) })
  if (res.status === 404) return { data: null, sha: null }
  if (!res.ok) throw new Error(`GitHub ${res.status}${res.status === 401 ? ' (bad token?)' : ''}`)
  const j = await res.json()
  return { data: decode(j.content), sha: j.sha }
}

export async function push(token, data, sha) {
  const body = { message: 'Sync settings', content: encode(data) }
  if (sha) body.sha = sha
  const res = await fetch(FILE_API, {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`GitHub ${res.status}`)
}

// first connect on a device: adopt the cloud copy if one exists, otherwise
// seed the cloud with this device's settings (keys included)
export async function connect(token) {
  const { data, sha } = await pull(token)
  // adopt the cloud copy only if it actually holds settings; a missing or
  // junk file means this device seeds the cloud instead
  if (data && (data.sources || data.locations?.length)) {
    apply(data)
    return 'pulled'
  }
  await push(token, gather(), sha ?? undefined)
  return 'pushed'
}

// debounced upload after any local settings change
let timer = null
export function schedulePush(onStatus) {
  const token = storage.loadSetting('synctoken', '')
  if (!token) return
  clearTimeout(timer)
  timer = setTimeout(async () => {
    try {
      const { sha } = await pull(token) // fresh sha avoids write conflicts
      await push(token, gather(), sha ?? undefined)
      onStatus?.('synced just now')
    } catch (e) {
      onStatus?.(`sync error: ${String(e.message || e)}`)
    }
  }, 1500)
}
