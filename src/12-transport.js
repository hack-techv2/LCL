// =============================================================================
// Transport — the single client<->local-proxy HTTP/SSE seam (R11)
// =============================================================================
// All browser fetches to the Node proxy go through here so headers, JSON body
// serialization and SSE consumption live in one place. The http* helpers return
// the raw Response (callers keep their own .ok / .json() / .text() handling, so
// migrating a call site is mechanical and behaviour-preserving). fetchWithRetry
// (10-state.js) stays the retry/transient layer; transport wraps the plain calls.

// Build a fetch init for a JSON request. Only sets a body + Content-Type when a
// body is provided (a bodyless POST/PUT/DELETE stays bodyless, as before).
// In #demo the front-end talks to the REAL endpoints with the demo key; this
// header is the server-side gate (a stray DEMOKEY in normal mode can't get demo
// data). Added automatically to every request while demoOn() is true.
function _demoHdr() { return (typeof demoOn === 'function' && demoOn()) ? { 'x-lcl-demo': '1' } : null }

function _httpInit(method, body, opts) {
  const init = Object.assign({ method }, opts || {})
  const dh = _demoHdr()
  if (body !== undefined) {
    init.headers = Object.assign({ 'Content-Type': 'application/json' }, init.headers || {}, dh || {})
    init.body = JSON.stringify(body)
  } else if (dh) {
    init.headers = Object.assign({}, init.headers || {}, dh)
  }
  return init
}

// --- Proxy-origin shim (v0.67e): when index.html is opened from file:// or a
// non-proxy origin (double-clicked, or a static dev server), relative /api and
// /skills paths would miss the Node proxy entirely (file:///api/... -> CORS/404).
// Rewrite them to the proxy origin. Override with window.LCL_API_BASE or
// localStorage 'lcl_api_base'. Served-by-proxy pages keep relative paths.
const LCL_PROXY_DEFAULT_ORIGIN = 'http://127.0.0.1:3000'
const LCL_PROXY_PATH_RE = /^\/(?:api|skills)(?:\/|$)/

function isNodeProxyOrigin(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):3000$/i.test(String(origin || ''))
}

function lclProxyOrigin() {
  let configured = ''
  try { configured = String(window.LCL_API_BASE || localStorage.getItem('lcl_api_base') || '').trim() } catch (e) {}
  configured = configured.replace(/\/+$/, '')
  if (configured) return configured
  const loc = (typeof location !== 'undefined') ? location : null
  if (!loc) return ''
  if (loc.protocol === 'file:' || !isNodeProxyOrigin(loc.origin)) return LCL_PROXY_DEFAULT_ORIGIN
  return ''
}

function proxyUrl(path) {
  const s = String(path || '')
  if (/^https?:\/\//i.test(s)) return s
  if (LCL_PROXY_PATH_RE.test(s)) {
    const base = lclProxyOrigin()
    if (base) return base + s
  }
  return s
}

function httpGet(path, opts)          { const dh = _demoHdr(); if (dh) { opts = Object.assign({}, opts || {}); opts.headers = Object.assign({}, opts.headers || {}, dh) } return fetch(proxyUrl(path), opts) }
function httpPost(path, body, opts)   { return fetch(proxyUrl(path), _httpInit('POST', body, opts)) }
function httpPut(path, body, opts)    { return fetch(proxyUrl(path), _httpInit('PUT', body, opts)) }
function httpDelete(path, opts)       { return fetch(proxyUrl(path), _httpInit('DELETE', undefined, opts)) }

// Consume an SSE Response body, invoking onData(payload) for each "data:" line
// (payload is the text after "data:", trimmed; "[DONE]" is passed through for the
// caller to skip). Lines are split on "\n", so this handles both the chat stream
// (frames separated by "\n\n" -> the blank line is filtered) and the embed stream
// (single "\n"). If opts.aborted() reports true (or read() throws AbortError) the
// loop stops and returns { stopped:true } WITHOUT throwing, so the chat path keeps
// its "abort -> (stopped)" wrap-up. Callers that omit opts.aborted get errors
// propagated to their own catch. Returns { stopped:false } on a normal end.
async function streamSse(resp, onData, opts) {
  opts = opts || {}
  const reader  = resp.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    let chunk
    try { chunk = await reader.read() }
    catch (e) {
      if (opts.aborted && (e.name === 'AbortError' || opts.aborted())) return { stopped: true }
      throw e
    }
    if (chunk.done) break
    buf += decoder.decode(chunk.value, { stream: true })
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (line.startsWith('data:')) onData(line.slice(5).trim())
    }
  }
  return { stopped: false }
}

// Chat/embed POST with error classification. On HTTP 200 → { ok:true, resp }.
// On non-200 it reads the JSON error body ONCE and classifies the failure so the
// caller's UI layer just branches on `kind`:
//   'ratelimit' — 429; resetMs set if the upstream "Limit resets at: … UTC" marker
//                 parses to a FUTURE time (else null → caller treats it as terminal)
//   'transient' — any 5xx (caller may auto-retry with backoff)
//   'terminal'  — everything else (4xx, non-JSON, …)
// This keeps all fetch + error-shape parsing in the transport seam; the chat
// module owns the response UX (countdown, retry scheduling, rendering).
async function postClassified(path, body, opts) {
  const resp = await httpPost(path, body, opts)
  if (resp.ok) return { ok: true, resp }
  let errData = {}
  try { errData = JSON.parse(await resp.text()) } catch {}
  const message = (errData && errData.error && (errData.error.message || errData.error)) || ('HTTP ' + resp.status)
  let kind = 'terminal', resetMs = null, limit429 = null, remaining429 = null
  if (resp.status === 429) {
    kind = 'ratelimit'
    const msg = String((errData.error && (errData.error.message || errData.error)) || '')
    // Overall API-KEY BUDGET exhaustion (the key's total spend cap) comes back as a
    // flat 429 like {"error":"1 budget(s) exceeded"} with NO reset time / limit /
    // remaining fields. It is NOT the per-minute token window and will NEVER clear on
    // a timer, so auto-retrying is pure spam (15 Jul log: the identical 429 retried
    // every ~63s for 10+ hours). Classify it terminal so the caller shows a plain
    // error with no countdown / auto-retry. Match the known shape, and also treat a
    // marker-less "budget" 429 the same way (defensive against minor wording drift).
    const budgetExhausted = /budget\(s\)\s+exceeded/i.test(msg) ||
      (/budget/i.test(msg) && !/Limit resets at:/i.test(msg) && !/Current limit:/i.test(msg) && !/Remaining:/i.test(msg))
    if (budgetExhausted) {
      kind = 'terminal'
    } else {
      const m = msg.match(/Limit resets at:\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})\s*UTC/i)
      if (m) { const t = Date.parse(m[1].replace(' ', 'T') + 'Z'); if (!isNaN(t) && t > Date.now()) resetMs = t }
      // Parse the gateway's real-time limit + remaining from the 429 body. If it had
      // room for this request yet still rejected it, the request is genuinely too big;
      // if Remaining is ~0 the budget is just exhausted (wait for the window).
      const lim = msg.match(/Current limit:\s*(\d+)/i)
      if (lim) limit429 = Number(lim[1])
      const rem = msg.match(/Remaining:\s*(\d+)/i)
      if (rem) remaining429 = Number(rem[1])
    }
  } else if (resp.status >= 500 && resp.status < 600) {
    kind = 'transient'
  }
  return { ok: false, status: resp.status, errData, message, kind, resetMs, limit429, remaining429 }
}
