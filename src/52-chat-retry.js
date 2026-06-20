async function autoTitleChat(chat) {
  if (!creds || !chat || chat.titledByAI) return
  if (!chat.messages || chat.messages.length < 2) return
  const extract = (m) => typeof m.content === 'string' ? m.content :
    (m.content?.find?.(b => b.type === 'text')?.text || '')
  const seed = (extract(chat.messages[0]) + '\n\n' +
                extract(chat.messages[1])).slice(0, 1500)
  try {
    const resp = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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