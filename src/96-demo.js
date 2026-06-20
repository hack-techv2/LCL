// =============================================================================
// Demo mode (#demo) — renders the UI with seeded sample content WITHOUT
// connecting or calling the API. Exercises every output + interaction path so
// the app can be eyeballed and dynamically tested via Claude in Chrome.
// Open  http://localhost:3000/#demo  (a full reload, not just adding the hash).
//
// TEST / USE CASES COVERED
//   Chat list .... Pinned section, Today / Yesterday / Older date grouping,
//                  active-chat highlight, message counts, switching chats.
//   User msgs .... plain, multi-paragraph, with-attachment (expandable chip).
//   AI markdown .. headings, bold/italic/strike, inline code, links, blockquote,
//                  ordered/unordered/nested lists, table, hr, fenced code blocks.
//   AI extras .... RAG source tags; classification suffix in the welcome line.
//   Transient .... loading dots, 5xx retry box, 429 rate-limit box.
//   Terminal ..... non-retryable error as a plain assistant message (how the
//                  app actually persists it).
//   Composer ..... plain "Message LCL…" placeholder in an existing chat.
//   Settings ..... data-classification picker (light/dark contrast), Updates.
//
// Safe: persist() is a no-op while #demo is active, so nothing is written to
// lcl_data.json. STRIP src/96-demo.js + the maybeDemo() guard in init() before
// promoting alpha -> stable.
// =============================================================================
function demoOn() {
  try { return (location.hash || '').toLowerCase() === '#demo' } catch { return false }
}

const DEMO_AI_MARKDOWN = [
  '# Heading 1',
  '## Heading 2',
  '### Heading 3',
  '',
  'This reply demonstrates **bold**, *italic*, ~~strikethrough~~, and `inline code`, plus a [link](https://platform.ai.tech.gov.sg).',
  '',
  '> A blockquote, for when the model wants to emphasise something.',
  '',
  'Unordered list:',
  '- First item',
  '- Second item',
  '  - Nested item A',
  '  - Nested item B',
  '',
  'Ordered list:',
  '1. Step one',
  '2. Step two',
  '3. Step three',
  '',
  '| Model | Tier | Notes |',
  '|---|---|---|',
  '| cce.claude-opus-4-6 | CCE/SN | default |',
  '| gpt-5.5 | R/SN | OpenAI |',
  '| gemini-2.5-pro | R/SN | Google |',
  '',
  '---',
  '',
  'A fenced code block:',
  '',
  '```js',
  'function greet(name) {',
  '  return `hello, ${name}`',
  '}',
  '```'
].join('\n')

const DEMO_AI_CODE = [
  'Here are the same idea in three languages:',
  '',
  '```python',
  'def greet(name):',
  '    return f"hello, {name}"',
  '```',
  '',
  '```bash',
  'echo "hello, $1"',
  '```',
  '',
  'And a longer paragraph to check wrapping and line-height across multiple lines of prose so the spacing between the body text and the action row can be eyeballed at a realistic length.'
].join('\n')

// Build a seeded chat. ts is the created/updated time and drives date grouping.
function demoChat(id, title, ts, pinned, messages) {
  messages.forEach((m, i) => { if (m.ts == null) m.ts = ts - (messages.length - i) * 60000 })
  return { id, title, pinned: !!pinned, createdAt: ts, updatedAt: ts, docs: [], messages }
}

// Called at the top of init(); returns true if it took over the boot so init()
// skips all network work.
// Toggling the #demo hash on an already-loaded page only changes the fragment —
// the browser doesn't reload, so init()/maybeDemo() never re-run. Reload when we
// cross the demo boundary so entering or leaving #demo actually (de)activates it.
;(function () {
  let wasDemo = location.hash === '#demo'
  window.addEventListener('hashchange', () => {
    const isDemo = location.hash === '#demo'
    if (isDemo !== wasDemo) { wasDemo = isDemo; location.reload() }
  })
})()

