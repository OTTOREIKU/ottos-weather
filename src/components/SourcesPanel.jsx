import React, { useState } from 'react'
import { EXTRA_SOURCES } from '../api/sources.js'
import { callCounts } from '../lib/storage.js'

// Manage optional forecast sources and watch this device's API usage.
// Keyed services get a client-side budget so free tiers can't be blown past.
export default function SourcesPanel({ settings, onChange, status = {}, syncToken, syncStatus, onConnect, onDisconnect }) {
  const [open, setOpen] = useState(false)
  const [keys, setKeys] = useState({
    openweather: settings.openweather?.key || '',
    pirate: settings.pirate?.key || '',
  })
  const [tokenDraft, setTokenDraft] = useState('')
  const [showHow, setShowHow] = useState(false)
  const om = callCounts('openmeteo')

  const toggle = (id, on) => onChange({ ...settings, [id]: { ...settings[id], on } })
  const saveKey = (id) => onChange({ ...settings, [id]: { ...settings[id], key: keys[id].trim() } })

  return (
    <div className="card chart-card">
      <button className="panel-toggle" onClick={() => setOpen((o) => !o)}>
        <span className="section-title" style={{ margin: 0 }}>Forecast sources &amp; API usage</span>
        <span className="chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="panel-body">
          <div className="source-row">
            <span className="src-name">Open-Meteo</span>
            <span className="src-note">8 global models · always on · free 10k/day</span>
            <span className="src-usage">{om.day} calls today · {om.month} this month (this device)</span>
          </div>

          {EXTRA_SOURCES.map((s) => {
            const cfg = settings[s.id] || {}
            const c = callCounts(s.id)
            const capText = s.dayCap
              ? `${c.day}/${s.dayCap} today${s.monthCap ? ` · ${c.month}/${s.monthCap} month` : ''}`
              : `${c.day} calls today`
            const overCap = s.dayCap && c.day >= s.dayCap
            return (
              <div className="source-row" key={s.id}>
                <label className="src-name">
                  <input type="checkbox" checked={!!cfg.on} onChange={(e) => toggle(s.id, e.target.checked)} />
                  {s.label}
                </label>
                <span className="src-note">{s.note}</span>
                {cfg.on && status[s.id] && (
                  <span className={`src-status ${status[s.id].startsWith('error') ? 'err' : ''}`}>{status[s.id]}</span>
                )}
                {s.needsKey && (
                  <span className="src-key">
                    <input
                      type="text"
                      placeholder="paste API key"
                      value={keys[s.id]}
                      onChange={(e) => setKeys({ ...keys, [s.id]: e.target.value })}
                      onBlur={() => saveKey(s.id)}
                    />
                    {cfg.on && !cfg.key && <em>key needed</em>}
                  </span>
                )}
                <span className={`src-usage ${overCap ? 'over' : ''}`}>
                  {capText}
                  {overCap ? ' · paused until tomorrow' : ''}
                </span>
              </div>
            )
          })}

          <div className="panel-foot">
            Keyed sources stop automatically before their free limits (client-side budget, counted per
            device). Keys stay in this browser's storage and are only sent to their own service.
          </div>

          <div className="sync-block">
            <div className="sync-head">
              <span className="src-name">☁ Device sync</span>
              <span className="src-note">
                keys, favorites, and settings sync through your private GitHub repo (weather-settings)
              </span>
            </div>
            {syncToken ? (
              <div className="sync-row">
                <span className="src-status">{syncStatus || 'connected'}</span>
                <button className="close-btn" onClick={onDisconnect}>
                  disconnect this device
                </button>
              </div>
            ) : (
              <div className="sync-row">
                <input
                  type="password"
                  placeholder="paste your GitHub access token"
                  value={tokenDraft}
                  onChange={(e) => setTokenDraft(e.target.value)}
                />
                <button className="connect-btn" disabled={!tokenDraft.trim()} onClick={() => onConnect(tokenDraft.trim())}>
                  Connect
                </button>
                <button className="close-btn" onClick={() => setShowHow(!showHow)}>
                  how do I get a token?
                </button>
                {syncStatus && <span className={`src-status ${syncStatus.includes('error') ? 'err' : ''}`}>{syncStatus}</span>}
              </div>
            )}
            {showHow && !syncToken && (
              <ol className="sync-how">
                <li>
                  Open{' '}
                  <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">
                    github.com/settings/personal-access-tokens/new
                  </a>
                </li>
                <li>Name it "weather sync", set expiration to 1 year (or no expiration)</li>
                <li>Repository access: "Only select repositories" and pick <b>weather-settings</b></li>
                <li>Permissions: Contents, "Read and write" (nothing else)</li>
                <li>Generate, copy the token, and paste it above on each of your devices</li>
              </ol>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
