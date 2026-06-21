// =============================================================================
// Send
// =============================================================================
// Resolves the system prompt for a chat: skill body if chat.skillId is set,
// otherwise the global creds.systemPrompt. Returns { sys, error }. On a
// missing/unreadable skill, returns { sys: null, error: '...' } so the caller
// can block the send and surface the error.
async function resolveSystemPrompt(chat) {
  if (!chat || !chat.skillId) return { sys: creds.systemPrompt || '', error: null }
  // #demo: seeded skills live only in the in-memory skillsCache (not on the
  // server's disk), so resolve the body from there — a /skills/:id fetch 404s.
  if (typeof demoOn === 'function' && demoOn()) {
    const sk = (typeof skillsCache !== 'undefined' ? skillsCache : []).find(s => s.id === chat.skillId)
    return sk ? { sys: sk.body || '', error: null } : { sys: null, error: 'Skill "' + chat.skillId + '" not found' }
  }
  try {
    const r = await httpGet('/skills/' + encodeURIComponent(chat.skillId))
    if (r.status === 404) return { sys: null, error: 'Skill "' + chat.skillId + '" not found' }
    if (!r.ok) return { sys: null, error: 'Skill "' + chat.skillId + '" failed to load (HTTP ' + r.status + ')' }
    const data = await r.json()
    return { sys: data.body || '', error: null }
  } catch (e) {
    return { sys: null, error: 'Skill "' + chat.skillId + '" load error: ' + e.message }
  }
}

async function loadSkillsList() {
  if (typeof demoOn === 'function' && demoOn()) return  // keep seeded demo skills
  try {
    const r = await httpGet('/skills')
    if (!r.ok) { skillsCache = []; return }
    const data = await r.json()
    skillsCache = Array.isArray(data.skills) ? data.skills : []
  } catch {
    skillsCache = []
  }
}

function renderSkillPicker() {
  const root = document.getElementById('sb-skills')
  if (!root) return
  const chat = curChat()
  const current = chat?.skillId || null

  let html = '<div class="sb-skills-hd"><span class="sb-skills-hd-lbl">Skills</span></div>'

  if (!skillsCache.length) {
    html += '<div class="sb-skill-empty">No skills yet</div>'
  } else {
    for (const s of skillsCache) {
      const active = (s.id === current) ? ' active' : ''
      html += `<div class="sb-skill-item${active}" data-id="${esc(s.id)}" onclick="onSkillPicked('${esc(s.id)}')" title="${esc(s.id)}">
        <span class="sb-skill-dot"></span>
        <span class="sb-skill-name">${esc(s.title)}</span>
      </div>`
    }
    if (current && !skillsCache.some(s => s.id === current)) {
      html += `<div class="sb-skill-item active" data-id="${esc(current)}" title="missing skill">
        <span class="sb-skill-dot"></span>
        <span class="sb-skill-name">(missing) ${esc(current)}</span>
      </div>`
    }
  }

  // "Manage skills" now lives in the 2-column sb-bot row next to Settings.
  root.innerHTML = html
}

function onSkillPicked(id) {
  const chat = curChat()
  if (!chat) return
  // Toggle: clicking the active skill clears it.
  const next = (chat.skillId === id) ? null : (id || null)
  chat.skillId = next
  chat.updatedAt = Date.now()
  persist()
  renderSkillPicker()
  renderSkillChip()
}

function renderSkillChip() {
  const el = document.getElementById('skill-chip')
  if (!el) return
  const chat = curChat()
  const id = chat?.skillId
  if (!id) { el.className = 'skill-chip'; el.textContent = ''; return }
  el.className = 'skill-chip show'
  const sk = skillsCache.find(s => s.id === id)
  el.textContent = 'Skill: ' + (sk ? sk.title : id)
}