let _demoStreamSeq = 0   // bumped on Reset demo to cancel an in-flight demo stream
function maybeDemo() {
  if (!demoOn()) return false

  // Reset transient runtime state so a mid-action "Reset demo" starts clean:
  _demoStreamSeq++                       // supersede any in-flight demo stream (its tick aborts)
  busy = false; inflightCtl = null       // un-stick the composer / Stop button
  try { const _mi = document.getElementById('msg-in'); if (_mi) { _mi.value = ''; if (typeof autoResize === 'function') autoResize(_mi) } } catch {}
  if (typeof closeUpdateDialog === 'function') closeUpdateDialog()   // drop a stale update modal
  if (typeof closeSearch === 'function') closeSearch()              // close search overlay
  try { document.getElementById('modal-bd')?.classList.add('hidden') } catch {}  // close connect modal

  // Fake embed creds so the Embed panel reads as configured (green dot, no
  // "set embed key" banner) and upload->embed works via the mock — no real key.
  creds = { apiKey: 'demo', model: 'cce.claude-opus-4-6', maxTokens: 8192,
            systemPrompt: '', chunkSize: 800, topK: 5,
            embedApiKey: 'demo', embedModelId: 'cohere.embed-english-v3', classification: 'cce' }
  setHealth('ok', 'Demo')
  try { document.body.classList.remove('not-connected') } catch {}
  try { document.getElementById('connect-banner')?.classList.add('hidden') } catch {}

  skillsCache = [
    { id: 'pentest-report', title: 'Pentest Report Writer', bytes: 1840, mtime: Date.now(),
      body: '# Pentest Report Writer\n\nYou write clear penetration-test reports. For each finding include: title, severity (CVSS), affected asset, description, evidence, and remediation. Keep an executive summary at the top in plain language.' },
    { id: 'secure-code-review', title: 'Secure Code Reviewer', bytes: 2312, mtime: Date.now(),
      body: '# Secure Code Reviewer\n\nReview code for security issues (injection, authn/z, secrets, unsafe deserialisation, SSRF). Cite the line, explain the risk, and suggest a concrete fix. Flag false positives honestly.' },
    { id: 'exec-summary', title: 'Executive Summary', bytes: 964, mtime: Date.now(),
      body: '# Executive Summary\n\nSummarise technical content for a non-technical executive in <= 5 bullet points: what, impact, risk, recommendation, next step. No jargon.' }
  ]

  const now = Date.now(), hr = 3600000, day = 86400000
  const mid = new Date(); mid.setHours(0, 0, 0, 0); const m0 = mid.getTime()

  D.chats = {}
  // Active (today) — the rich output showcase.
  D.chats['demo_active'] = demoChat('demo_active', 'Demo - all output cases', now - 5 * 60000, false, [
    { role: 'user', content: 'hello how are you' },
    { role: 'assistant', content: DEMO_AI_MARKDOWN },
    { role: 'user', content: 'Please summarise the attached report.\n<file name="quarterly-report.pdf">Q2 revenue rose 12% QoQ driven by cloud. Headcount flat. Two risks flagged: supply chain and FX exposure.</file>', fileNames: ['quarterly-report.pdf'] },
    { role: 'assistant', content: 'Based on the attached document, Q2 revenue grew **12% quarter-on-quarter**, led by cloud. Headcount was flat, and two risks were flagged: supply chain and FX exposure.', sources: ['quarterly-report.pdf'] },
    { role: 'user', content: 'Can you walk me through the trade-offs?\n\nI care about latency, cost, and data classification. We are on Comet, behind Zscaler, and most of our traffic is Sensitive Normal with the occasional Confidential Cloud Eligible workload. Keep it concise.' },
    { role: 'assistant', content: DEMO_AI_CODE }
  ])
  // Pinned — appears in the Pinned section regardless of date.
  D.chats['demo_pinned'] = demoChat('demo_pinned', 'Overlord TTP - payload notes', m0 - 2 * day + 14 * hr, true, [
    { role: 'user', content: 'Draft a short note on staged vs stageless payloads.' },
    { role: 'assistant', content: 'Staged payloads fetch the bulk of their code at runtime (smaller initial footprint, needs callback); stageless bundle everything up front (larger, but self-contained and more reliable on egress-restricted hosts).' }
  ])
  // Yesterday.
  D.chats['demo_yest'] = demoChat('demo_yest', 'EMC firmware analysis', m0 - 12 * hr, false, [
    { role: 'user', content: 'What should I look for in an MQTT broker config review?' },
    { role: 'assistant', content: 'Check for anonymous access, TLS enforcement, ACL scoping per topic, and whether credentials are reused across devices.' }
  ])
  // Older (≈12 days ago).
  D.chats['demo_old'] = demoChat('demo_old', 'PUB pentest scoping call', m0 - 12 * day - 12 * hr, false, [
    { role: 'user', content: 'Summarise the scoping call action items.' },
    { role: 'assistant', content: 'Three action items: confirm in-scope IP ranges, get a test window sign-off, and set up a shared evidence folder before kickoff.' }
  ])

  D.chats['demo_active'].skillId = 'pentest-report'
  D.chats['demo_active'].docs = [{
    id: 'demo_doc1', name: 'quarterly-report.pdf', size: 184320,
    content: 'Q2 revenue rose 12% QoQ driven by cloud. Headcount flat. Two risks flagged: supply chain and FX exposure.',
    chunks: [
      { text: 'Q2 revenue rose 12% QoQ driven by cloud.', embHash: 'demo0' },
      { text: 'Two risks flagged: supply chain and FX exposure.', embHash: 'demo1' }
    ], status: 'ready', addedAt: now
  }, {
    id: 'demo_doc2', name: 'policy-handbook.docx', size: 96000,
    content: '', chunks: [], status: 'embedding', addedAt: now
  }, {
    id: 'demo_doc3', name: 'scanned-invoice.pdf', size: 421000,
    content: '', chunks: [], status: 'error', addedAt: now
  }]
  chatId = 'demo_active'
  if (typeof renderAll === 'function') renderAll()

  // --- Transient UI states — rendered exactly like the real handlers (real
  // header + time via appendTyping/appendMsg; box bodies copied verbatim from
  // handle5xxRetry / handleRateLimitWait). Nothing here is fabricated.
  // (a) loading / typing indicator
  if (typeof appendTyping === 'function') appendTyping()

  const statusBubble = (boxHtml) => {
    const b = appendMsg('ai', '', null, null, null)
    const body = b.querySelector('.msg-body'); if (body) body.innerHTML = boxHtml
    const acts = b.querySelector('.msg-acts'); if (acts) acts.style.display = 'none'
  }

  // (b) 5xx auto-retry box (verbatim from handle5xxRetry)
  statusBubble(statusBox('err', 'Error 502: Bad gateway',
    '<div style="margin-bottom:4px">The AI service is temporarily unavailable.</div>'
    + '<div>Retrying in: <strong style="color:var(--ac);font-family:var(--mono);font-size:13px">10s</strong>&nbsp;<span style="font-size:11px;opacity:.7">(attempt 1 of 3)</span></div>',
    { icon: 'err', cancel: 'cancelRateLimitRetry()' }))

  // (c) 429 rate-limit box (verbatim from handleRateLimitWait)
  statusBubble(statusBox('warn', 'Error 429: Rate limit reached',
    '<div>Resets at:&nbsp; <strong style="color:var(--tx);font-family:var(--mono)">Fri, 20 Jun 2026, 03:55:00 AM (Asia/Singapore)</strong></div>'
    + '<div>Retrying in: <strong style="color:var(--ac);font-family:var(--mono);font-size:13px">00:42</strong></div>',
    { icon: 'clock', cancel: 'cancelRateLimitRetry()' }))

  // (d) terminal (non-retryable) 4xx — exactly what the JS emits: 'Error <code>: '
  // + the cleaned upstream message (no extra hint). 4xx does not auto-retry.
  appendMsg('ai', 'Error 401: Invalid API key.', null, null, null, true)

  // Floating "Reset demo" button (demo only) — re-seeds everything.
  if (!document.getElementById('demo-reset')) {
    const rb = document.createElement('button')
    rb.id = 'demo-reset'; rb.type = 'button'
    rb.innerHTML = '\u21BA Reset demo'
    rb.onclick = function () { maybeDemo() }
    document.body.appendChild(rb)
  }
  if (!document.getElementById('demo-more')) {
    const mb = document.createElement('button')
    mb.id = 'demo-more'; mb.type = 'button'
    mb.innerHTML = '+ Many chats'
    mb.onclick = function () { demoSeedMany(18) }
    document.body.appendChild(mb)
  }

  // Demo: show the "update available" state so the update UI is visible.
  // Demo pretends you're one version behind so the upgrade panel shows a real
  // pending update (installed v0.67c -> latest v0.67d).
  if (typeof relockDemoAlpha === 'function') relockDemoAlpha()  // Reset demo re-locks the easter-egg channel
  const _vb = document.getElementById('ver-badge'); if (_vb) _vb.textContent = 'v0.67c'
  lclUpdate = { checked:true, channel:'stable', current:'0.67c', latest:'0.67d', tag:'v0.67d',
                newer:true, notes:'### v0.67d\n\n- Card-based settings\n- Token presets + editable RAG sliders\n- Condensed updates panel\n- Comet easter egg', html_url:'',
                error:null, ref:'alpha', inSync:true, changed:[], hash:'' }
  if (typeof renderUpdateBadge === 'function') renderUpdateBadge()
  if (typeof renderUpdateSettings === 'function') renderUpdateSettings()
  // If the Settings panel is open, repopulate its fields from the reset creds.
  try { const _sp = document.getElementById('sp'); if (_sp && !_sp.classList.contains('hidden') && typeof openSP === 'function') openSP() } catch {}

  return true
}

