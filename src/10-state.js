// =============================================================================
// State
// =============================================================================
let creds   = null
let D       = { chats: {} }
let chatId  = null
let attachments = []
let busy    = false
let dpOpen  = false
let inflightCtl = null  // AbortController for the current streaming request
let skillsCache = []    // [{ id, title, bytes, mtime }] populated on connect
let pendingRetry = null // { cancel() } when a 429 or 5xx retry is scheduled
let retry5xxCount = 0  // how many consecutive 5xx auto-retries have fired
let ragStickyChunks = []

// =============================================================================
// Reliability layer: fetchWithRetry + health pill
// =============================================================================
// Transparent client-side retry for idempotent reads and small writes. Streaming
// chat uses its own path because you can't safely retry a stream once bytes
// have started flowing. Retries on 502/503/504/429, network errors, and JSON
// parse failures when a JSON response was promised.
function setHealth(state, label) {
  const pill = document.getElementById('health-pill')
  const txt  = document.getElementById('health-txt')
  if (!pill||!txt) return
  pill.classList.remove('ok','warn','err')
  if (state) pill.classList.add(state)
  txt.textContent = label
}

async function fetchWithRetry(url, opts, cfg) {
  cfg = cfg || {}
  const attempts = cfg.attempts || 3
  const baseDelay = cfg.baseDelay || 500
  const expectJson = cfg.expectJson !== false  // default true
  const onRetry = cfg.onRetry || (() => {})
  let lastErr = null

  for (let i=1; i<=attempts; i++) {
    try {
      const r = await fetch(url, opts)
      // Transient server codes -> retry
      if ([502,503,504,429].includes(r.status) && i < attempts) {
        onRetry(i, attempts, 'HTTP '+r.status)
        await sleep(Math.min(4000, baseDelay * 2**(i-1)) + Math.random()*200)
        continue
      }
      if (expectJson && r.ok) {
        // Verify the body parses cleanly before handing it back.
        const text = await r.text()
        try { return { r, data: JSON.parse(text) } }
        catch {
          if (i < attempts) {
            onRetry(i, attempts, 'Non-JSON')
            await sleep(Math.min(4000, baseDelay * 2**(i-1)) + Math.random()*200)
            continue
          }
          return { r, data: null, raw: text }
        }
      }
      return { r, data: null }
    } catch (e) {
      lastErr = e
      if (i < attempts) {
        onRetry(i, attempts, e.message)
        await sleep(Math.min(4000, baseDelay * 2**(i-1)) + Math.random()*200)
        continue
      }
      throw e
    }
  }
  if (lastErr) throw lastErr
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