// Build the message content for the API. With no attachments, send the plain
// text string. With attachments, return an array of text blocks: the typed
// message first, then each attached file's extracted text labelled by name.
function buildContent(text) {
  if (!attachments.length) return text
  const blocks = [{ type: 'text', text }]
  for (const a of attachments) {
    blocks.push({ type: 'text', text: '\n\n--- ' + a.name + ' ---\n' + (a.textContent || '') })
  }
  return blocks
}

// Shared by send() and regenerateLast(): builds the chat API payload for
// `queryText` from the chat's ready docs (FULL text when they fit the budget,
// else RAG chunk-retrieval) plus the resolved skill/system prompt. Returns
// { payload, ragSources }, or { skillErr } when the chat's skill won't load.
async function buildPayload(chat, queryText) {
  let ragChunks=[], ragSources=[], fullDocText=''
  const readyDocs   = (chat.docs||[]).filter(d=>d.status==='ready')
  const docsForFull = readyDocs.filter(d=>d.content)
  const totalChars  = docsForFull.reduce((n,d)=>n+d.content.length,0)
  const fullLimit   = creds.docFullTextLimit || CFG.DOC_FULLTEXT_LIMIT
  const useFullText = docsForFull.length>0 && totalChars<=fullLimit
  if (useFullText) {
    fullDocText = docsForFull.map(d=>'--- '+d.name+' ---\n'+d.content).join('\n\n')
    ragSources  = docsForFull.map(d=>d.name)
  } else if (readyDocs.some(d=>d.chunks?.length)) {
    try {
      ragChunks = await retrieveChunks(queryText, chat.docs, creds.topK||10, ragStickyChunks)
      ragSources = [...new Set(ragChunks.map(c=>c.docName))]
      ragStickyChunks = ragChunks.slice(0, Math.max(1, Math.floor((creds.topK||10) * CFG.STICKY_CHUNK_RATIO)))
    }
    catch(e) { console.warn('RAG:',e.message) }
  }
  const { sys: sysBase, error: skillErr } = await resolveSystemPrompt(chat)
  if (skillErr) return { skillErr }
  let sys = sysBase
  if (fullDocText) {
    sys = 'The following document(s) are provided IN FULL. Use them to answer the user.\n\n'+fullDocText+(sys?'\n\n'+sys:'')
  } else if (ragChunks.length) {
    const ctx = ragChunks.map((c,i)=>`[${i+1}] (${c.docName})\n${c.text}`).join('\n\n')
    sys = 'Use the following document excerpts to answer. If the answer is not in them, say so.\n\n'+ctx+(sys?'\n\n'+sys:'')
  }
  const baseMessages = chat.messages.map(m=>({role:m.role,content:m.content}))
  const msgs = sys ? [{ role:'system', content:sys }, ...baseMessages] : baseMessages
  return { payload: { messages:msgs, max_tokens:creds.maxTokens||CFG.DEFAULT_MAX_TOKENS }, ragSources }
}

