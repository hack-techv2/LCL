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
const SCHEMA_VERSION = 1
async function loadAppData() {
  try {
    const r = await httpGet('/api/data')
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}
// Serialized write queue: every saveAppData() is appended to a single FIFO chain,
// so /api/data is never written by two overlapping requests (no server-side
// file-write race / lock). Each call's promise resolves when ITS write lands, and
// nothing is dropped (no debounce) — so `await persist()` still means "written".
let _appWriteChain = Promise.resolve()
function saveAppData(data) {
  if (storeIsDemo()) return Promise.resolve()
  _appWriteChain = _appWriteChain.then(async () => {
    try {
      if (data && typeof data === 'object') data.schemaVersion = SCHEMA_VERSION
      await httpPost('/api/data', data)
    } catch {}
  })
  return _appWriteChain
}
// Single entry point for "change state, then persist": runs fn(D) synchronously,
// then queues a serialized save and returns the save promise. Prefer this over
// hand-pairing a D mutation with persist() (call sites migrate incrementally).
function mutate(fn) {
  try { fn(D) } catch (e) { try { console.warn('[mutate]', e && e.message) } catch {} }
  return saveAppData(D)
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
