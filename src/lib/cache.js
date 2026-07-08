// TTL cache for API responses: in-memory first, localStorage behind it, so
// switching between favorites or reopening the app doesn't refetch data that
// hasn't had time to change. Call counters only tick on real network hits.
const KEY = 'wa.cache'
const MAX_ENTRIES = 30
const mem = new Map()

function readStore() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {}
  } catch {
    return {}
  }
}

function writeStore(store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    // quota exceeded: drop the persisted cache, memory layer still works
    try {
      localStorage.removeItem(KEY)
    } catch {
      /* ignore */
    }
  }
}

// on fetch failure, serve a stale entry up to this old rather than erroring
// (rides out transient network blips like a dropped OWM request)
const STALE_MAX_MS = 6 * 3600e3

export async function cached(key, ttlMs, fetcher, force = false) {
  const now = Date.now()
  if (!force) {
    const m = mem.get(key)
    if (m && now - m.t < ttlMs) return m.v
    const s = readStore()[key]
    if (s && now - s.t < ttlMs) {
      mem.set(key, s)
      return s.v
    }
  }
  let v
  try {
    v = await fetcher()
  } catch (e) {
    const stale = mem.get(key) || readStore()[key]
    if (stale && now - stale.t < STALE_MAX_MS) return stale.v
    throw e
  }
  const entry = { t: now, v }
  mem.set(key, entry)
  const store = readStore()
  store[key] = entry
  const keys = Object.keys(store)
  if (keys.length > MAX_ENTRIES) {
    keys
      .sort((a, b) => store[a].t - store[b].t)
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((k) => delete store[k])
  }
  writeStore(store)
  return v
}