async function send() {
  if (!creds) { openConnect(); return }
  const input = document.getElementById('msg-in')
  const text  = input.value.trim()
  if (!text||busy||!chatId) return

  // If a 429 retry was pending from a previous send, cancel it. The user
  // is starting fresh; the old payload shouldn't auto-fire later.
  if (pendingRetry) { pendingRetry.cancel(); pendingRetry = null }

  const chat = curChat(); if (!chat) return

  // Claim the busy lock NOW — before any await — so a second send can't slip in
  // during retrieveChunks()/resolveSystemPrompt() and orphan the inflight stream.
  // runStream() also sets busy=true (idempotent). Reset on any early bail below.
  busy = true
  if (typeof updateSendBtn === 'function') updateSendBtn()

  try {

  // auto-title after first message
  if (!chat.messages.length) {
    chat.title = text.slice(0,42)+(text.length>42?'...':'')
  }

  const sentFileNames = attachments.map(a=>a.name)
  const content = buildContent(text)
  chat.messages.push({role:'user',content,ts:Date.now(),fileNames:sentFileNames})
  chat.updatedAt = Date.now()
  input.value=''; autoResize(input)
  attachments=[]; renderChips()

  const emptyEl = document.getElementById('empty'); if (emptyEl) emptyEl.classList.add('hidden')
  const disp = typeof content==='string'?content:content.find(b=>b.type==='text')?.text||'[attachment]'
  appendMsg('user', disp, null, null, sentFileNames)

  const built = await buildPayload(chat, text)
  if (built.skillErr) {
    chat.messages.pop()
    chat.updatedAt = Date.now()
    renderMessages()
    toast(built.skillErr, 'err')
    busy = false
    if (typeof updateSendBtn === 'function') updateSendBtn()
    return
  }
  const { payload, ragSources } = built

  await runStream(chat, payload, ragSources)

  } catch (e) {
    // Bailing out before/around runStream — release the busy lock so the UI
    // doesn't get stuck with Send disabled and Stop showing.
    busy = false
    if (typeof updateSendBtn === 'function') updateSendBtn()
    throw e
  }
}

// Core send loop. Streams from /api/chat (stream:true) and writes tokens into
// the message bubble live as they arrive. The previous non-streaming code path
// is gone — auto-title and any other utility calls explicitly send stream:false
// in their own payload and hit the buffered path on the server.

// ---------------------------------------------------------------------------
// merged from 51-chat-stream.js
// ---------------------------------------------------------------------------

