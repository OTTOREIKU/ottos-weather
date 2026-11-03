import { useState } from 'react'
import { loadSetting, saveSetting } from './storage.js'

// Open/closed state for a collapsible panel, remembered on this device so it
// survives switching cities or tabs (which remounts the panel). Deliberately
// not part of the cross-device settings sync: a phone and a desktop usually
// want different layouts. Until the user toggles a panel, it uses its default.
export const isWide = () => typeof window === 'undefined' || !window.innerWidth || window.innerWidth > 820

export default function usePanelOpen(id, defaultOpen) {
  const [open, setOpenState] = useState(() => {
    const saved = loadSetting(`panel.${id}`, null)
    return typeof saved === 'boolean' ? saved : typeof defaultOpen === 'function' ? defaultOpen() : defaultOpen
  })
  const setOpen = (next) =>
    setOpenState((prev) => {
      const v = typeof next === 'function' ? next(prev) : next
      saveSetting(`panel.${id}`, v)
      return v
    })
  return [open, setOpen]
}
