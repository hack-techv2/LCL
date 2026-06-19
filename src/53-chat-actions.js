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
  const retryAt = Date.now() + delayMs

  const statusLabels = { 502: 'Bad gateway', 503: 'Service unavailable', 504: 'Gateway timeout' }
  const statusLabel = statusLabels[status] || ('HTTP ' + status)
  const hint = status === 504
    ? 'The AI took too long to respond. If it keeps failing, try a shorter request.'
    : 'The AI service is temporarily unavailable.'

  const bubble = appendMsg('ai', '', null, ragSources)
  const bodyEl = bubble.querySelector('.msg-body')
  const acts   = bubble.querySelector('.msg-acts')
  if (acts) acts.style.display = 'none'

  const pad = (n) => String(n).padStart(2, '0')
  const formatCountdown = (ms) => {
    if (ms <= 0) return '0'
    const s = Math.ceil(ms / 1000)
    if (s >= 60) return pad(Math.floor(s/60)) + ':' + pad(s%60)
    return s + 's'
  }

  const render = () => {
    const remain = retryAt - Date.now()
    bodyEl.innerHTML = statusBox('err', 'Error ' + status + ': ' + statusLabel,
      '<div style="margin-bottom:4px">' + hint + '</div>' +
      '<div>Retrying in: <strong style="color:var(--ac);font-family:var(--mono);font-size:13px">' + formatCountdown(remain) + '</strong>' +
      '&nbsp;<span style="font-size:11px;opacity:.7">(attempt ' + retry5xxCount + ' of 3)</span></div>',
      { icon: 'err', cancel: 'cancelRateLimitRetry()' })
  }

  render()
  setHealth('warn', 'Retrying (' + retry5xxCount + '/3)')
  const intervalId = setInterval(render, 500)

  const timerId = setTimeout(() => {
    clearInterval(intervalId)
    try { bubble.remove() } catch {}
    pendingRetry = null
    setHealth('warn', 'Retrying')
    runStream(chat, payload, ragSources)
  }, delayMs)

  pendingRetry = {
    cancel() {
      clearTimeout(timerId)
      clearInterval(intervalId)
      retry5xxCount = 0
      bodyEl.innerHTML =
        '<div style="font-size:12px;color:var(--tx2);padding:4px 0">Retry cancelled. ' +
        '<em style="opacity:.7">Error ' + status + ': ' + statusLabel + '</em></div>'
      pendingRetry = null
      setHealth('err', 'Error ' + status)
    }
  }
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

  // Rebuild payload from remaining history + RAG (same as send).
  const lastUser = chat.messages[chat.messages.length-1]
  const qText = typeof lastUser.content==='string' ? lastUser.content : lastUser.content?.find?.(b=>b.type==='text')?.text || ''

  let ragChunks=[], ragSources=[]
  const hasDocs = chat.docs?.some(d=>d.status==='ready'&&d.chunks?.length)
  if (hasDocs) {
    try {
      ragChunks = await retrieveChunks(qText, chat.docs, creds.topK||10, ragStickyChunks)
      ragSources = [...new Set(ragChunks.map(c=>c.docName))]
      ragStickyChunks = ragChunks.slice(0, Math.max(1, Math.floor((creds.topK||10) * 0.3)))
    }
    catch(e) { console.warn('RAG:',e.message) }
  }
  const { sys: sysBase, error: skillErr } = await resolveSystemPrompt(chat)
  if (skillErr) { toast(skillErr, 'err'); return }
  let sys = sysBase
  if (ragChunks.length) {
    const ctx = ragChunks.map((c,i)=>`[${i+1}] (${c.docName})\n${c.text}`).join('\n\n')
    sys = 'Use the following document excerpts to answer. If the answer is not in them, say so.\n\n'+ctx+(sys?'\n\n'+sys:'')
  }
  const baseMessages = chat.messages.map(m=>({role:m.role,content:m.content}))
  const msgs = sys ? [{ role:'system', content:sys }, ...baseMessages] : baseMessages
  const payload = { messages:msgs, max_tokens:creds.maxTokens||8192 }
  await runStream(chat, payload, ragSources)
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