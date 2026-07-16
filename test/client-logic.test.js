// =============================================================================
// LCL client-logic harness  (browser-side logic, run under Node)
// -----------------------------------------------------------------------------
// Loads the REAL src modules (12-transport, 50-chatprocessing, 30-chatlist,
// toast from 80-ui) into a vm sandbox with stubbed fetch/DOM, and drives them
// with FIXTURES TAKEN VERBATIM FROM THE 2 Jul 2026 DEBUG LOGS (429 bodies,
// Remaining values, stream shapes). Two patches are applied to the source under
// test, both timing-only: _RL_WINDOW_MS 62000 -> 1500 and the transient-retry
// sleep 4000 -> 200, so the suite runs in seconds instead of minutes.
//
// Run: node test/client-logic.test.js        Exit 0 = all passed (CI-friendly)
// =============================================================================
const fs = require('fs'), path = require('path'), vm = require('vm')

const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')
let pass = 0, fail = 0
// fs.writeSync = SYNCHRONOUS stdout, so a sync-spinning case can never hide
// already-completed results behind buffering.
const say = s => { try { fs.writeSync(1, s + String.fromCharCode(10)) } catch { console.log(s) } }
const check = (name, ok, detail) => { say((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '   ' + detail : '')); ok ? pass++ : fail++ }

// --- source under test (timing patches asserted so drift is caught) ----------
const T12 = src('12-transport.js')
let T50 = src('50-chatprocessing.js')
if (!T50.includes('const _RL_WINDOW_MS = 62000')) { console.log('FAIL  harness: _RL_WINDOW_MS anchor missing'); process.exit(1) }
T50 = T50.replace('const _RL_WINDOW_MS = 62000', 'const _RL_WINDOW_MS = 1500')
if (!T50.includes('await abortableSleep(4000, signal)')) { console.log('FAIL  harness: transient-sleep anchor missing'); process.exit(1) }
T50 = T50.replace('await abortableSleep(4000, signal)', 'await abortableSleep(200, signal)')
const T30 = src('30-chatlist.js')

// --- fixtures (2 Jul 2026 logs, timestamps made dynamic) ----------------------
const stamp = ms => new Date(ms).toISOString().replace('T', ' ').replace(/\..*/, '') + ' UTC'
const RL_BODY = (remaining, resetMs) =>
  'Rate limit exceeded for api_key: d3adb33fd3adb33fd3adb33fd3adb33fd3adb33fd3adb33fd3adb33fd3adb33f. ' +
  'Limit type: tokens. Current limit: 200000, Remaining: ' + remaining + '. Limit resets at: ' + stamp(resetMs)

// --- fake fetch responses ------------------------------------------------------
const enc = new TextEncoder()
function sseResp(frames) {           // frames: array of strings (already JSON) or '[DONE]'
  const bytes = frames.map(f => enc.encode('data: ' + f + '\n\n'))
  let i = 0
  return {
    ok: true, status: 200,
    headers: { get: k => (k.toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
    body: { getReader: () => ({ read: async () => (i < bytes.length ? { done: false, value: bytes[i++] } : { done: true }) }) },
    text: async () => ''
  }
}
const okStream = (text, usage, finish) => sseResp([
  JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] }),
  JSON.stringify({ choices: [{ delta: {}, finish_reason: finish || 'stop' }] }),
  ...(usage ? [JSON.stringify({ usage })] : []),
  '[DONE]'
])
const rl429 = (remaining, resetMs) => ({ ok: false, status: 429, headers: { get: () => null }, text: async () => JSON.stringify({ error: { message: RL_BODY(remaining, resetMs), type: 'None', param: 'None', code: '429' } }) })
const errJson = (status, msg) => ({ ok: false, status, headers: { get: () => null }, text: async () => JSON.stringify({ error: { message: msg } }) })

// --- sandbox ------------------------------------------------------------------
function mkCtx(fetchQueue) {
  const crumbs = []
  const sb = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    TextEncoder, TextDecoder, AbortController,
    document: { getElementById: () => null, createElement: () => ({ innerHTML: '', children: [], style: {}, appendChild(c) { this.children.push(c) } }) },
    fetch: async () => { if (!fetchQueue.length) throw new Error('fetch queue empty'); const r = fetchQueue.shift(); return typeof r === 'function' ? r() : r },
    lclCrumb: (k, d) => crumbs.push(Object.assign({ k }, d)),
    creds: { model: 'demo', apiKey: 'K', maxTokens: 8192 },
    CFG: { DEFAULT_MAX_TOKENS: 8192, DEFAULT_CHUNK_SIZE: 800 },
    estTokens: t => Math.ceil(String(t).length / 4),
    fmt: s => s,
    D: { chats: {} }
  }
  const ctx = vm.createContext(sb)
  vm.runInContext(T12, ctx, { filename: '12-transport.js' })
  vm.runInContext(T50, ctx, { filename: '50-chatprocessing.js' })
  return { ctx, crumbs, sb, get: expr => vm.runInContext(expr, ctx) }
}

