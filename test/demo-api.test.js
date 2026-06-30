// =============================================================================
// LCL Demo-API regression harness  (server-side)
// -----------------------------------------------------------------------------
// Boots the REAL ../server.txt on a spare port (3990), IN-PROCESS, and exercises
// the #demo (DEMOKEY) endpoints over HTTP. Nothing is mocked — it hits real route
// dispatch + the demo responder + the x-lcl-demo gate + RAG plumbing + error
// markers + the every-5 auto-retry. The only edit to server.txt is the port
// number (so it never collides with a live :3000).
//
// Run ALL:      node test/demo-api.test.js
// Run a subset: node test/demo-api.test.js gate errors      (groups, space-sep)
// Groups:       chat  embed  rag  errors  retry  gate  slow(opt-in, see below)
// Exit code:    0 = all passed, 1 = a failure  (CI-friendly)
//
// Only run the groups a change touches (see CLAUDE.md "what to run"). Extend by
// adding a { id, tags, fn } to CASES below and documenting it in TEST_CASES.md.
// =============================================================================
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http')

const SRC  = path.join(__dirname, '..', 'server.txt')
const PORT = 3990
const TMP  = path.join(os.tmpdir(), 'lcl_srv_under_test.js')
fs.writeFileSync(TMP, fs.readFileSync(SRC, 'utf8').replace('const PORT = 3000', 'const PORT = ' + PORT))
process.chdir(os.tmpdir())
require(TMP)   // server.txt starts listening on 127.0.0.1:PORT as a side effect

// --- helpers ----------------------------------------------------------------
function req(opts, body) {
  return new Promise(res => {
    const r = http.request(Object.assign({ host: '127.0.0.1', port: PORT }, opts), resp => {
      let d = ''; resp.on('data', c => d += c); resp.on('end', () => res({ status: resp.statusCode, body: d }))
    })
    r.on('error', e => res({ status: 0, body: 'ERR ' + e.message }))
    if (body) r.write(body)
    r.end()
  })
}
const H    = { 'content-type': 'application/json', 'x-lcl-demo': '1' }   // the demo gate header
const chat = (content, stream) => JSON.stringify({ apiKey: 'DEMOKEY', modelId: 'demo', payload: { messages: [{ role: 'user', content }], stream: !!stream } })
const json = s => { try { return JSON.parse(s) } catch { return {} } }

let pass = 0, fail = 0
function check(name, ok, detail) { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '   ' + detail : '')); ok ? pass++ : fail++ }

