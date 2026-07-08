import React, { useState } from 'react'

const SEVERITY_COLOR = {
  Extreme: '#d03b3b',
  Severe: 'var(--serious)',
  Moderate: 'var(--warning)',
  Minor: 'var(--ink-3)',
  Unknown: 'var(--ink-3)',
}

function endsLabel(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `until ${d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`
}

// Official NWS watches/warnings for the selected location. Tap to expand.
export default function AlertsBanner({ alerts }) {
  const [openId, setOpenId] = useState(null)
  if (!alerts?.length) return null

  return (
    <div className="alerts">
      {alerts.map((a) => (
        <div className="alert" key={a.id} style={{ '--sev': SEVERITY_COLOR[a.severity] || SEVERITY_COLOR.Unknown }}>
          <button className="alert-head" onClick={() => setOpenId(openId === a.id ? null : a.id)}>
            <span className="sev-dot" />
            <span className="alert-event">⚠ {a.event}</span>
            <span className="alert-ends">{endsLabel(a.ends)}</span>
            <span className="chev">{openId === a.id ? '▾' : '▸'}</span>
          </button>
          {openId === a.id && (
            <div className="alert-body">
              {a.headline && <p className="alert-headline">{a.headline}</p>}
              {a.areaDesc && <p className="alert-area">{a.areaDesc}</p>}
              {a.description && <p>{a.description}</p>}
              {a.instruction && <p className="alert-instr">{a.instruction}</p>}
              <p className="alert-src">Source: National Weather Service</p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
