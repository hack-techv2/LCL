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
    const resp = await fetch('/api/chat', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      signal: inflightCtl.signal,
      body: JSON.stringify({ apiKey: creds.apiKey, modelId: creds.model, streamTimeoutMs: RETRY_STEPS_MS[Math.min(retry5xxCount, 2)], payload })
    })

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

      // 5xx transient errors — auto-retry with backoff (up to 3 times)
      if ([502, 503, 504].includes(resp.status) && retry5xxCount < 3) {
        const em5 = errData?.error?.message || errData?.error || ('HTTP '+resp.status)
        handle5xxRetry(chat, payload, ragSources, resp.status, em5)
        return
      }
      retry5xxCount = 0
      const labels = { 500:'Server error', 502:'Bad gateway', 503:'Service unavailable', 504:'Gateway timeout' }
      const note = labels[resp.status]
        ? ('Error ' + resp.status + ': ' + labels[resp.status] + ' — the model service is temporarily unreachable. Please try again in a moment.')
        : ('Error ' + resp.status + ': ' + cleanErrMsg(errData?.error?.message || errData?.error || ('HTTP ' + resp.status)))
      chat.messages.push({ role:'assistant', content: note, ts:Date.now(), errored:true })
      appendMsg('ai', note, null, ragSources)
      setHealth('err', labels[resp.status] ? 'Service unavailable' : ('Error ' + resp.status))
      return
    }
    if (!resp.body) throw new Error('No response body for streaming')

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    const msgsEl = document.getElementById('messages')

    while (true) {
      let chunk
      try { chunk = await reader.read() }
      catch (e) {
        if (e.name === 'AbortError' || inflightCtl?.signal?.aborted) { stopped = true; break }
        throw e
      }
      if (chunk.done) break
      buf += decoder.decode(chunk.value, { stream: true })

      // SSE frames are separated by \n\n. Each frame is "data: <json>".
      const parts = buf.split('\n\n')
      buf = parts.pop() || ''
      for (const part of parts) {
        const line = part.trim()
        if (!line || !line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') continue

        let evt
        try { evt = JSON.parse(data) } catch { continue }

        if (evt.error) {
          streamErr = evt.error?.message || evt.error
          continue
        }

        const choice = evt.choices?.[0]
        if (!choice) continue
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
      }
    }

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
      appendMsg('ai', note, null, ragSources)
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
      appendMsg('ai', note, null, ragSources)
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
