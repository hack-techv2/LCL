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
    title = title.replace(/^["'`“”‘’]/, '').replace(/["'`“”‘’]$/, '')
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

// 429 handler: shows a non-message bubble with a live countdown to the
// reset time (converted to the user's local timezone) and auto-retries the
// same payload when the timer expires. The bubble is purely UI — it does
// not get pushed into chat.messages, so retry can transparently replace it
// with the real assistant response.
function handleRateLimitWait(chat, payload, ragSources, resetMs, rawErrMsg) {
  // Format the reset time in the user's local timezone with the timezone
  // abbreviation appended so it's unambiguous.
  const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
  const resetDate = new Date(resetMs)
  const localTime = resetDate.toLocaleString(undefined, {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }) + ' (' + tzName + ')'

  // Build a transient bubble — not added to chat.messages.
  const bubble = appendMsg('ai', '', null, ragSources)
  const bodyEl = bubble.querySelector('.msg-body')
  const acts   = bubble.querySelector('.msg-acts')
  if (acts) acts.style.display = 'none'  // no Copy/Regen for a status bubble

  const pad = (n) => String(n).padStart(2, '0')
  const formatCountdown = (ms) => {
    if (ms <= 0) return '0:00'
    const s = Math.floor(ms / 1000)
    const d = Math.floor(s / 86400)
    const h = Math.floor((s % 86400) / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    if (d > 0) return d + 'd ' + pad(h) + ':' + pad(m) + ':' + pad(sec)
    if (h > 0) return pad(h) + ':' + pad(m) + ':' + pad(sec)
    return pad(m) + ':' + pad(sec)
  }

  const render = () => {
    const remain = resetMs - Date.now()
    bodyEl.innerHTML =
      '<div style="background:var(--pinbg);border:1px solid rgba(240,165,0,.35);border-radius:10px;padding:14px 16px;">' +
        '<div style="display:flex;align-items:center;gap:8px;font-weight:600;color:var(--pin);margin-bottom:8px;font-size:13px">' +
          '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3.5a.5.5 0 01.5.5v4.5l3 1.5a.5.5 0 01-.4.9l-3.3-1.65A.5.5 0 017.5 8.5V4a.5.5 0 01.5-.5z"/><path d="M8 16A8 8 0 108 0a8 8 0 000 16zM1 8a7 7 0 1114 0A7 7 0 011 8z"/></svg>' +
          'Rate limit reached' +
        '</div>' +
        '<div style="font-size:12px;color:var(--tx2);line-height:1.7">' +
          '<div>Resets at:&nbsp; <strong style="color:var(--tx);font-family:var(--mono)">' + localTime + '</strong></div>' +
          '<div>Retrying in: <strong style="color:var(--ac);font-family:var(--mono);font-size:13px">' + formatCountdown(remain) + '</strong></div>' +
        '</div>' +
        '<div style="margin-top:10px"><button class="btn-s" style="font-size:11px;padding:4px 12px" onclick="cancelRateLimitRetry()">Cancel retry</button></div>' +
      '</div>'
  }

  render()
  setHealth('warn', 'Rate-limited')
  const intervalId = setInterval(render, 1000)

  // Auto-retry: fire 2 seconds past the reset to give the upstream a
  // moment to clear the bucket.
  const delay = Math.max(1000, (resetMs - Date.now()) + 2000)
  const timerId = setTimeout(() => {
    if (intervalId) clearInterval(intervalId)
    try { bubble.remove() } catch {}
    pendingRetry = null
    setHealth('warn', 'Retrying')
    runStream(chat, payload, ragSources)
  }, delay)

  pendingRetry = {
    cancel() {
      clearTimeout(timerId)
      clearInterval(intervalId)
      bodyEl.innerHTML =
        '<div style="background:var(--redbg);border:1px solid rgba(231,76,60,.3);border-radius:10px;padding:12px 14px;font-size:12px;color:var(--red)">' +
          'Retry cancelled. The rate limit may still be active.' +
        '</div>'
      pendingRetry = null
      setHealth('err', 'Rate-limited')
    }
  }
}

function cancelRateLimitRetry() {
  if (pendingRetry) pendingRetry.cancel()
}

// Auto-retry for 502/503/504. Backoff: 5s → 10s → 20s (3 retries max).
// Shows a transient countdown bubble; cancellable by the user.