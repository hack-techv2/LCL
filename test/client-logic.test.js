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
