import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

createRoot(document.getElementById('root')).render(<App />)

// PWA: offline shell + installability (production builds only). Reload once
// when a new service worker takes control so a fresh deploy applies right away
// instead of leaving the tab on a stale build.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  })
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing
          if (!sw) return
          // a waiting worker with an existing controller means an update is
          // ready; let it activate immediately (it calls skipWaiting on install)
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              reg.update()
            }
          })
        })
        // check for a new sw.js on every load
        reg.update()
      })
      .catch(() => {})
  })
}
