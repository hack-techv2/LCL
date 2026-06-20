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
function _httpInit(method, body, opts) {
  const init = Object.assign({ method }, opts || {})
  if (body !== undefined) {
    init.headers = Object.assign({ 'Content-Type': 'application/json' }, init.headers || {})
    init.body = JSON.stringify(body)
  }
  return init
}

function httpGet(path, opts)          { return fetch(path, opts) }
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