async function runStream(chat, payload, ragSources) {
  payload.stream = true   // enable server-side streaming proxy

  const typingEl = appendTyping()
  busy = true
  updateSendBtn()
  setHealth('warn', 'Thinking')

  inflightCtl = new AbortController()
  let stopped = false
  let filtered = false
  let truncated = false
  let firstToken = false
  let accumulated = ''
  let bubble = null
  let msgObj = null
  let streamErr = null

  const swapBubble = () => {
    if (firstToken) return
    firstToken = true
    try { typingEl.remove() } catch {}
    msgObj = { role:'assistant', content:'', sources: ragSources, ts: Date.now() }
    chat.messages.push(msgObj)
    bubble = appendMsg('ai', '', null, ragSources)
  }

  try {
    const resp = await httpPost('/api/chat',
      { apiKey: creds.apiKey, modelId: creds.model, streamTimeoutMs: RETRY_STEPS_MS[Math.min(retry5xxCount, 2)], payload },
      { signal: inflightCtl.signal })

    // Non-200 responses from our proxy are JSON, not SSE.
    if (!resp.ok) {
      let errData = {}
      try { errData = JSON.parse(await resp.text()) } catch {}
      try { typingEl.remove() } catch {}

      // 429 rate-limit: parse the "Limit resets at: YYYY-MM-DD HH:MM:SS UTC"
      // marker, convert to local time, show a countdown, and auto-retry
      // when it expires. Hand off to handleRateLimitWait and exit early.
      if (resp.status === 429) {
        const em = errData?.error?.message || ''
        const m = em.match(/Limit resets at:\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})\s*UTC/i)
        if (m) {
          const resetMs = Date.parse(m[1].replace(' ', 'T') + 'Z')
          if (!isNaN(resetMs) && resetMs > Date.now()) {
            handleRateLimitWait(chat, payload, ragSources, resetMs, em)
            return
          }
        }
      }

      // Any 5xx is transient — auto-retry with backoff (up to 3 times). 429 is
      // handled above (quota wait); everything else falls through to a clean box.
      if (resp.status >= 500 && resp.status < 600 && retry5xxCount < 3) {
        const em5 = errData?.error?.message || errData?.error || ('HTTP '+resp.status)
        handle5xxRetry(chat, payload, ragSources, resp.status, em5)
        return
      }
      retry5xxCount = 0
      const labels = { 500:'Server error', 502:'Bad gateway', 503:'Service unavailable', 504:'Gateway timeout' }
      const note = labels[resp.status]
        ? ('Error ' + resp.status + ': ' + labels[resp.status] + ' — The model service is temporarily unreachable. Please try again in a moment.')
        : ('Error ' + resp.status + ': ' + cleanErrMsg(errData?.error?.message || errData?.error || ('HTTP ' + resp.status)))
      chat.messages.push({ role:'assistant', content: note, ts:Date.now(), errored:true })
      appendMsg('ai', note, null, ragSources, null, true)
      setHealth('err', labels[resp.status] ? 'Service unavailable' : ('Error ' + resp.status))
      return
    }
    if (!resp.body) throw new Error('No response body for streaming')

    const msgsEl = document.getElementById('messages')

    // SSE consumption is shared (streamSse, 12-transport). Each "data:" payload is
    // one event; abort is reported via res.stopped (keeps the (stopped) wrap-up).
    const res = await streamSse(resp, data => {
      if (data === '[DONE]') return

      let evt
      try { evt = JSON.parse(data) } catch { return }

      if (evt.error) {
        streamErr = evt.error?.message || evt.error
        return
      }

      const choice = evt.choices?.[0]
      if (!choice) return
      const delta = choice.delta?.content || ''

      if (delta || choice.finish_reason) swapBubble()

      if (delta && msgObj && bubble) {
        accumulated += delta
        msgObj.content = accumulated
        bubble.dataset.raw = accumulated     // keep Copy-able raw markdown in sync
        const bodyEl = bubble.querySelector('.msg-body')
        if (bodyEl) bodyEl.innerHTML = fmt(accumulated)
        if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight
      }
      if (choice.finish_reason === 'content_filter') filtered = true
      if (choice.finish_reason === 'length') truncated = true
    }, { aborted: () => inflightCtl?.signal?.aborted })
    if (res.stopped) stopped = true

    // Wrap-up: handle stop / error / success states
    if (stopped) {
      if (msgObj) {
        msgObj.stopped = true
        msgObj.content = accumulated + (accumulated ? '\n\n' : '') + '(stopped)'
        if (bubble) {
          const bodyEl = bubble.querySelector('.msg-body')
          if (bodyEl) bodyEl.innerHTML = fmt(msgObj.content)
        }
      } else {
        try { typingEl.remove() } catch {}
        chat.messages.push({ role:'assistant', content:'(stopped)', ts:Date.now(), stopped:true })
        appendMsg('ai', '(stopped)', null, ragSources)
      }
      setHealth('ok', 'Stopped')
      return
    }
    if (streamErr && !msgObj) {
      try { typingEl.remove() } catch {}
      const note = 'Stream error: '+streamErr
      chat.messages.push({ role:'assistant', content: note, ts:Date.now(), errored:true })
      appendMsg('ai', note, null, ragSources, null, true)
      setHealth('err', 'Unreachable')
      return
    }
    if (!firstToken) {
      try { typingEl.remove() } catch {}
      chat.messages.push({ role:'assistant', content:'(no response)', ts:Date.now(), errored:true })
      appendMsg('ai', '(no response)', null, ragSources)
      setHealth('err', 'Empty')
      return
    }

    if (filtered) msgObj.filtered = true
    if (truncated) msgObj.truncated = true
    if (filtered && bubble) {
      const warn = document.createElement('div')
      warn.className = 'filter-warn'
      warn.textContent = 'Filtered by safety guardrail'
      bubble.insertBefore(warn, bubble.querySelector('.msg-acts'))
    }
    if (truncated && bubble) {
      const warn = document.createElement('div')
      warn.style.cssText = 'font-size:11px;color:#f0a500;font-style:italic;margin-top:6px;padding-left:37px'
      warn.textContent = '⚠️ Response was truncated (token limit reached). Consider increasing max tokens or splitting your question.'
      bubble.insertBefore(warn, bubble.querySelector('.msg-acts'))
    }
    retry5xxCount = 0
    setHealth('ok', connectedLabel())
  } catch (err) {
    try { typingEl.remove() } catch {}
    if (err.name === 'AbortError') {
      if (msgObj) msgObj.stopped = true
      else {
        chat.messages.push({ role:'assistant', content:'(stopped)', ts:Date.now(), stopped:true })
        appendMsg('ai', '(stopped)', null, ragSources)
      }
      setHealth('ok', 'Stopped')
    } else {
      const isSsl = /certificate|CERT|SSL|TLS|issuer/i.test(err.message)
      const note = isSsl
        ? 'SSL certificate error — Please try restarting your Zscaler connection, then retry.'
        : 'Network error: '+err.message
      chat.messages.push({ role:'assistant', content: note, ts:Date.now(), errored:true })
      appendMsg('ai', note, null, ragSources, null, true)
      setHealth('err', 'Unreachable')
    }
  } finally {
    chat.updatedAt = Date.now()
    inflightCtl = null
    busy = false
    updateSendBtn()
    await persist()
    renderChatList()
    // If this was the first successful exchange in the chat, fire off an
    // auto-title call in the background. Doesn't block; runs at most once
    // per chat (guarded by chat.titledByAI).
    if (chat.messages.length === 2 && !chat.titledByAI &&
        chat.messages[1].role === 'assistant' &&
        !chat.messages[1].errored && !chat.messages[1].stopped) {
      autoTitleChat(chat)
    }
  }
}