// Compact mock responder for #demo: echoes the user turn and replies with a
// random canned answer (some markdown) after a short typing delay. No API.
const DEMO_REPLIES = [
  'Sure — here is a quick take:\n\n- One point worth noting\n- A second consideration\n\nWant me to go deeper on any of these?',
  'Good question. In short: **yes**, with a caveat — the trade-off is latency vs cost, so it depends on your workload.',
  'Here is a small example:\n\n```js\nconst total = items.reduce((n, x) => n + x.value, 0)\n```\n\nLet me know if you want it in another language.',
  'I would approach it in three steps:\n\n1. Clarify the requirement\n2. Draft a minimal version\n3. Iterate with feedback',
  'That should work. One thing to watch: make sure the data classification matches the model tier you have selected.'
]

function demoSend(text, input) {
  const chat = curChat(); if (!chat) return
  if (!chat.messages.length) chat.title = text.slice(0, 42) + (text.length > 42 ? '...' : '')
  chat.messages.push({ role: 'user', content: text, ts: Date.now() })
  chat.updatedAt = Date.now()
  input.value = ''; if (typeof autoResize === 'function') autoResize(input)
  const emptyEl = document.getElementById('empty'); if (emptyEl) emptyEl.classList.add('hidden')
  appendMsg('user', text, null, null, [])
  demoStream(chat)
}