// --- cases (tagged into groups) ---------------------------------------------
// NOTE: T0 must run before any other plain streamed chat so the every-5 counter
// starts fresh — it is first in the list, so any group that includes it is fine.
const CASES = [
  { id: 'T0  auto-retry every 5', tags: ['chat', 'retry'], fn: async () => {
    const rl = []; for (let k = 0; k < 6; k++) rl.push(await req({ method: 'POST', path: '/api/chat', headers: H }, chat('auto rl ' + k, true)))
    const st = rl.map(x => x.status)
    const stamp = /Limit resets at:\s*\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}\s*UTC/i.test(rl[4].body)
    check('T0  auto-retry every 5', st[4] === 429 && st[5] === 200 && stamp, 'statuses=' + JSON.stringify(st))
  } },
  { id: 'T1  chat stream SSE', tags: ['chat'], fn: async () => {
    const a = await req({ method: 'POST', path: '/api/chat', headers: H }, chat('hello there', true))
    check('T1  chat stream SSE', a.status === 200 && /"delta":\{"content"/.test(a.body) && /\[DONE\]/.test(a.body) && /"finish_reason":"stop"/.test(a.body))
  } },
  { id: 'T2  buffered auto-title', tags: ['chat'], fn: async () => {
    const b = await req({ method: 'POST', path: '/api/chat', headers: H }, JSON.stringify({ apiKey: 'DEMOKEY', modelId: 'demo', payload: { messages: [{ role: 'system', content: 'reply with a short title' }, { role: 'user', content: 'x' }], max_tokens: 24, stream: false } }))
    check('T2  buffered auto-title', b.status === 200 && !!json(b.body).choices, 'title="' + (json(b.body).choices && json(b.body).choices[0].message.content) + '"')
  } },
  { id: 'T3  buffered code fence', tags: ['chat'], fn: async () => {
    const cc = await req({ method: 'POST', path: '/api/chat', headers: H }, chat('write me a code snippet', false))
    check('T3  buffered code fence', cc.status === 200 && /```/.test((json(cc.body).choices && json(cc.body).choices[0].message.content) || ''))
  } },
  { id: 'T4  single embed', tags: ['embed'], fn: async () => {
    const c = await req({ method: 'POST', path: '/api/embed', headers: H }, JSON.stringify({ apiKey: 'DEMOKEY', modelId: 'demo', input: 'hi' }))
    check('T4  single embed', c.status === 200 && (json(c.body).data || [])[0] && json(c.body).data[0].embedding.length === 1024)
  } },
  { id: 'T5  batch embed', tags: ['embed'], fn: async () => {
    const d = await req({ method: 'POST', path: '/api/embed-batch', headers: H }, JSON.stringify({ apiKey: 'DEMOKEY', modelId: 'demo', inputs: ['a', 'b', 'c'] }))
    const dj = json(d.body)
    check('T5  batch embed', d.status === 200 && (dj.embeddings || []).length === 3 && (dj.hashes || []).length === 3 && dj.embeddings[0].length === 1024)
  } },
  { id: 'T6  embed determinism', tags: ['embed'], fn: async () => {
    const e = JSON.stringify({ apiKey: 'DEMOKEY', modelId: 'demo', input: 'samevec' })
    const v1 = json((await req({ method: 'POST', path: '/api/embed', headers: H }, e)).body).data[0].embedding[0]
    const v2 = json((await req({ method: 'POST', path: '/api/embed', headers: H }, e)).body).data[0].embedding[0]
    check('T6  embed determinism', v1 === v2, 'v=' + v1)
  } },
  { id: 'T7  marker [[401]]', tags: ['errors'], fn: async () => {
    const e = await req({ method: 'POST', path: '/api/chat', headers: H }, chat('[[401]] hi', true))
    check('T7  marker [[401]]', e.status === 401)
  } },
  { id: 'T8  marker [[429]] retry', tags: ['errors', 'retry'], fn: async () => {
    const f1 = await req({ method: 'POST', path: '/api/chat', headers: H }, chat('[[429]] retry me', true))
    const f2 = await req({ method: 'POST', path: '/api/chat', headers: H }, chat('[[429]] retry me', true))
    check('T8  marker [[429]] retry', f1.status === 429 && f2.status === 200, f1.status + ' then ' + f2.status)
  } },
  { id: 'T9  marker [[filter]]', tags: ['errors'], fn: async () => {
    const g = await req({ method: 'POST', path: '/api/chat', headers: H }, chat('[[filter]] hi', true))
    check('T9  marker [[filter]]', g.status === 200 && /content_filter/.test(g.body))
  } },
  { id: 'T10 gate: no header -> 401', tags: ['gate'], fn: async () => {
    const h = await req({ method: 'POST', path: '/api/chat', headers: { 'content-type': 'application/json' } }, chat('hi', true))
    check('T10 gate: no header -> 401', h.status === 401)
  } },
  { id: 'T11 gate: wrong key -> 401', tags: ['gate'], fn: async () => {
    const i = await req({ method: 'POST', path: '/api/chat', headers: H }, JSON.stringify({ apiKey: 'WRONGKEY', modelId: 'demo', payload: { messages: [{ role: 'user', content: 'hi' }], stream: true } }))
    check('T11 gate: wrong key -> 401', i.status === 401)
  } },
  { id: 'T12 RAG lookup', tags: ['rag'], fn: async () => {
    const L = json((await req({ method: 'POST', path: '/api/embed-lookup', headers: H }, JSON.stringify({ hashes: ['abc', 'def', 'ghi'] }))).body)
    check('T12 RAG lookup', Array.isArray(L.vectors) && L.vectors.length === 3 && L.vectors.every(v => Array.isArray(v)) && L.vectors[0].length === 1024)
  } },
  { id: 'T13 evict no-op', tags: ['rag'], fn: async () => {
    const EV = json((await req({ method: 'POST', path: '/api/embed-evict', headers: H }, JSON.stringify({ hashes: ['abc'] }))).body)
    check('T13 evict no-op (cache guard)', EV.ok === true && EV.removed === 0)
  } },
  { id: 'T14 gc no-op', tags: ['rag'], fn: async () => {
    const GC = json((await req({ method: 'POST', path: '/api/embed-gc', headers: H }, '{}')).body)
    check('T14 gc no-op (cache guard)', GC.ok === true && GC.removed === 0)
  } },
  { id: 'T15 marker [[500]]', tags: ['errors'], fn: async () => {
    const r = await req({ method: 'POST', path: '/api/chat', headers: H }, chat('[[500]] boom', true))
    check('T15 marker [[500]]', r.status === 500 && /demo 500/.test(r.body))
  } },
  { id: 'T16 embed dim consistency', tags: ['embed', 'rag'], fn: async () => {
    const s = json((await req({ method: 'POST', path: '/api/embed', headers: H }, JSON.stringify({ apiKey: 'DEMOKEY', modelId: 'demo', input: 'x' }))).body).data[0].embedding.length
    const b = json((await req({ method: 'POST', path: '/api/embed-batch', headers: H }, JSON.stringify({ apiKey: 'DEMOKEY', modelId: 'demo', inputs: ['x'] }))).body).embeddings[0].length
    const l = json((await req({ method: 'POST', path: '/api/embed-lookup', headers: H }, JSON.stringify({ hashes: ['x'] }))).body).vectors[0].length
    check('T16 embed dim consistency', s === 1024 && b === 1024 && l === 1024, 'single=' + s + ' batch=' + b + ' lookup=' + l)
  } },
  { id: 'T17 reset stamp in future', tags: ['retry'], fn: async () => {
    const r = await req({ method: 'POST', path: '/api/chat', headers: H }, chat('[[429]] when', true))
    const m = (r.body.match(/Limit resets at:\s*([0-9 :T-]+?)\s*UTC/i) || [])[1]
    const ms = m ? Date.parse(m.replace(' ', 'T') + 'Z') : NaN
    check('T17 reset stamp in future', r.status === 429 && !isNaN(ms) && ms > Date.now() - 2000, 'reset=' + m)
  } },
  { id: 'T18 cache guard after batch', tags: ['rag'], fn: async () => {
    await req({ method: 'POST', path: '/api/embed-batch', headers: H }, JSON.stringify({ apiKey: 'DEMOKEY', modelId: 'demo', inputs: ['guard1', 'guard2'] }))
    const ev = json((await req({ method: 'POST', path: '/api/embed-evict', headers: H }, JSON.stringify({ hashes: ['guard1'] }))).body)
    const gc = json((await req({ method: 'POST', path: '/api/embed-gc', headers: H }, '{}')).body)
    check('T18 cache guard after batch', ev.removed === 0 && gc.removed === 0)
  } },
  { id: 'T19 edge embed input', tags: ['embed'], fn: async () => {
    const r = await req({ method: 'POST', path: '/api/embed', headers: H }, JSON.stringify({ apiKey: 'DEMOKEY', modelId: 'demo', input: '' }))
    const v = (json(r.body).data || [])[0]
    check('T19 edge embed input', r.status === 200 && !!v && v.embedding.length === 1024)
  } },
  { id: 'T20 [[slow]] cadence', tags: ['slow'], fn: async () => {
    const t0 = Date.now(); const s = await req({ method: 'POST', path: '/api/chat', headers: H }, chat('[[slow]] go', true)); const slow = Date.now() - t0
    const t1 = Date.now(); const f = await req({ method: 'POST', path: '/api/chat', headers: H }, chat('fast baseline', true)); const fast = Date.now() - t1
    check('T20 [[slow]] cadence', s.status === 200 && slow > fast * 2, 'slow=' + slow + 'ms fast=' + fast + 'ms')
  } },
  { id: 'T21 embed streamed progress', tags: ['embed'], fn: async () => {
    const inputs = Array.from({ length: 20 }, (_, k) => 'chunk number ' + k + ' lorem ipsum dolor')
    const r = await req({ method: 'POST', path: '/api/embed-batch', headers: H }, JSON.stringify({ apiKey: 'DEMOKEY', modelId: 'demo', inputs }))
    const prog = /"type":"progress"/.test(r.body)
    const pace = /"type":"pacing"/.test(r.body)
    const doneLine = (r.body.split('\n').find(l => /"type":"done"/.test(l)) || '').replace(/^data:\s*/, '')
    const dj = json(doneLine)
    check('T21 embed streamed progress', r.status === 200 && prog && pace && (dj.embeddings || []).length === 20 && dj.embeddings[0].length === 1024, 'progress=' + prog + ' pacing=' + pace)
  } },
  { id: 'T22 [[embedfail]] then retry', tags: ['embed', 'retry'], fn: async () => {
    const payload = JSON.stringify({ apiKey: 'DEMOKEY', modelId: 'demo', inputs: ['[[embedfail]] resume me please'] })
    const a = await req({ method: 'POST', path: '/api/embed-batch', headers: H }, payload)
    const b = await req({ method: 'POST', path: '/api/embed-batch', headers: H }, payload)
    const bj = json(b.body)
    check('T22 [[embedfail]] then retry', /"type":"error"/.test(a.body) && b.status === 200 && (bj.embeddings || []).length === 1, 'firstErr=' + /"type":"error"/.test(a.body) + ' retry=' + b.status)
  } },
  { id: 'T23 budget meter + decrement', tags: ['embed', 'rag'], fn: async () => {
    const g = () => req({ method: 'GET', path: '/api/ratelimit', headers: H })
    const r1 = json((await g()).body)
    await req({ method: 'POST', path: '/api/embed-batch', headers: H }, JSON.stringify({ apiKey: 'DEMOKEY', modelId: 'demo', inputs: Array.from({ length: 12 }, (_, k) => 'budget chunk ' + k + ' lorem ipsum dolor sit amet consectetur') }))
    const r2 = json((await g()).body)
    check('T23 budget meter + decrement', r1.tokLimit === 200000 && typeof r2.tokRemaining === 'number' && r2.tokRemaining < r1.tokRemaining, 'rem ' + r1.tokRemaining + ' -> ' + r2.tokRemaining)
  } },
  { id: 'T24 embed hard cap', tags: ['embed'], fn: async () => {
    const big = 'x'.repeat(60000)                        // ~15k tokens each
    const inputs = Array.from({ length: 16 }, () => big)  // ~960k chars => ~240k tokens > 180k fallback cap
    const r = await req({ method: 'POST', path: '/api/embed-batch', headers: H }, JSON.stringify({ apiKey: 'DEMOKEY', modelId: 'demo', inputs }))
    const j = json(r.body)
    check('T24 embed hard cap', r.status === 413 && /exceeds the token cap/i.test(j.error || ''), 'status=' + r.status)
  } },
]

// --- runner -----------------------------------------------------------------
const ALL_GROUPS = ['chat', 'embed', 'rag', 'errors', 'retry', 'gate', 'slow']
const GROUPS = process.argv.slice(2).map(s => s.toLowerCase()).filter(s => ALL_GROUPS.includes(s))
// Default run (no args) = everything EXCEPT 'slow' (the long timing test is opt-in;
// run it with `node test/demo-api.test.js slow`).
const want = tags => GROUPS.length === 0 ? !tags.includes('slow') : tags.some(t => GROUPS.includes(t))

;(async () => {
  await new Promise(r => setTimeout(r, 800))   // let the socket bind
  const label = GROUPS.length ? GROUPS.join(',') : 'all'
  console.log('Running demo-api tests  [groups: ' + label + ']\n')
  let ran = 0
  for (const c of CASES) if (want(c.tags)) { ran++; await c.fn() }
  if (!ran) console.log('(no cases matched — valid groups: ' + ALL_GROUPS.join(', ') + ')')
  console.log('\n' + pass + '/' + (pass + fail) + ' passed  (' + ran + ' cases, groups: ' + label + ')')
  process.exit(fail ? 1 : 0)
})()