// Auto-title: after the first user/assistant exchange, ask the model for a
// 3-6 word title and write it back. Runs once per chat; the new title only
// replaces the auto-derived "first 42 chars" title from send().

// ---------------------------------------------------------------------------
// merged from 52-chat-retry.js
// ---------------------------------------------------------------------------

async function autoTitleChat(chat) {
  if (!creds || !chat || chat.titledByAI) return
  if (!chat.messages || chat.messages.length < 2) return
  const extract = (m) => typeof m.content === 'string' ? m.content :
    (m.content?.find?.(b => b.type === 'text')?.text || '')
  const seed = (extract(chat.messages[0]) + '\n\n' +
                extract(chat.messages[1])).slice(0, 1500)
  try {
    const resp = await httpPost('/api/chat', {
        apiKey: creds.apiKey, modelId: creds.model,
        payload: {
          messages: [
            { role: 'system', content:
              'Reply with a concise 3 to 6 word title for this conversation. ' +
              'No punctuation, no quotes, no Title: prefix, no markdown. ' +
              'Just the title text.' },
            { role: 'user', content: seed }
          ],
          max_tokens: 24,
          stream: false
        }
    })
    if (!resp.ok) return
    const data = await resp.json()
    let title = (data?.choices?.[0]?.message?.content || '').trim()
    title = title.replace(/^["'`""'']/, '').replace(/["'`""'']$/, '')
                 .replace(/^Title:\s*/i, '').replace(/[.!?]+$/, '')
                 .slice(0, 60)
    if (title && chat) {
      chat.title = title
      chat.titledByAI = true
      persist()
      renderChatList()
      renderTopbar()
    }
  } catch {}
}

function stopStreaming(silent = false) {
  if (inflightCtl) {
    try { inflightCtl.abort() } catch {}
    if (!silent) toast('Stopped', 'info')
  }
  // Also cancel any pending rate-limit retry — clicking Stop should abort
  // everything, not just the in-flight request.
  if (pendingRetry) {
    pendingRetry.cancel()
    pendingRetry = null
  }
}

// Shared retry scheduler for the 429 + 5xx paths: shows a transient (NOT persisted)
// status bubble with a live countdown, auto-fires opts.onFire() after delayMs, and
// registers a cancellable pendingRetry. render(bodyEl, remainMs) draws the box each
// tick; onCancelHtml() is the cancelled-state body; optional onCancel() does extra
// cleanup. Health labels are [state,label] pairs.
function scheduleRetry(opts) {
  const bubble = appendMsg('ai', '', null, opts.ragSources)
  const bodyEl = bubble.querySelector('.msg-body')
  const acts   = bubble.querySelector('.msg-acts')
  if (acts) acts.style.display = 'none'
  const fireAt = Date.now() + opts.delayMs
  const tick = () => { try { opts.render(bodyEl, fireAt - Date.now()) } catch {} }
  tick()
  if (opts.healthWait) setHealth(opts.healthWait[0], opts.healthWait[1])
  const intervalId = setInterval(tick, opts.intervalMs || 1000)
  const timerId = setTimeout(() => {
    clearInterval(intervalId)
    try { bubble.remove() } catch {}
    pendingRetry = null
    if (opts.healthRetry) setHealth(opts.healthRetry[0], opts.healthRetry[1])
    opts.onFire()
  }, opts.delayMs)
  pendingRetry = {
    cancel() {
      clearTimeout(timerId); clearInterval(intervalId)
      if (typeof opts.onCancel === 'function') opts.onCancel()
      bodyEl.innerHTML = opts.onCancelHtml()
      pendingRetry = null
      if (opts.healthCancel) setHealth(opts.healthCancel[0], opts.healthCancel[1])
    }
  }
}

// 429 handler: shows a non-message bubble with a live countdown to the
// reset time (converted to the user's local timezone) and auto-retries the
// same payload when the timer expires. The bubble is purely UI — it does
// not get pushed into chat.messages, so retry can transparently replace it
// with the real assistant response.
function handleRateLimitWait(chat, payload, ragSources, resetMs, rawErrMsg) {
  const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
  const localTime = new Date(resetMs).toLocaleString(undefined, {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }) + ' (' + tzName + ')'
  const pad = (n) => String(n).padStart(2, '0')
  const formatCountdown = (ms) => {
    if (ms <= 0) return '0:00'
    const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
    if (d > 0) return d + 'd ' + pad(h) + ':' + pad(m) + ':' + pad(sec)
    if (h > 0) return pad(h) + ':' + pad(m) + ':' + pad(sec)
    return pad(m) + ':' + pad(sec)
  }
  scheduleRetry({
    ragSources,
    delayMs: Math.max(1000, (resetMs - Date.now()) + CFG.RATE_LIMIT_GRACE_MS),
    intervalMs: 1000,
    render: (bodyEl) => { bodyEl.innerHTML = statusBox('warn', 'Error 429: Rate limit reached',
      '<div>Resets at:&nbsp; <strong style="color:var(--tx);font-family:var(--mono)">' + localTime + '</strong></div>' +
      '<div>Retrying in: <strong style="color:var(--ac);font-family:var(--mono);font-size:13px">' + formatCountdown(resetMs - Date.now()) + '</strong></div>',
      { icon: 'clock', cancel: 'cancelRateLimitRetry()' }) },
    onFire: () => runStream(chat, payload, ragSources),
    onCancelHtml: () => '<div style="background:var(--redbg);border:1px solid rgba(231,76,60,.3);border-radius:10px;padding:12px 14px;font-size:12px;color:var(--red)">Retry cancelled. The rate limit may still be active.</div>',
    healthWait: ['warn', 'Rate-limited'], healthRetry: ['warn', 'Retrying'], healthCancel: ['err', 'Rate-limited'],
  })
}

function cancelRateLimitRetry() {
  if (pendingRetry) pendingRetry.cancel()
}

// Auto-retry for 502/503/504. Backoff: 10s → 20s → 60s (3 retries max).
// Shows a transient countdown bubble; cancellable by the user.
// ---------------------------------------------------------------------------
// merged from 53-chat-actions.js
// ---------------------------------------------------------------------------

// Strip any HTML (e.g. an upstream proxy error page) and truncate, so a raw
// upstream error body never renders in the chat.
function cleanErrMsg(raw) {
  let s = String(raw || '')
  if (/<\/?[a-z][\s\S]*>/i.test(s)) s = s.replace(/<[^>]+>/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  return s.length > 160 ? s.slice(0, 160) + '…' : (s || 'request failed')
}

function handle5xxRetry(chat, payload, ragSources, status, errMsg) {
  retry5xxCount++
  const delays = (typeof RETRY_STEPS_MS !== 'undefined') ? RETRY_STEPS_MS : [10000, 20000, 60000]
  const delayMs = delays[Math.min(retry5xxCount - 1, delays.length - 1)]
  const statusLabels = { 500: 'Server error', 502: 'Bad gateway', 503: 'Service unavailable', 504: 'Gateway timeout' }
  const statusLabel = statusLabels[status] || 'Server error'
  const hint = status === 504
    ? 'The AI took too long to respond. If it keeps failing, try a shorter request.'
    : 'The AI service is temporarily unavailable.'
  const pad = (n) => String(n).padStart(2, '0')
  const formatCountdown = (ms) => {
    if (ms <= 0) return '0'
    const s = Math.ceil(ms / 1000)
    if (s >= 60) return pad(Math.floor(s/60)) + ':' + pad(s%60)
    return s + 's'
  }
  scheduleRetry({
    ragSources,
    delayMs,
    intervalMs: 500,
    render: (bodyEl, remain) => { bodyEl.innerHTML = statusBox('err', 'Error ' + status + ': ' + statusLabel,
      '<div style="margin-bottom:4px">' + hint + '</div>' +
      '<div>Retrying in: <strong style="color:var(--ac);font-family:var(--mono);font-size:13px">' + formatCountdown(remain) + '</strong>' +
      '&nbsp;<span style="font-size:11px;opacity:.7">(attempt ' + retry5xxCount + ' of 3)</span></div>',
      { icon: 'err', cancel: 'cancelRateLimitRetry()' }) },
    onFire: () => runStream(chat, payload, ragSources),
    onCancel: () => { retry5xxCount = 0 },
    onCancelHtml: () => '<div style="font-size:12px;color:var(--tx2);padding:4px 0">Retry cancelled. <em style="opacity:.7">Error ' + status + ': ' + statusLabel + '</em></div>',
    healthWait: ['warn', 'Retrying (' + retry5xxCount + '/3)'], healthRetry: ['warn', 'Retrying'], healthCancel: ['err', 'Error ' + status],
  })
}

function updateSendBtn() {
  const btn = document.getElementById('send-btn')
  if (!btn) return
  if (busy) {
    btn.disabled = false
    btn.classList.add('stopping')
    btn.setAttribute('data-tip', 'Stop (Esc)')
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1.5"/></svg>'
    btn.onclick = stopStreaming
  } else {
    btn.disabled = !creds || !chatId
    btn.classList.remove('stopping')
    btn.setAttribute('data-tip', 'Send (Enter)')
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5a.75.75 0 01.75.75v9.69l3.22-3.22a.75.75 0 111.06 1.06l-4.5 4.5a.75.75 0 01-1.06 0l-4.5-4.5a.75.75 0 111.06-1.06L7.25 11.94V2.25A.75.75 0 018 1.5z" transform="rotate(180 8 8)"/></svg>'
    btn.onclick = send
  }
}

// =============================================================================
// Regenerate / edit last
// =============================================================================
async function regenerateLast() {
  if (busy) return
  const chat = curChat(); if (!chat||!chat.messages.length) return
  // Drop the trailing assistant message(s) until we hit a user message.
  while (chat.messages.length && chat.messages[chat.messages.length-1].role === 'assistant') {
    chat.messages.pop()
  }
  if (!chat.messages.length) return
  renderMessages()

  // Rebuild the payload from the remaining history. Shared with send() via
  // buildPayload() so the full-text-vs-RAG doc logic is identical (regenerate
  // previously did RAG-only and skipped the full-text path).
  const lastUser = chat.messages[chat.messages.length-1]
  const qText = typeof lastUser.content==='string' ? lastUser.content : lastUser.content?.find?.(b=>b.type==='text')?.text || ''
  const built = await buildPayload(chat, qText)
  if (built.skillErr) { toast(built.skillErr, 'err'); return }
  await runStream(chat, built.payload, built.ragSources)
}
// Edit the last user turn: drop any trailing assistant reply and the last user
// message, then put that message's text back into the composer for editing.
function editLastUser() {
  if (busy) return
  const chat = curChat(); if (!chat || !chat.messages.length) return
  while (chat.messages.length && chat.messages[chat.messages.length-1].role === 'assistant') {
    chat.messages.pop()
  }
  const last = chat.messages[chat.messages.length-1]
  if (!last || last.role !== 'user') { renderMessages(); return }
  chat.messages.pop()
  const text = typeof last.content==='string'
    ? last.content
    : last.content?.find?.(b=>b.type==='text')?.text || ''
  const input = document.getElementById('msg-in')
  if (input) { input.value = text; autoResize(input); input.focus() }
  chat.updatedAt = Date.now()
  renderMessages()
}
// ---------------------------------------------------------------------------
// merged from 54-chat-statusbox.js
// ---------------------------------------------------------------------------

// =============================================================================
// Shared status box — the error / retry / rate-limit panel rendered inside an
// AI bubble's body. Single source of truth for this styling, used by the 5xx
// auto-retry (53), the 429 rate-limit wait (52), and the #demo previews (96).
// =============================================================================
const STATUS_ICON = {
  err:   '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 1a6 6 0 110 12A6 6 0 018 2zm-.75 3.75a.75.75 0 011.5 0v3.5a.75.75 0 01-1.5 0v-3.5zm.75 6a.75.75 0 110-1.5.75.75 0 010 1.5z"/></svg>',
  clock: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3.5a.5.5 0 01.5.5v4.5l3 1.5a.5.5 0 01-.4.9l-3.3-1.65A.5.5 0 017.5 8.5V4a.5.5 0 01.5-.5z"/><path d="M8 16A8 8 0 108 0a8 8 0 000 16zM1 8a7 7 0 1114 0A7 7 0 011 8z"/></svg>'
}

// tone: 'err' (red) | 'warn' (amber). title: header text. bodyHtml: inner body.
// opts: { icon:'err'|'clock' (defaults by tone), cancel: a JS expression string that adds a Cancel button }
function statusBox(tone, title, bodyHtml, opts) {
  opts = opts || {}
  const c = tone === 'warn'
    ? { bg: 'var(--pinbg)',            border: 'rgba(240,165,0,.35)', fg: 'var(--pin)' }
    : { bg: 'rgba(220,60,60,.08)',     border: 'rgba(220,60,60,.3)',  fg: '#e05050'   }
  const icon = STATUS_ICON[opts.icon || (tone === 'warn' ? 'clock' : 'err')] || ''
  const cancel = opts.cancel
    ? '<div style="margin-top:10px"><button class="btn-s" style="font-size:11px;padding:4px 12px" onclick="' + opts.cancel + '">Cancel retry</button></div>'
    : ''
  return '<div style="background:' + c.bg + ';border:1px solid ' + c.border + ';border-radius:10px;padding:14px 16px;margin-top:14px;">' +
    '<div style="display:flex;align-items:center;gap:8px;font-weight:600;color:' + c.fg + ';margin-bottom:8px;font-size:13px">' + icon + title + '</div>' +
    '<div style="font-size:12px;color:var(--tx2);line-height:1.7">' + bodyHtml + '</div>' +
    cancel + '</div>'
}