// Faithful offline copy of runStream's UX: typing indicator -> busy + Stop
// button -> token-by-token reply -> Stop/Regenerate/Edit all work. inflightCtl
// is a stub so the real stopStreaming() can cancel the demo stream.
function demoStream(chat) {
  const seq = ++_demoStreamSeq
  const typingEl = appendTyping()
  busy = true; if (typeof updateSendBtn === 'function') updateSendBtn()
  if (typeof setHealth === 'function') setHealth('warn', 'Thinking')
  let stopped = false
  inflightCtl = { abort() { stopped = true } }
  const reply = DEMO_REPLIES[Math.floor(Math.random() * DEMO_REPLIES.length)]
  const tokens = reply.match(/\S+\s*/g) || [reply]
  let i = 0, acc = '', msgObj = null, bubble = null
  const swap = () => {
    try { typingEl.remove() } catch {}
    msgObj = { role: 'assistant', content: '', ts: Date.now() }
    chat.messages.push(msgObj)
    bubble = appendMsg('ai', '', null, null)
  }
  const done = (wasStopped) => {
    busy = false; inflightCtl = null; if (typeof updateSendBtn === 'function') updateSendBtn()
    if (wasStopped) {
      if (!msgObj) { try { typingEl.remove() } catch {}; chat.messages.push({ role:'assistant', content:'(stopped)', ts:Date.now(), stopped:true }); appendMsg('ai', '(stopped)', null, null) }
      else { msgObj.stopped = true; msgObj.content = acc + (acc ? '\n\n' : '') + '(stopped)'; const b = bubble.querySelector('.msg-body'); if (b) b.innerHTML = fmt(msgObj.content) }
      if (typeof setHealth === 'function') setHealth('ok', 'Stopped')
    } else if (typeof setHealth === 'function') setHealth('ok', 'Demo')
    chat.updatedAt = Date.now(); if (typeof renderChatList === 'function') renderChatList()
  }
  const tick = () => {
    if (seq !== _demoStreamSeq) return   // superseded by Reset demo / a newer stream
    if (stopped) { done(true); return }
    if (!msgObj) swap()
    if (i < tokens.length) {
      acc += tokens[i++]; msgObj.content = acc; bubble.dataset.raw = acc
      const b = bubble.querySelector('.msg-body'); if (b) b.innerHTML = fmt(acc)
      const m = document.getElementById('messages'); if (m) m.scrollTop = m.scrollHeight
      setTimeout(tick, 38)
    } else { done(false) }
  }
  setTimeout(tick, 350)
}

