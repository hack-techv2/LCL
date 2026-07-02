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

function httpGet(path, opts)          { const dh = _demoHdr(); if (dh) { opts = Object.assign({}, opts || {}); opts.headers = Object.assign({}, opts.headers || {}, dh) } return fetch(path, opts) }
function httpPost(path, body, opts)   { return fetch(path, _httpInit('POST', body, opts)) }
function httpPut(path, body, opts)    { return fetch(path, _httpInit('PUT', body, opts)) }
function httpDelete(path, opts)       { return fetch(path, _httpInit('DELETE', undefined, opts)) }

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
    const m = msg.match(/Limit resets at:\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})\s*UTC/i)
    if (m) { const t = Date.parse(m[1].replace(' ', 'T') + 'Z'); if (!isNaN(t) && t > Date.now()) resetMs = t }
    // Parse the gateway's real-time limit + remaining from the 429 body. If it had
    // room for this request yet still rejected it, the request is genuinely too big;
    // if Remaining is ~0 the budget is just exhausted (wait for the window).
    const lim = msg.match(/Current limit:\s*(\d+)/i)
    if (lim) limit429 = Number(lim[1])
    const rem = msg.match(/Remaining:\s*(\d+)/i)
    if (rem) remaining429 = Number(rem[1])
  } else if (resp.status >= 500 && resp.status < 600) {
    kind = 'transient'
  }
  return { ok: false, status: resp.status, errData, message, kind, resetMs, limit429, remaining429 }
}
