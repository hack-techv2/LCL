// =============================================================================
// Persistence seam — the single owner of client<->server state I/O (R12)
// =============================================================================
// All reads/writes of persisted state go through here, on top of the R11
// transport. There are two stores by design (mirrors the server): the full app
// data blob (chats + embedded settings) at /api/data, and the live settings
// (credentials + RAG defaults) at /api/config, which the server applies
// immediately on connect/disconnect.
//
// The #demo write-guard lives in ONE place now: a demo session seeds throwaway
// state and must never touch disk/network, so every SAVE is a no-op in demo.
// (Reads aren't reached in demo — init() returns at its maybeDemo() guard
// before any load.) This also closes a prior leak where disconnect() in demo
// still POSTed blank credentials to /api/config.

function storeIsDemo() { return typeof demoOn === 'function' && demoOn() }

// --- full app data (chats + settings) <-> /api/data --------------------------
async function loadAppData() {
  try {
    const r = await httpGet('/api/data')
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}
async function saveAppData(data) {
  if (storeIsDemo()) return
  try { await httpPost('/api/data', data) } catch {}
}

// --- live settings <-> /api/config -------------------------------------------
async function loadSettings() {
  try {
    const r = await httpGet('/api/config')
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}
async function saveSettings(settings) {
  if (storeIsDemo()) return
  try { await httpPost('/api/config', settings) } catch {}
}