// Derive a skill title from its body (first markdown H1) or its id slug. Used by
// the in-memory skill CRUD under #demo so saving/uploading behaves like normal.
function demoSkillTitle(body, id) {
  const h1 = (String(body || '').match(/^#\s+(.+)$/m) || [])[1]
  if (h1) return h1.trim().slice(0, 60)
  return String(id || '').split('-').map(w => w ? w[0].toUpperCase() + w.slice(1) : '').join(' ')
}

// Demo limits — keep the in-memory demo lightweight. Files (embed docs +
// per-message attachments) are capped by size AND count; skills are read-only
// in demo (creation/upload blocked above), so they're capped at the seeded set.
const DEMO_MAX_FILE_BYTES = 1024 * 1024   // 1 MB per file
const DEMO_MAX_DOCS = 3                    // max embedded docs per chat
const DEMO_MAX_ATTACH = 3                  // max per-message attachments
function demoCapFiles(files, target) {
  const okSize = files.filter(f => {
    if (f.size > DEMO_MAX_FILE_BYTES) {
      if (typeof toast === 'function') toast(f.name + ' skipped — demo limit is 1 MB per file', 'err')
      return false
    }
    return true
  })
  const cur = (target === 'docs') ? ((curChat() && curChat().docs || []).length) : (attachments.length)
  const cap = (target === 'docs') ? DEMO_MAX_DOCS : DEMO_MAX_ATTACH
  const room = Math.max(0, cap - cur)
  if (okSize.length > room && typeof toast === 'function') {
    toast('Demo limit: max ' + cap + (target === 'docs' ? ' embedded files' : ' attachments'), 'info')
  }
  return okSize.slice(0, room)
}

// Demo helper: bulk-spawn sample chats (in-memory) to stress-test a long list —
// date-spread so Today / Yesterday / Previous 7 days / Older grouping all show.
const DEMO_BULK_TITLES = [
  'SQLmap run notes','Firewall rule review','Phishing sim debrief','AD enumeration',
  'S3 bucket audit','JWT token analysis','Burp macro setup','Nmap sweep — /24',
  'OSINT — exec profiles','Wireless survey','Container escape PoC','CI/CD secrets scan',
  'DNS exfil test','Privilege escalation path','SIEM alert triage','API fuzzing session',
  'Threat model — payments','Red team retro','Mobile app teardown','Kerberoasting notes'
]
function demoSeedMany(n) {
  n = n || 18
  const now = Date.now(), day = 86400000
  for (let i = 0; i < n; i++) {
    const base = DEMO_BULK_TITLES[i % DEMO_BULK_TITLES.length]
    const title = base + (i >= DEMO_BULK_TITLES.length ? ' ' + (Math.floor(i / DEMO_BULK_TITLES.length) + 1) : '')
    const ts = now - Math.floor(Math.random() * 14 * day)
    const id = 'demo_bulk_' + ts + '_' + i
    D.chats[id] = { id, title, pinned: false, createdAt: ts, updatedAt: ts, docs: [], messages: [
      { role: 'user', content: title + '?', ts: ts - 60000 },
      { role: 'assistant', content: 'Noted — quick rundown on ' + base.toLowerCase() + '.', ts: ts - 30000 }
    ] }
  }
  if (typeof renderAll === 'function') renderAll()
  if (typeof toast === 'function') toast('Added ' + n + ' demo chats', 'ok')
}