const CASES = [

  { id: 'C1 postClassified parses the real 429 body', fn: async () => {
    const q = [rl429(58944, Date.now() + 2000)]
    const { get } = mkCtx(q)
    const r = await get('postClassified')('/api/chat', {})
    const ok = r.kind === 'ratelimit' && r.limit429 === 200000 && r.remaining429 === 58944 && r.resetMs > Date.now()
    check('C1 postClassified parses the real 429 body', ok, 'kind=' + r.kind + ' rem=' + r.remaining429 + ' lim=' + r.limit429)
  } },

  { id: 'C2 postClassified kinds: 502 transient, 400 terminal', fn: async () => {
    const { get } = mkCtx([errJson(502, 'Upstream inactivity timeout'), errJson(400, 'bad request')])
    const pc = get('postClassified')
    const a = await pc('/api/chat', {}), b = await pc('/api/chat', {})
    check('C2 postClassified kinds: 502 transient, 400 terminal', a.kind === 'transient' && b.kind === 'terminal', a.kind + '/' + b.kind)
  } },

  { id: 'C48 budget(s) exceeded 429 -> terminal, no reset (never auto-retry)', fn: async () => {
    // 15 Jul log: overall API-key budget exhaustion is a flat 429 body (string,
    // NO reset/limit/remaining). Must classify TERMINAL so the chat path shows a
    // plain error and never enters the 60s retry-forever loop.
    const budget429 = { ok: false, status: 429, headers: { get: () => null }, text: async () => JSON.stringify({ error: '1 budget(s) exceeded' }) }
    const { get } = mkCtx([budget429])
    const r = await get('postClassified')('/api/chat', {})
    const ok = r.kind === 'terminal' && r.status === 429 && r.resetMs == null && r.limit429 == null && r.remaining429 == null
    check('C48 budget(s) exceeded 429 -> terminal, no reset (never auto-retry)', ok, 'kind=' + r.kind + ' reset=' + r.resetMs)
  } },

  { id: 'C50 re-send during a rate-limit countdown is blocked, not re-fired (2c)', fn: async () => {
    // With a 429 countdown pending, a manual re-send used to cancel it and fire straight
    // into the still-drained window (another 429). Now it blocks with a toast and leaves
    // the auto-retry running (Stop cancels). No fetch, pendingRetry survives.
    const { ctx, get, sb, crumbs } = mkCtx([])
    const toasts = []; sb.toast = (m, ty) => toasts.push({ m, ty })
    sb.document.getElementById = id => (id === 'msg-in' ? { value: 'try again' } : null)
    let cancelled = false
    sb.__markCancel = () => { cancelled = true }
    vm.runInContext('busy = false; chatId = "c1"; pendingRetry = { cancel(){ __markCancel() } }; rlWindowUntil = Date.now() + 42000', ctx)
    await get('send')()
    const blocked = crumbs.some(c => c.k === 'send_blocked_ratelimit')
    const toastOk = toasts.some(x => /retry automatically/i.test(x.m))
    const notCancelled = cancelled === false
    const stillPending = vm.runInContext('!!pendingRetry', ctx)
    check('C50 re-send during a rate-limit countdown blocked, not re-fired (2c)', blocked && toastOk && notCancelled && stillPending,
      'blocked=' + blocked + ' toast=' + toastOk + ' notCancelled=' + notCancelled + ' stillPending=' + stillPending)
  } },

  { id: 'C3 truncation guard: mid-stream error frame -> transient', fn: async () => {
    // The 21:47 stall shape: deltas, then the proxy error frame, NO finish/[DONE].
    const die = sseResp([
      JSON.stringify({ choices: [{ delta: { content: 'partial ' }, finish_reason: null }] }),
      JSON.stringify({ error: 'upstream stream error: socket hang up' })
    ])
    const { get } = mkCtx([die])
    const r = await get('streamChatOnce')({ messages: [] }, null, null)
    check('C3 truncation guard: mid-stream error frame -> transient', r.ok === false && r.kind === 'transient', 'ok=' + r.ok + ' kind=' + r.kind)
  } },

  { id: 'C4 streamChatOnce captures terminal usage', fn: async () => {
    const { get } = mkCtx([okStream('hello', { prompt_tokens: 90, completion_tokens: 10, total_tokens: 100 })])
    const r = await get('streamChatOnce')({ messages: [] }, null, null)
    check('C4 streamChatOnce captures terminal usage', r.ok && r.text === 'hello' && r.usage && r.usage.total_tokens === 100, 'usage=' + JSON.stringify(r.usage))
  } },

  { id: 'C5 near-full 429 -> tooBig (split), fast', fn: async () => {
    const { get } = mkCtx([rl429(199999, Date.now() + 60000)])
    const t0 = Date.now()
    const r = await get('summariseInto')(null, 'doc.html', 'x'.repeat(8000), null, null, null)
    const ms = Date.now() - t0
    check('C5 near-full 429 -> tooBig (split), fast', r.text === null && r.tooBig === true && ms < 500, 'ms=' + ms)
  } },

  { id: 'C6 partial 429 (Remaining: 58944) -> WAIT then retry, never split', fn: async () => {
    // THE 21:45:46 bug fixture: partially-drained window must wait, not deep-split.
    // resetMs must be >1s out: the body stamp truncates to whole seconds, and a
    // stamp that lands in the past parses as no-reset -> 60s default (flaky hang).
    const { get, crumbs } = mkCtx([rl429(58944, Date.now() + 2500), okStream('recovered summary')])
    const t0 = Date.now()
    const r = await get('summariseInto')(null, 'ASG v0.8.html (part 2/2)', 'x'.repeat(8000), null, null, null)
    const ms = Date.now() - t0
    const waited = crumbs.some(c => c.k === 'rl_wait' && c.where === 'summary')
    check('C6 partial 429 -> WAIT then retry, never split', r.text === 'recovered summary' && !r.tooBig && waited && ms >= 900, 'ms=' + ms + ' waited=' + waited)
  } },

  { id: 'C7 transient 5xx during summary -> retried', fn: async () => {
    const { get, crumbs } = mkCtx([errJson(502, 'Upstream inactivity timeout'), okStream('after hiccup')])
    const r = await get('summariseInto')(null, 'doc', 'x'.repeat(8000), null, null, null)
    const retried = crumbs.some(c => c.k === 'summary_transient_retry')
    check('C7 transient 5xx during summary -> retried', r.text === 'after hiccup' && retried, 'retried=' + retried)
  } },

  { id: 'C8 infl learns DOWN/UP from stream usage (EMA)', fn: async () => {
    const { get } = mkCtx([])
    const reqTok = t => Math.ceil(JSON.stringify({ messages: [
      { role: 'system', content: 'You are summarising content for the user. Be faithful and concise.' },
      { role: 'user', content: 'Summarise this document.\n\n--- d ---\n' + t }
    ] }).length / 4)
    const text = 'y'.repeat(40000)
    const rt = reqTok(text)
    get('(q => { fetch = q })')(async () => okStream('s', { prompt_tokens: Math.round(rt * 2.2), completion_tokens: 10, total_tokens: Math.round(rt * 2.2) + 10 }))
    await get('summariseInto')(null, 'd', text, null, null, null)
    const infl = get('_rlPace.infl')
    check('C8 infl learns from stream usage (EMA)', infl > 1.9 && infl < 2.1, 'infl=' + infl.toFixed(3) + ' (1.8 -> ~2.0)')
  } },

  { id: 'C9 pace gate: 2nd oversized part waits BEFORE firing', fn: async () => {
    const { get, crumbs } = mkCtx([okStream('p1'), okStream('p2')])
    const big = 'z'.repeat(430000)   // ~107k est, the real part size from the logs
    const sInto = get('summariseInto')
    await sInto(null, 'part1', big, null, null, null)
    const t0 = Date.now()
    await sInto(null, 'part2', big, null, null, null)
    const ms = Date.now() - t0
    const paced = crumbs.some(c => c.k === 'rl_wait' && c.where === 'pace')
    check('C9 pace gate: 2nd oversized part waits BEFORE firing', paced && ms >= 200, 'paced=' + paced + ' ms=' + ms)
  } },

  { id: 'C10 map-reduce: parts stay visible (doneEl) + single-level split', fn: async () => {
    const { get, crumbs } = mkCtx([okStream('P1'), okStream('P2'), okStream('COMBINED')])
    const bodyEl = { innerHTML: '', children: [], appendChild(c) { this.children.push(c) } }
    const text = 'w'.repeat(450000)   // est 112.5k > cap -> 2 parts
    const out = await get('summariseText')(null, 'big.html', text, null, bodyEl, null, 0)
    const doneEl = bodyEl.children[0]
    const kept = doneEl && /Part 1: P1/.test(doneEl.innerHTML) && /Part 2: P2/.test(doneEl.innerHTML)
    const splits = crumbs.filter(c => c.k === 'map_reduce')
    const singleLevel = splits.length === 1 && splits[0].depth === 0 && splits[0].parts === 2
    check('C10 map-reduce: parts stay visible + single-level split', out === 'COMBINED' && kept && singleLevel, 'kept=' + kept + ' splits=' + JSON.stringify(splits))
  } },

  { id: 'C11 embedsActive over D.chats', fn: async () => {
    const { get, sb } = mkCtx([])
    sb.D.chats = { a: { docs: [{ status: 'ready' }] }, b: { docs: [{ status: 'ready' }] } }
    const idle = get('embedsActive')()
    sb.D.chats.b.docs.push({ status: 'embedding' })
    const active = get('embedsActive')()
    sb.D.chats.b.docs[1].status = 'pending'
    const pending = get('embedsActive')()
    check('C11 embedsActive over D.chats', idle === false && active === true && pending === true, idle + '/' + active + '/' + pending)
  } },

  { id: 'C12 deleteChat aborts run + cancels unshared docs only', fn: async () => {
    const { ctx, get, sb, crumbs } = mkCtx([])
    sb.confirmDialog = async () => true
    sb.sortedChats = () => [{ id: 'y', messages: [1], docs: [] }]
    sb.persist = () => {}; sb.renderAll = () => {}; sb.newChat = () => {}; sb.renderChatList = () => {}
    sb.toast = () => {}; sb.gcEmbedCache = async () => {}; sb.mutate = fn => fn(sb.D)
    const shared = { id: 'd1' }, solo = { id: 'd2' }
    sb.D.chats = { x: { title: 't', docs: [shared, solo], messages: [] }, y: { docs: [{ id: 'd1' }], messages: [1] } }
    const ctl = { abortCalled: false, abort() { this.abortCalled = true } }
    sb.__ctl = ctl
    vm.runInContext('chatId = "x"; inflightCtl = __ctl', ctx)
    vm.runInContext(T30, ctx, { filename: '30-chatlist.js' })
    await get('deleteChat')('x')
    const crumbOk = crumbs.some(c => c.k === 'delete_chat' && c.abortedRun === true)
    check('C12 deleteChat aborts run + cancels unshared docs only', ctl.abortCalled === true && solo._cancelled === true && shared._cancelled !== true && crumbOk,
      'abort=' + ctl.abortCalled + ' solo=' + !!solo._cancelled + ' shared=' + !!shared._cancelled + ' crumb=' + crumbOk)
  } },

  { id: 'C14 busy send -> toast + crumb, not a silent no-op', fn: async () => {
    const { ctx, get, sb, crumbs } = mkCtx([])
    const toasts = []
    sb.toast = (m, ty) => toasts.push({ m, ty })
    sb.document.getElementById = id => (id === 'msg-in' ? { value: 'hello there' } : null)
    vm.runInContext('busy = true; chatId = "c1"; pendingRetry = null', ctx)
    await get('send')()
    const crumbOk = crumbs.some(c => c.k === 'send_blocked_busy')
    const toastOk = toasts.some(x => /Still replying/.test(x.m))
    check('C14 busy send -> toast + crumb, not a silent no-op', crumbOk && toastOk, 'crumb=' + crumbOk + ' toast=' + JSON.stringify(toasts))
  } },

  { id: 'C15 mid-reply stream death -> partial discarded + retry path', fn: async () => {
    // [[streamdie]] shape: tokens, then the proxy error frame, no finish/[DONE].
    const die = sseResp([
      JSON.stringify({ choices: [{ delta: { content: 'Here is a' }, finish_reason: null }] }),
      JSON.stringify({ error: 'upstream stream error: socket hang up' })
    ])
    const { ctx, get, sb, crumbs } = mkCtx([die])
    const fakeBubble = () => ({ dataset: {}, children: [], querySelector: () => ({ innerHTML: '' }), insertBefore() {}, remove() {} })
    sb.appendTyping = () => ({ remove() {} })
    sb.appendMsg = () => fakeBubble()
    sb.renderMessages = () => {}; sb.updateSendBtn = () => {}; sb.setHealth = () => {}
    sb.connectedLabel = () => 'ok'; sb.toast = () => {}; sb.persist = async () => {}; sb.renderDocPanel = () => {}; sb.renderChatList = () => {}; sb.renderTopbar = () => {}; sb.updateDocsBtn = () => {}; sb.scrollBottom = () => {}
    vm.runInContext('busy = false; retry5xxCount = 0; pendingRetry = null; inflightCtl = null; RETRY_STEPS_MS = [10000, 20000, 60000]', ctx)
    const chat = { messages: [], docs: [] }
    await get('runStream')(chat, { messages: [] }, null)
    const partialKept = chat.messages.some(m => m.role === 'assistant' && /Here is a/.test(m.content || '') && !m.errored)
    const crumbOk = crumbs.some(c => c.k === 'stream_died_midreply')
    check('C15 mid-reply stream death -> partial discarded + retry path', !partialKept && crumbOk, 'partialKept=' + partialKept + ' crumb=' + crumbOk)
  } },

  { id: 'C16 toast is positioned above the composer', fn: async () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8')
    const m = css.match(/#toast\{position:fixed;bottom:(\d+)px/)
    const px = m ? Number(m[1]) : 0
    check('C16 toast is positioned above the composer', px >= 100, 'bottom=' + px + 'px (composer is ~100px tall)')
  } },

  { id: 'C17 streamChatOnce reports finish_reason', fn: async () => {
    const { get } = mkCtx([okStream('partial answer', null, 'length'), okStream('full answer')])
    const sco = get('streamChatOnce')
    const a = await sco({ messages: [] }, null, null)
    const b = await sco({ messages: [] }, null, null)
    check('C17 streamChatOnce reports finish_reason', a.finish === 'length' && b.finish === 'stop', a.finish + '/' + b.finish)
  } },

  { id: 'C18 truncation note: Continue button + continuation count', fn: async () => {
    const { get } = mkCtx([])
    const mkBubble = () => ({ children: [], querySelector: () => null, insertBefore(el) { this.children.push(el) } })
    const flags = get('attachMsgFlags')
    const b1 = mkBubble()
    flags(b1, { truncated: true })
    const first = b1.children[0] && b1.children[0].innerHTML || ''
    const b2 = mkBubble()
    flags(b2, { truncated: true, continues: 2 })
    const second = b2.children[0] && b2.children[0].innerHTML || ''
    const ok = /Reply hit the token limit/.test(first) && /continueTruncated/.test(first)
      && /Still over the limit after 2 continuations/.test(second) && /continueTruncated/.test(second)
    check('C18 truncation note: Continue button + continuation count', ok, 'first=' + /token limit/.test(first) + ' second=' + /2 continuations/.test(second))
  } },

  { id: 'C19 proxyUrl shim: file:// and foreign origins hit the proxy', fn: async () => {
    const { ctx, sb, get } = mkCtx([])
    const pu = get('proxyUrl')
    sb.location = { protocol: 'file:', origin: 'null' }
    const fromFile = pu('/api/chat')
    sb.location = { protocol: 'http:', origin: 'http://localhost:5500' }
    const fromDev = pu('/api/embed-batch')
    sb.location = { protocol: 'http:', origin: 'http://127.0.0.1:3000' }
    const served = pu('/api/chat')
    const nonApi = pu('/index.html')
    sb.window = { LCL_API_BASE: 'http://127.0.0.1:4000' }
    sb.location = { protocol: 'file:', origin: 'null' }
    const overridden = pu('/api/chat')
    const ok = fromFile === 'http://127.0.0.1:3000/api/chat'
      && fromDev === 'http://127.0.0.1:3000/api/embed-batch'
      && served === '/api/chat' && nonApi === '/index.html'
      && overridden === 'http://127.0.0.1:4000/api/chat'
    check('C19 proxyUrl shim: file:// and foreign origins hit the proxy', ok,
      'file=' + fromFile + ' dev=' + fromDev + ' served=' + served + ' override=' + overridden)
  } },

  { id: 'C20 buildContent: <file> blocks the renderer can expand', fn: async () => {
    const { ctx, get } = mkCtx([])
    vm.runInContext('attachments = [{ name: \'report "final".txt\', textContent: \'AAA\' }, { name: \'notes.txt\', textContent: \'BBB\' }]', ctx)
    const out = get('buildContent')('compare these')
    const blockRe = /<file name="([^"]*)">([\s\S]*?)<\/file>/g
    const map = {}
    let m; while ((m = blockRe.exec(out)) !== null) map[m[1]] = m[2].trim()
    const names = Object.keys(map)
    const ok = typeof out === 'string' && names.length === 2 && map["report 'final'.txt"] === 'AAA' && map['notes.txt'] === 'BBB' && out.startsWith('compare these')
    check('C20 buildContent: <file> blocks the renderer can expand', ok, 'names=' + JSON.stringify(names))
  } },

  { id: 'C21 attachOversizeInfo: budget math both sides', fn: async () => {
    const { get } = mkCtx([])
    const info = get('attachOversizeInfo')
    const noChat = { messages: [] }
    const small = info([{ extractedText: 'x'.repeat(40000) }], noChat)            // ~10k tok
    const big   = info([{ extractedText: 'x'.repeat(500000) }, { extractedText: 'x'.repeat(460000) }], noChat)  // ~240k tok
    // History-aware: a small new batch must still warn when EARLIER batches bloat the chat.
    const heavyChat = { messages: [{ role: 'user', content: 'y'.repeat(700000) }] }   // ~175k tok history
    const stacked = info([{ extractedText: 'x'.repeat(80000) }], heavyChat)            // +20k new
    const ok = small.over === false && big.over === true && big.ceil === 200000 && big.newEst === 240000 && stacked.over === true && stacked.histEst > 170000
    check('C21 attachOversizeInfo: budget math both sides', ok, 'small=' + small.est + '/' + small.over + ' big=' + big.est + '/' + big.over)
  } },

  { id: 'C22 trayContextBlock: current working set only', fn: async () => {
    const { get } = mkCtx([])
    const tcb = get('trayContextBlock')
    const chat = { attachedFiles: [{ name: 'a "1".txt', textContent: 'AAA' }, { name: 'b.txt', textContent: 'BBB' }] }
    const out = tcb(chat)
    const empty = tcb({ attachedFiles: [] }) === '' && tcb(null) === ''
    const blocks = (out.match(/<file name="/g) || []).length
    check('C22 trayContextBlock: current working set only', blocks === 2 && out.includes("a '1'.txt") && empty, 'blocks=' + blocks)
  } },

  { id: 'C23 unwinnable 429 (near-full window) -> embed offer, no retry loop', fn: async () => {
    // The 6 Jul loop fixture: est 198k passed the guard, gateway said Remaining: 200000.
    const { ctx, get, sb, crumbs } = mkCtx([rl429(200000, Date.now() + 60000)])
    const bodyStub = { innerHTML: '', style: {}, appendChild() {} }
    const fakeBubble = () => ({ dataset: {}, querySelector: () => bodyStub, insertBefore() {}, remove() {} })
    sb.appendTyping = () => ({ remove() {} })
    sb.appendMsg = () => fakeBubble()
    sb.mkEl = () => ({ appendChild() {} })
    sb.renderMessages = () => {}; sb.updateSendBtn = () => {}; sb.setHealth = () => {}
    sb.connectedLabel = () => 'ok'; sb.toast = () => {}; sb.persist = async () => {}
    sb.renderChatList = () => {}; sb.renderTopbar = () => {}; sb.updateDocsBtn = () => {}; sb.renderDocPanel = () => {}
    vm.runInContext('busy = false; retry5xxCount = 0; pendingRetry = null; inflightCtl = null; RETRY_STEPS_MS = [10000, 20000, 60000]', ctx)
    const chat = { messages: [{ role: 'user', content: 'q' }], docs: [], attachedFiles: [{ name: 'big.pdf', textContent: 'x'.repeat(9000) }] }
    sb.curChat = () => chat
    await get('runStream')(chat, { messages: [] }, null)
    const offered = crumbs.some(c => c.k === 'attach_oversize_offered' && c.where === 'send')
    const waited = crumbs.some(c => c.k === 'rl_wait')
    check('C23 unwinnable 429 (near-full window) -> embed offer, no retry loop', offered && !waited, 'offered=' + offered + ' waited=' + waited)
  } },

  { id: 'C24 tray remove + embed-all mutate the chat working set', fn: async () => {
    const { ctx, get, sb } = mkCtx([])
    const chat = { attachedFiles: [{ name: 'a.txt', textContent: 'AAA' }, { name: 'b.txt', textContent: 'BBB' }], messages: [], docs: [] }
    sb.curChat = () => chat
    sb.persist = async () => {}
    let committed = null
    sb.commitDocs = async files => { committed = files }
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', '40-files.js'), 'utf8'), ctx, { filename: '40-files.js' })
    vm.runInContext('commitDocs = async files => { __committed = files }', ctx)
    get('removeTrayFile')(0, null)
    const afterRemove = chat.attachedFiles.length === 1 && chat.attachedFiles[0].name === 'b.txt'
    get('embedTrayFiles')()
    await new Promise(r => setTimeout(r, 20))
    const committedCtx = vm.runInContext('typeof __committed !== "undefined" ? __committed : null', ctx)
    const afterEmbed = chat.attachedFiles.length === 0 && committedCtx && committedCtx.length === 1 && committedCtx[0].extractedText === 'BBB'
    check('C24 tray remove + embed-all mutate the chat working set', afterRemove && afterEmbed, 'remove=' + afterRemove + ' embed=' + afterEmbed)
  } },

  { id: 'C25 clearTrayFiles empties the working set (after confirm)', fn: async () => {
    const { ctx, get, sb, crumbs } = mkCtx([])
    const chat = { attachedFiles: [{ name: 'a.txt', textContent: 'A' }, { name: 'b.txt', textContent: 'B' }], messages: [], docs: [] }
    sb.curChat = () => chat
    sb.persist = async () => {}
    sb.confirmDialog = async () => true
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', '40-files.js'), 'utf8'), ctx, { filename: '40-files.js' })
    await get('clearTrayFiles')()
    const cleared = chat.attachedFiles.length === 0
    const crumbOk = crumbs.some(c => c.k === 'attach_tray_clear' && c.files === 2)
    sb.confirmDialog = async () => false
    chat.attachedFiles = [{ name: 'c.txt', textContent: 'C' }]
    await get('clearTrayFiles')()
    const kept = chat.attachedFiles.length === 1
    check('C25 clearTrayFiles empties the working set (after confirm)', cleared && crumbOk && kept, 'cleared=' + cleared + ' declined-kept=' + kept)
  } },

  { id: 'C26 removeAllDocs clears the chat, cancels embeds, keeps on decline', fn: async () => {
    const { ctx, get, sb, crumbs } = mkCtx([])
    const d1 = { id: 'x1', name: 'a.pdf', status: 'ready' }
    const d2 = { id: 'x2', name: 'b.pdf', status: 'embedding' }
    const chat = { docs: [d1, d2], messages: [], attachedFiles: [] }
    sb.curChat = () => chat
    sb.persist = async () => {}
    sb.confirmDialog = async () => true
    sb.toast = () => {}
    sb.updateDocsBtn = () => {}
    let gc = false
    sb.gcEmbedCache = async () => { gc = true }
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', '40-files.js'), 'utf8'), ctx, { filename: '40-files.js' })
    vm.runInContext('renderDocPanel = () => {}; ragKeywordIndexCache = {}', ctx)
    await get('removeAllDocs')()
    await new Promise(r => setTimeout(r, 20))
    const cleared = chat.docs.length === 0 && d2._cancelled === true
    const crumbOk = crumbs.some(c => c.k === 'docs_remove_all' && c.files === 2)
    sb.confirmDialog = async () => false
    chat.docs = [{ id: 'x3', name: 'c.pdf' }]
    await get('removeAllDocs')()
    const kept = chat.docs.length === 1
    check('C26 removeAllDocs clears the chat, cancels embeds, keeps on decline', cleared && crumbOk && gc && kept, 'cleared=' + cleared + ' gc=' + gc + ' kept=' + kept)
  } },

  { id: 'C27 tray collapse: summary line, persist, over-state actions kept', fn: async () => {
    const { ctx, get, sb, crumbs } = mkCtx([])
    const store = {}
    sb.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v) } }
    const el = { className: '', innerHTML: '' }
    sb.document = { getElementById: id => (id === 'attach-tray' ? el : null) }
    sb.esc = s => String(s)
    sb.persist = async () => {}
    const chat = { attachedFiles: [
      { name: 'a.txt', textContent: 'x'.repeat(400) },
      { name: 'b.txt', textContent: 'y'.repeat(400) },
      { name: 'c.txt', textContent: 'z'.repeat(400) }
    ], messages: [], docs: [] }
    sb.curChat = () => chat
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', '40-files.js'), 'utf8'), ctx, { filename: '40-files.js' })
    get('renderAttachTray')()
    const expanded = el.innerHTML.includes('at-chip') && el.innerHTML.includes('remove all') &&
      el.innerHTML.includes('▾') && !el.className.includes('min') &&
      el.innerHTML.includes('class="at-lbl"') && el.innerHTML.includes('onclick="toggleTrayMin(event)"')
    get('toggleTrayMin')(null)
    const collapsed = el.className.includes('min') && el.innerHTML.includes('3 files attached') &&
      !el.innerHTML.includes('at-chip') && !el.innerHTML.includes('remove all') &&
      el.innerHTML.includes('at-meter') && el.innerHTML.includes('▸') && store.lcl_tray_min === '1'
    const crumbOk = crumbs.some(c => c.k === 'attach_tray_min' && c.min === true)
    // Over-budget while collapsed: the warning label + Embed action must stay visible.
    chat.attachedFiles = [{ name: 'huge.txt', textContent: 'x'.repeat(900000) }]
    get('renderAttachTray')()
    const overMin = el.className.includes('over') && el.className.includes('min') &&
      el.innerHTML.includes('Embed all for RAG') && el.innerHTML.includes('too large to send')
    get('toggleTrayMin')(null)
    const back = !el.className.includes('min') && el.innerHTML.includes('at-chip') && store.lcl_tray_min === '0'
    check('C27 tray collapse: summary line, persist, over-state actions kept',
      expanded && collapsed && crumbOk && overMin && back,
      'expanded=' + expanded + ' collapsed=' + collapsed + ' overMin=' + overMin + ' back=' + back)
  } },

  { id: 'C28 settings spNav: single section on, persisted, legacy spTab alias', fn: async () => {
    const S = src('80-ui.js')
    const mNav = S.match(/function spNav\(sec\)\{[\s\S]*?\n\}/)
    const mTab = S.match(/function spTab\(name\)\{.*\}/)
    if (!mNav || !mTab) return check('C28 settings spNav', false, 'spNav/spTab not found in 80-ui.js')
    const SECS = ['connection', 'embedding', 'rag', 'defaults', 'updates', 'account']
    const node = sec => { const n = { dataset: { sec }, on: null }; n.classList = { toggle: (c, v) => { if (c === 'on') n.on = v } }; return n }
    const secs = SECS.map(node), navs = SECS.map(node)
    const store = {}
    const ctx = vm.createContext({
      document: { querySelectorAll: sel => (sel.indexOf('.sp-sec') >= 0 ? secs : navs) },
      localStorage: { setItem: (k, v) => { store[k] = String(v) }, getItem: k => (k in store ? store[k] : null) }
    })
    vm.runInContext(mNav[0] + '\n' + mTab[0], ctx)
    vm.runInContext('spNav("rag")', ctx)
    const onSecs = secs.filter(s => s.on), onNavs = navs.filter(n => n.on)
    const routed = onSecs.length === 1 && onSecs[0].dataset.sec === 'rag' &&
      onNavs.length === 1 && onNavs[0].dataset.sec === 'rag'
    const persisted = store.lcl_sp_sec === 'rag'
    vm.runInContext('spTab("settings")', ctx)
    const alias1 = store.lcl_sp_sec === 'defaults' && secs.filter(s => s.on)[0].dataset.sec === 'defaults'
    vm.runInContext('spTab("models")', ctx)
    const alias2 = store.lcl_sp_sec === 'connection'
    check('C28 settings spNav: single section on, persisted, legacy spTab alias',
      routed && persisted && alias1 && alias2,
      'routed=' + routed + ' persisted=' + persisted + ' alias=' + (alias1 && alias2))
  } },

  { id: 'C29 split run carries the user instruction through map-reduce', fn: async () => {
    const q = [okStream('EXTRACT-1'), okStream('EXTRACT-2'), okStream('ANSWER')]
    const { get, sb } = mkCtx(q)
    const bodies = []
    sb.fetch = async (url, opts) => { bodies.push(String((opts && opts.body) || '')); if (!q.length) throw new Error('fetch queue empty'); const r = q.shift(); return typeof r === 'function' ? r() : r }
    const ask = "Search the presenter's name in the document."
    const out = await get('summariseText')(null, 'slides.html', 'w'.repeat(450000), ask, null, null, 0)
    const partOk = bodies.length === 3 &&
      bodies[0].includes('extract everything relevant') && bodies[0].includes("presenter's name") &&
      bodies[1].includes('extract everything relevant') && bodies[1].includes("presenter's name")
    const combineOk = bodies[2].includes('answer the original request') && bodies[2].includes("presenter's name") && bodies[2].includes('EXTRACT-1')
    const sysOk = !bodies[0].includes('You are summarising') && bodies[0].includes('processing a document')
    // A summarise-style ask keeps the original generic prompts:
    const q2 = [okStream('S1'), okStream('S2'), okStream('SUM')]
    const m2 = mkCtx(q2)
    const bodies2 = []
    m2.sb.fetch = async (url, opts) => { bodies2.push(String((opts && opts.body) || '')); return q2.shift() }
    await m2.get('summariseText')(null, 'big.html', 'w'.repeat(450000), 'Summarise this document.', null, null, 0)
    const genericOk = bodies2.length === 3 && bodies2[0].includes('Summarise this part of a document.') && bodies2[2].includes('one cohesive summary')
    check('C29 split run carries the user instruction through map-reduce', out === 'ANSWER' && partOk && combineOk && sysOk && genericOk, 'part=' + partOk + ' combine=' + combineOk + ' sys=' + sysOk + ' generic=' + genericOk)
  } },

  { id: 'C31 gateway switch: per-gateway key vault + endpoint POST', fn: async () => {
    const S = src('80-ui.js')
    const mE = S.match(/\/\/ === endpoint-dev ===([\s\S]*?)\/\/ === end endpoint-dev ===/)
    const mG = S.match(/\/\/ === gateway ===([\s\S]*?)\/\/ === end gateway ===/)
    if (!mE || !mG) return check('C31 gateway switch', false, 'markers not found')
    const posts = []
    const PA3 = 'https://api.ai.tech.gov.sg/platform/models/chat/completions'
    const KP3 = 'https://nc3.gov.sg/kepler/v1/chat/completion'
    const gwbTitle = { textContent: '' }, gwbUrl = { textContent: '' }
    const banner = { className: 'hidden', querySelector: sel => (sel === '.gwb-title' ? gwbTitle : (sel === '.gwb-url' ? gwbUrl : null)) }
    const ctx = vm.createContext({
      document: { getElementById: id => (id === 'gw-emb-banner' ? banner : null), querySelectorAll: () => [], querySelector: () => null },
      setTimeout: () => 0, console, URL,
      httpPost: async (u, b) => { posts.push({ u, b }); return { ok: true, json: async () => ({ ok: true, active: { name: b.name, modelUrl: b.modelUrl, embedUrl: b.embedUrl } }) } },
      toast: () => {}, lclCrumb: () => {},
      creds: { apiKey: 'PLAT-KEY', embedApiKey: 'PLAT-EMB', embedModelId: 'emb-1', model: 'm1' },
      D: { settings: {} },
      credsToSettings: c2 => ({ apiKey: c2.apiKey }), saveSettings: () => {}, persist: () => {}
    })
    vm.runInContext(mE[0] + String.fromCharCode(10) + mG[0], ctx)
    vm.runInContext('lclEndpoint = { active: { name: "PlatformAI", modelUrl: ' + JSON.stringify(PA3) + ' }, isDefault: true, presets: [{ name: "PlatformAI", modelUrl: ' + JSON.stringify(PA3) + ', embedUrl: "pe" }, { name: "Kepler", modelUrl: ' + JSON.stringify(KP3) + ', embedUrl: "ke" }, { name: "NC3 Dev", modelUrl: "https://dev-nc3.csa.gov.sg/kepler/v1/chat/completion", embedUrl: "x" }] }', ctx)
    const gw0 = vm.runInContext('currentGateway()', ctx)
    await vm.runInContext('setGateway("Kepler", "sp")', ctx)
    const vault1 = vm.runInContext('D.settings.gwVault.PlatformAI.apiKey', ctx) === 'PLAT-KEY'
    const cleared = vm.runInContext('creds.apiKey', ctx) === '' && vm.runInContext('creds.embedApiKey', ctx) === ''
    const gw1 = vm.runInContext('currentGateway()', ctx)
    const post1 = posts.length === 1 && posts[0].u === '/api/endpoint' && posts[0].b.name === 'Kepler' && posts[0].b.modelUrl === KP3 && posts[0].b.embedUrl === 'ke'
    // user pastes the assigned Kepler key, then flips back
    vm.runInContext('creds.apiKey = "KEP-KEY"; creds.embedApiKey = "KEP-EMB"', ctx)
    await vm.runInContext('setGateway("PlatformAI", "sp")', ctx)
    const restored = vm.runInContext('creds.apiKey', ctx) === 'PLAT-KEY' && vm.runInContext('creds.embedApiKey', ctx) === 'PLAT-EMB'
    const vault2 = vm.runInContext('D.settings.gwVault.Kepler.apiKey', ctx) === 'KEP-KEY'
    const gw2 = vm.runInContext('currentGateway()', ctx)
    const noteOk = gwbTitle.textContent === 'Embedding via PlatformAI' && gwbUrl.textContent === 'pe' && banner.className === ''
    check('C31 gateway switch: per-gateway key vault + endpoint POST', gw0 === 'PlatformAI' && gw1 === 'Kepler' && vault1 && cleared && post1 && restored && vault2 && gw2 === 'PlatformAI' && noteOk, 'gw=' + gw0 + '>' + gw1 + '>' + gw2 + ' vault=' + vault1 + '/' + vault2 + ' cleared=' + cleared + ' restored=' + restored + ' post=' + post1)
  } },
  { id: 'C13 toast duration: type floor + length scaling', fn: async () => {
    const m = src('80-ui.js').match(/function toast\(msg,type\) \{[\s\S]*?\n\}/)
    if (!m) return check('C13 toast duration', false, 'toast() not found in 80-ui.js')
    const delays = []
    const ctx = vm.createContext({
      document: { getElementById: () => ({ textContent: '', className: '' }) },
      setTimeout: (fn, ms) => { delays.push(ms); return 0 }, clearTimeout: () => {},
      Math, String, toastT: 0
    })
    vm.runInContext('let _t;\n' + m[0].replace('clearTimeout(toastT); toastT=', 'clearTimeout(_t); _t='), ctx)
    const toast = vm.runInContext('toast', ctx)
    toast('boom', 'err'); toast('Saved', 'ok'); toast('hi', 'info'); toast('x'.repeat(160), 'err')
    const ok = delays[0] === 6000 && delays[1] === 4000 && delays[2] === 2800 && delays[3] > 6000 && delays[3] <= 8000
    check('C13 toast duration: type floor + length scaling', ok, 'delays=' + JSON.stringify(delays))
  } },
  { id: 'C33 connect ping routed through proxyUrl (file:// fix)', fn: async () => {
    const S = src('20-auth.js')
    const routed = S.includes("fetchWithRetry(proxyUrl('/api/chat')")
    const noRaw = !S.includes("fetchWithRetry('/api/chat'")
    check('C33 connect ping routed through proxyUrl (file:// fix)', routed && noRaw, 'routed=' + routed + ' noRaw=' + noRaw)
  } },
  { id: 'C34 gatewayErrorMessage: 503/HTML proxy page -> friendly (server.txt)', fn: async () => {
    const S = fs.readFileSync(path.join(__dirname, '..', 'server.txt'), 'utf8')
    const m = S.match(/function gatewayErrorMessage\(upstream, label\) \{[\s\S]*?\n\}/)
    if (!m) return check('C34 gatewayErrorMessage', false, 'function not found in server.txt')
    const ctx = vm.createContext({})
    vm.runInContext(m[0], ctx)
    const fn = vm.runInContext('gatewayErrorMessage', ctx)
    const html503 = { statusCode: 503, body: '<!DOCTYPE HTML PUBLIC "-//W3C//DTD"><HTML><HEAD><TITLE>ERROR: The requested URL could not be retrieved</TITLE></HEAD></HTML>' }
    const msg = fn(html503, 'embeddings')
    const friendly = !!msg && /temporarily unavailable/.test(msg) && /HTTP 503/.test(msg) && /network proxy/.test(msg) && !/DOCTYPE/i.test(msg)
    const jsonNull = fn({ statusCode: 400, body: '{"error":"bad model"}' }, 'embeddings') === null
    check('C34 gatewayErrorMessage: 503/HTML proxy page -> friendly (server.txt)', friendly && jsonNull, 'msg=' + JSON.stringify(msg) + ' jsonNull=' + jsonNull)
  } },
  { id: 'C49 sanitizeSecrets scrubs api_key from any log line (server.txt)', fn: async () => {
    // Centralised log sink scrubber: a 429 throttling body echoes the FULL api_key and
    // was persisted to debug_logs.txt in clear (16 Jul log). sanitizeSecrets must strip
    // it while keeping the useful diagnostics (limit type / remaining / reset).
    const S = fs.readFileSync(path.join(__dirname, '..', 'server.txt'), 'utf8')
    const m = S.match(/function sanitizeSecrets\(s\) \{[\s\S]*?\n\}/)
    if (!m) return check('C49 sanitizeSecrets', false, 'function not found in server.txt')
    const ctx = vm.createContext({}); vm.runInContext(m[0], ctx)
    const fn = vm.runInContext('sanitizeSecrets', ctx)
    const KEY = 'deadbeefcafef00ddeadbeefcafef00ddeadbeefcafef00ddeadbeefcafef00d'   // fake 64-hex fixture (never a real key)
    const body = '[stream] non-200 body (429, 276 bytes) = {"error":{"message":"Rate limit exceeded for api_key: ' + KEY + '. Limit type: tokens. Current limit: 200000, Remaining: 18861. Limit resets at: 2026-07-16 01:33:13 UTC"}}'
    const out = fn(body)
    const keyGone = out.indexOf(KEY) === -1 && /\[redacted\]/.test(out)
    const kept = /Limit type: tokens/.test(out) && /Remaining: 18861/.test(out) && /resets at/.test(out)
    const benign = fn('[stream] upstream end | 19 events | 3998 bytes | finish stop') === '[stream] upstream end | 19 events | 3998 bytes | finish stop'
    const bearerGone = fn('Authorization: Bearer sk-abcdef0123456789xyz').indexOf('sk-abcdef0123456789xyz') === -1
    check('C49 sanitizeSecrets scrubs api_key, keeps diagnostics (server.txt)', keyGone && kept && benign && bearerGone,
      'keyGone=' + keyGone + ' kept=' + kept + ' benign=' + benign + ' bearerGone=' + bearerGone)
  } },
  { id: 'C51 two-phase upstream timeout: generous first byte, tighter inter-token (server.txt)', fn: async () => {
    // 16 Jul log: ~100k-token turns took >10s to first token and were killed by the old
    // single 10s inactivity window (502). Now the FIRST byte gets a generous budget and
    // the tight per-token window is armed only once streaming starts.
    const S = fs.readFileSync(path.join(__dirname, '..', 'server.txt'), 'utf8')
    const hasBudget = /const firstByteMsBudget = Math\.min\(180000, Math\.max\(inactivityMs, 90000\)\)/.test(S)
    const armsFirst = S.includes("onStreamTimeout('first-byte'")
    const tightens = S.includes("onStreamTimeout('inactivity'")
    check('C51 two-phase upstream timeout (server.txt)', hasBudget && armsFirst && tightens,
      'budget=' + hasBudget + ' armsFirst=' + armsFirst + ' tightens=' + tightens)
  } },

  { id: 'C52 compaction folds old turns, keeps recent, preserves full history + shrinks the send', fn: async () => {
    const { ctx, get, sb, crumbs } = mkCtx([ okStream('COMPACTED SUMMARY', { total_tokens: 50 }, 'stop') ])
    sb.persist = async () => {}
    sb.creds = { model: 'demo', apiKey: 'K', maxTokens: 8192, compactTokens: 100 }   // tiny threshold to trigger
    const msgs = []
    for (let i = 0; i < 6; i++) { msgs.push({ role:'user', content:'question ' + i + ' ' + 'x'.repeat(60), ts:i*2 }); msgs.push({ role:'assistant', content:'answer ' + i + ' ' + 'y'.repeat(60), ts:i*2+1 }) }
    const chat = { id:'c1', messages: msgs }
    sb.D = { chats: { c1: chat } }
    vm.runInContext('chatId = "c1"', ctx)
    const before = chat.messages.length
    const sentBefore = get('estSentHistoryTokens')(chat)
    const res = await get('compactChatIfNeeded')(chat)
    const sentAfter = get('estSentHistoryTokens')(chat)
    const ok = !res.aborted && chat.compaction && chat.compaction.summary === 'COMPACTED SUMMARY'
      && chat.compaction.uptoIndex === before - 8 && chat.messages.length === before && sentAfter < sentBefore
      && crumbs.some(c => c.k === 'compacted')
    check('C52 compaction folds old turns, keeps recent, preserves full history + shrinks the send', ok,
      'upto=' + (chat.compaction && chat.compaction.uptoIndex) + ' kept=' + chat.messages.length + ' sent ' + sentBefore + '->' + sentAfter)
  } },

  { id: 'C53 no compaction under threshold, and none when only recent turns remain', fn: async () => {
    const { ctx, get, sb } = mkCtx([])   // empty fetch queue: any summary call would throw
    sb.persist = async () => {}
    sb.creds = { model:'demo', apiKey:'K', maxTokens:8192 }   // default ~50k threshold
    const small = { id:'c2', messages: [ {role:'user',content:'hi',ts:1}, {role:'assistant',content:'hello',ts:2} ] }
    sb.D = { chats: { c2: small } }
    vm.runInContext('chatId = "c2"', ctx)
    const r1 = await get('compactChatIfNeeded')(small)
    const under = !r1.aborted && !small.compaction
    sb.creds.compactTokens = 1   // force over-threshold, but too few messages to fold (< keep-recent)
    const tiny = { id:'c2', messages: [ {role:'user',content:'x'.repeat(60),ts:1}, {role:'assistant',content:'y'.repeat(60),ts:2} ] }
    sb.D.chats.c2 = tiny
    const r2 = await get('compactChatIfNeeded')(tiny)
    const noFold = !r2.aborted && !tiny.compaction
    check('C53 no compaction under threshold, and none when only recent turns remain', under && noFold, 'under=' + under + ' noFold=' + noFold)
  } },

  { id: 'C54 retry countdown survives: runStream finally gates uiSync on !pendingRetry', fn: async () => {
    // Regression: the finish-in-background uiSync() rebuilt the message list from
    // chat.messages in runStream\u2019s finally, wiping the transient 429/5xx countdown
    // bubble (which is NOT a stored message) the instant it was shown.
    const S = fs.readFileSync(path.join(__dirname, '..', 'src', '50-chatprocessing.js'), 'utf8')
    const guarded = /if \(!pendingRetry\) uiSync\(\)/.test(S)
    check('C54 retry countdown survives: uiSync gated by !pendingRetry', guarded, 'guarded=' + guarded)
  } },
  { id: 'C35 OCR engine uses a reachable CDN (langPath off projectnaptha) + persistent worker', fn: async () => {
    const S = src('40-files.js')
    const noNaptha = !S.includes('tessdata.projectnaptha.com')
    const jsdelivrLang = S.includes("TESSERACT_LANG = 'https://cdn.jsdelivr.net/gh/naptha/tessdata@gh-pages/4.0.0'")
    const wiredLang = S.includes('langPath: TESSERACT_LANG')
    const persistent = S.includes('let _ocrWorker = null') && S.includes('async function ensureOcrWorker')
    const noStore = S.includes("cacheMethod: 'none'")
    const inits = S.includes("loadLanguage('eng')") && S.includes("initialize('eng', 1)")
    const optsFirstArg = S.includes('createWorker({ langPath: TESSERACT_LANG')  // langPath MUST be the 1st-arg options or it falls back to the CORS-blocked default host
    check('C35 OCR engine: reachable CDN + persistent worker + no IndexedDB + explicit init', noNaptha && jsdelivrLang && wiredLang && persistent && noStore && inits && optsFirstArg, 'noNaptha=' + noNaptha + ' lang=' + jsdelivrLang + ' wired=' + wiredLang + ' persistent=' + persistent + ' noStore=' + noStore + ' inits=' + inits + ' optsFirstArg=' + optsFirstArg)
  } },
  { id: 'C36 image files route through OCR (imageExtractor + filter + recognize)', fn: async () => {
    const S = src('40-files.js')
    const regd = S.includes('png:  (file) => imageExtractor(file)') && S.includes('jpeg: (file) => imageExtractor(file)')
    const fn = S.includes('function imageExtractor(file)') && S.includes('ocrFile: file') && S.includes("scanWarning: 'Image file")
    const filter = S.includes('f.scanWarning && (f.pdfDoc || f.ocrFile)')
    const imgOcr = S.includes('else if (item.ocrFile)') && S.includes('worker.recognize(item.ocrFile)')
    const carried = (S.match(/pdfDoc, ocrFile,/g) || []).length >= 3   // destructure + progressive assign + docs push
    check('C36 image files route through OCR (imageExtractor + filter + recognize + ocrFile carried)', regd && fn && filter && imgOcr && carried, 'regd=' + regd + ' fn=' + fn + ' filter=' + filter + ' imgOcr=' + imgOcr + ' carried=' + carried)
  } },
  { id: 'C37 OCR chip + popover wired (80-ui + body.html)', fn: async () => {
    const U = src('80-ui.js'); const B = src('body.html')
    const fns = U.includes('function renderOcrChip(') && U.includes('function toggleOcrInfo(')
    const chip = B.includes('id="ocr-chip"') && B.includes('onclick="toggleOcrInfo(event)"')
    const acts = B.includes('onclick="toggleOcrEngine()"') && src('40-files.js').includes('function toggleOcrEngine(')
    check('C37 OCR chip + popover wired (80-ui + body.html)', fns && chip && acts, 'fns=' + fns + ' chip=' + chip + ' acts=' + acts)
  } },
  { id: 'C38 OCR 3-way dialog + progress + attach wiring', fn: async () => {
    const S = src('40-files.js'); const U = src('80-ui.js')
    const dialog = U.includes('function confirmDialog3(')
    const prompt = S.includes('async function promptOcr(') && S.includes("value: 'ocr'") && S.includes("value: 'plain'") && S.includes("value: 'cancel'")
    const embedWired = S.includes("promptOcr(scannedItems, 'embed')")
    const attachWired = S.includes("promptOcr(scannedItems, 'attach')")
    const progress = S.includes('function setOcrProgress(') && S.includes('setOcrProgress(i + 1, item.emptyPageNums.length)')
    // Same modal for embed AND upload: OCR offered up-front on extraction; no confirm-time prompt, no banner.
    const noBanner = !S.includes('runPreviewOcr') && !src('body.html').includes('fp-scan-banner')
    check('C38 OCR 3-way dialog (same modal for embed + attach) + progress', dialog && prompt && embedWired && attachWired && progress && noBanner, 'dialog=' + dialog + ' prompt=' + prompt + ' embed=' + embedWired + ' attach=' + attachWired + ' prog=' + progress + ' noBanner=' + noBanner)
  } },
  { id: 'C39 health pill shows + OCR (label only, no progress) + no redundant Ready line', fn: async () => {
    const R = src('70-render.js'); const U = src('80-ui.js'); const F = src('40-files.js')
    // Pill shows '+ OCR' when the engine is on; the pill refreshes when it toggles.
    const ocrLabel = R.includes("base += ' + OCR'") && R.includes("ocrState() === 'ready'")
    const pillRefresh = F.includes("pill.classList.contains('ok')") && F.includes("setHealth('ok', connectedLabel())")
    // ...but the live 'n/N' progress stays on the chip only, never the pill.
    const noPillProgress = !F.includes("setHealth('warn', 'OCR") && F.includes('setOcrProgress(i + 1, item.emptyPageNums.length)')
    // 'ready' maps to an empty status line (green 'On' toggle is enough), and it's hidden.
    const noReadyWord = U.includes('ready:') && U.includes("statusEl.style.display = label ? '' : 'none'")
    check('C39 health pill shows + OCR (label only, no progress) + no redundant Ready line', ocrLabel && pillRefresh && noPillProgress && noReadyWord, 'ocrLabel=' + ocrLabel + ' pillRefresh=' + pillRefresh + ' noPillProgress=' + noPillProgress + ' noReadyWord=' + noReadyWord)
  } },
  { id: 'C40 OCR dialog redesign (stacked + chips + variants) + persist/auto-enable', fn: async () => {
    const U = src('80-ui.js'); const F = src('40-files.js'); const T = src('tail.html')
    // confirmDialog3 grows a stacked layout with variant buttons, sub-labels and a file chip.
    const dialog = U.includes('cd3-btn cd3-') && U.includes('cd3-btn-sub') && U.includes('cd3-chip')
    // promptOcr uses the new structure (stacked, chips, primary/secondary/ghost).
    const prompt = F.includes('stacked: true') && F.includes('chips: scannedItems.map') && F.includes("variant: 'primary'") && F.includes("variant: 'ghost'")
    // Preference persists + auto-enables on boot.
    const persist = F.includes("localStorage.setItem('lcl_ocr_on', '1')") && F.includes("localStorage.setItem('lcl_ocr_on', '0')")
    const autoEnable = F.includes('function autoEnableOcr(') && F.includes("localStorage.getItem('lcl_ocr_on') === '1'") && T.includes('autoEnableOcr()')
    check('C40 OCR dialog redesign (stacked + chips + variants) + persist/auto-enable', dialog && prompt && persist && autoEnable, 'dialog=' + dialog + ' prompt=' + prompt + ' persist=' + persist + ' autoEnable=' + autoEnable)
  } },
  { id: 'C41 popup buttons share sizing (cd-ok primary, no full-width btn-p)', fn: async () => {
    const U = src('80-ui.js'); const C = src('styles.css')
    // Dialog primaries use the cd-ok chip (matches cd-cancel height), never the full-width btn-p.
    const noBtnPInDialogs = !U.includes("'btn-p cd-ok'") && !U.includes("b.primary ? 'btn-p'") && U.includes("class: 'cd-ok'")
    const cdOkStyled = C.includes('.cd-ok{') && C.includes('border:1px solid var(--ac)') && C.includes('.cd-acts{display:flex;justify-content:flex-end;align-items:center')
    check('C41 popup buttons share sizing (cd-ok primary, no full-width btn-p)', noBtnPInDialogs && cdOkStyled, 'noBtnP=' + noBtnPInDialogs + ' cdOk=' + cdOkStyled)
  } },
  { id: 'C42 centered popups share one spec (16px corners, .5/6px backdrop)', fn: async () => {
    const C = src('styles.css')
    // Every centered box uses the shared --r-modal (16px) corner token + modal shadow.
    const corners = C.includes('--r-modal: 16px')
      && C.includes('.modal{background:var(--bg2);border:1px solid var(--bdr2);border-radius:var(--r-modal);padding:40px') // .modal
      && C.includes('.cd-box{background:var(--bg2);border:1px solid var(--bdr2);border-radius:var(--r-modal);padding:22px') // .cd-box
      && C.includes('.search-box{background:var(--bg2);border:1px solid var(--bdr2);border-radius:var(--r-modal);') // .search-box
    // No more 55%/65% backdrops; the confirm overlay is now blurred like the rest.
    const backdrops = !C.includes('background:rgba(0,0,0,.65)') && !C.includes('background:rgba(0,0,0,.55)')
      && C.includes('z-index:10000;padding:20px;backdrop-filter:blur(6px)')
    check('C42 centered popups share one spec (16px corners, .5/6px backdrop)', corners && backdrops, 'corners=' + corners + ' backdrops=' + backdrops)
  } },
  { id: 'C43 cancelling an embed resets the health pill (no stuck Preparing to embed)', fn: async () => {
    const F = src('40-files.js')
    // A helper returns the pill to connected, guarded by embedsActive.
    const helper = F.includes('function healthIdle(') && F.includes('embedsActive()') && F.includes("setHealth('ok'")
    // Called on the OCR-cancel path, the embed-batch cancel path, the commitDocs end, and preview cancel.
    const ocrCancel = /choice === 'cancel'[^}]*healthIdle\(\)/.test(F)
    const batchCancel = /Embedding cancelled[\s\S]{0,40}healthIdle\(\)/.test(F)
    const commitEnd = F.includes('updateDocsBtn(); healthIdle()')
    check('C43 cancelling an embed resets the health pill (no stuck Preparing to embed)', helper && ocrCancel && batchCancel && commitEnd, 'helper=' + helper + ' ocrCancel=' + ocrCancel + ' batchCancel=' + batchCancel + ' commitEnd=' + commitEnd)
  } },
  { id: 'C44 text polish: ellipsis + em-dash + middot separators', fn: async () => {
    const F = src('40-files.js'); const Ra = src('15-rag.js'); const Rn = src('70-render.js'); const B = src('body.html')
    // No three-dot ellipsis left in the touched user-facing strings.
    const noDots = !F.includes("'Reading files...'") && !F.includes("'Testing...'") && !F.includes("Enabling OCR engine...'") && !Ra.includes("'Embedding... batch")
    // Em-dash (not hyphen) in OCR + rate-limit messages.
    const emdash = F.includes('OCR done — read') && Ra.includes('Rate limit — resuming in')
    // Middot separators, not literal asterisks.
    const middot = Rn.includes(" + ' · ' + fmtDate") && B.includes('Enter to send  ·  Shift+Enter')
    check('C44 text polish: ellipsis + em-dash + middot separators', noDots && emdash && middot, 'noDots=' + noDots + ' emdash=' + emdash + ' middot=' + middot)
  } },
  { id: 'C45 colour tokens + danger class + modal radius token + no dead off state', fn: async () => {
    const C = src('styles.css'); const A = src('20-auth.js'); const F = src('40-files.js')
    // Ad-hoc greens/olive/pin/red literals consolidated onto tokens.
    const noLiterals = !C.includes('#2ea44f') && !C.includes('#3B6D11') && !C.includes('.ocr-dot.ocr-loading{background:#f0a500}') && !C.includes('#e05050') && !F.includes("'#4caf50'")
    // Shared danger button + modal radius token.
    const struct = C.includes('.btn-danger{') && C.includes('--r-modal: 16px')
    // Dead 'off' health state removed (it added a CSS class with no rule).
    const noOff = !A.includes("setHealth('off'")
    check('C45 colour tokens + danger class + modal radius token + no dead off state', noLiterals && struct && noOff, 'noLiterals=' + noLiterals + ' struct=' + struct + ' noOff=' + noOff)
  } },
  { id: 'C46 paste image into composer routes to the attach flow', fn: async () => {
    const X = src('90-extras.js'); const T = src('tail.html')
    // A paste listener pulls image files off the clipboard and hands them to handleAttach.
    const fn = X.includes('function initPasteImages(') && X.includes("addEventListener('paste'") && X.includes("indexOf('image/') === 0") && X.includes('handleAttach(files)')
    const wired = T.includes('initPasteImages()')
    check('C46 paste image into composer routes to the attach flow', fn && wired, 'fn=' + fn + ' wired=' + wired)
  } },
  { id: 'C47 flush chats to disk before an update restart', fn: async () => {
    const U = src('97-update-ui.js')
    const helper = U.includes('async function flushBeforeRestart(') && U.includes('await persist()')
    // Every server-restart request is preceded by a flush, so a Node restart can't drop the most recent chat.
    const restartCalls = (U.match(/httpPost\('\/api\/update\/restart'\)/g) || []).length
    const flushes = (U.match(/await flushBeforeRestart\(\)/g) || []).length
    check('C47 flush chats to disk before an update restart', helper && restartCalls >= 3 && flushes >= restartCalls, 'helper=' + helper + ' restartCalls=' + restartCalls + ' flushes=' + flushes)
  } },
]

;(async () => {
  for (const c of CASES) {
    say('.. ' + c.id)
    // Per-case watchdog: a hung case fails loudly instead of freezing the suite.
    const watchdog = new Promise((_, rej) => setTimeout(() => rej(new Error('case timeout (20s)')), 20000))
    try { await Promise.race([c.fn(), watchdog]) } catch (e) { check(c.id, false, 'threw: ' + e.message) }
  }
  say('')
  say(pass + '/' + (pass + fail) + ' passed  (client-logic)')
  process.exit(fail ? 1 : 0)
})()
