export const HOTKEY = 'Control+Alt+B' // ⌃⌥B: show / hide the app from anywhere

/** The window and system settings, checked: anything missing or out of range falls back to off / fully opaque. */
export function winPrefs(raw: unknown) {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const pct = typeof o.opacity === 'number' && Number.isFinite(o.opacity) ? Math.min(100, Math.max(50, o.opacity)) : 100 // below 50% the window is hard to find
  return { launchAtLogin: o.launchAtLogin === true, alwaysOnTop: o.alwaysOnTop === true, opacity: pct / 100, hotkey: o.hotkey === true }
}
