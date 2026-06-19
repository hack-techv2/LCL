// =============================================================================
// Init & persistence
// =============================================================================
async function init() {
  await loadData()
  // Try to auto-connect from saved settings
  try {
    const r = await fetch('/api/config')
    if (r.ok) {
      const cfg = await r.json()
      // Primary: settings from /api/config. Fallback: settings embedded in D (from /api/data)
      const s = (cfg.apiKey && cfg.modelId) ? cfg
              : (D.settings?.apiKey && D.settings?.modelId) ? D.settings
              : null
      if (s) {
        creds = { apiKey: s.apiKey, model: s.modelId || s.model, maxTokens: s.maxTokens||8192, systemPrompt: s.systemPrompt||'', chunkSize: s.chunkSize||800, topK: s.topK||5, embedApiKey: s.embedApiKey||'', embedModelId: s.embedModelId||'' }
        setHealth('ok', connectedLabel())
        document.body.classList.remove('not-connected')
        document.getElementById('connect-banner')?.classList.add('hidden')
      }
    }
  } catch {}
  await loadSkillsList()
  // always render chat UI, select/create a chat
  const chats = sortedChats()
  if (chats.length) { chatId = chats[0].id }
  else { newChat() }
  renderAll()
  updateConnectedUI()
}

async function loadData() {
  try {
    const r = await fetch('/api/data')
    if (r.ok) { const d=await r.json(); if (d&&d.chats) D=d }
  } catch {}
}

async function persist() {
  try {
    await fetch('/api/data', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(D) })
  } catch {}
}

// =============================================================================
// Auth
// =============================================================================
async function connect() {
  const apiKey = document.getElementById('cfg-key').value.trim()
  const model  = document.getElementById('cfg-mdl').value.trim() || 'cce.claude-opus-4-6'
  const errEl  = document.getElementById('modal-err')
  const btn    = document.getElementById('connect-btn')
  errEl.classList.remove('show'); errEl.textContent = ''
  if (!apiKey) { errEl.textContent='API key required'; errEl.classList.add('show'); return }

  btn.disabled = true; btn.textContent = 'Connecting...'
  setHealth('warn', 'Connecting')
  try {
    // Escalate max_tokens until the model accepts it (1 → 16 → 32).
    // Some providers (e.g. GPT) reject very low values with a 400/422.
    // Auth errors (401/403) and network errors stop immediately.
    const tokenBudgets = [1, 16, 32]
    let r, rd, connected = false
    for (let ti = 0; ti < tokenBudgets.length; ti++) {
      const budget = tokenBudgets[ti]
      ;({ r, data: rd } = await fetchWithRetry('/api/chat', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ apiKey, modelId:model, payload:{ messages:[{role:'user',content:'Hi'}], max_tokens:budget, stream:false } })
      }, {
        attempts: 4,          // 3 retries: wait 1s → 2s → 4s between each
        baseDelay: 1000,
        onRetry: (i, n) => { btn.textContent = 'Retrying ('+i+'/'+n+')'; setHealth('warn', 'Retrying ('+i+'/'+n+')') }
      }))
      if (r.ok) { connected = true; break }
      // Hard failures — no point escalating
      if (r.status === 401 || r.status === 403) break
      // On last budget, fall through to error reporting below
      if (ti < tokenBudgets.length - 1 && (r.status === 400 || r.status === 422)) {
        btn.textContent = 'Retrying...'
        continue
      }
      break
    }
    if (!connected) {
      errEl.textContent = 'Connection failed: ' + (rd?.error?.message || rd?.message || rd?.error || ('HTTP '+r.status))
      errEl.classList.add('show'); setHealth('err', 'Failed'); return
    }
    setHealth('ok', connectedLabel())
  } catch(e) {
    const isSsl = /certificate|CERT|SSL|TLS|issuer/i.test(e.message)
    errEl.textContent = isSsl
      ? 'SSL certificate error — Please try restarting your Zscaler connection, then reconnect.'
      : 'Connection error: ' + e.message
    errEl.classList.add('show'); setHealth('err', 'Unreachable'); return
  } finally {
    btn.disabled = false; btn.textContent = 'Connect'
  }

  // Preserve any already-saved embed settings when (re)connecting
  const prevEmbedApiKey  = creds?.embedApiKey  || D.settings?.embedApiKey  || ''
  const prevEmbedModelId = creds?.embedModelId || D.settings?.embedModelId || ''
  creds = { apiKey, model, maxTokens:8192, systemPrompt:'', chunkSize:800, topK:5, embedApiKey: prevEmbedApiKey, embedModelId: prevEmbedModelId }
  // Write settings into D directly — persist() will carry them to disk on every save
  D.settings = { apiKey: creds.apiKey, modelId: creds.model, maxTokens: creds.maxTokens, systemPrompt: creds.systemPrompt, chunkSize: creds.chunkSize, topK: creds.topK, embedApiKey: creds.embedApiKey, embedModelId: creds.embedModelId }
  // Also save via /api/config for immediate server-side update
  try {
    await fetch('/api/config', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(D.settings) })
  } catch {}
  await persist()  // write D (with settings) to disk right now
  await loadData()
  await loadSkillsList()
  if (!chatId) {
    const chats = sortedChats()
    if (chats.length) { chatId = chats[0].id } else { newChat() }
  }
  renderAll()
  updateConnectedUI()
  toast('Connected','ok')
}

async function disconnect() {
  const ok = confirm(
    'Disconnect from PlatformAI?\n\n' +
    'This will clear your saved API keys from this machine (both the chat key and the embedding key) so they are not auto-loaded on next launch.\n\n' +
    'Your chat history, embedded files, and skills will be kept.'
  )
  if (!ok) return
  creds = null
  // Blank the credential fields in D.settings but preserve everything else
  // (maxTokens, chunkSize, topK, systemPrompt). Then push the blanked values
  // through both write paths so lcl_data.json on disk is updated immediately.
  if (D.settings) {
    D.settings.apiKey       = ''
    D.settings.modelId      = ''
    D.settings.embedApiKey      = ''
    D.settings.embedModelId = ''
  }
  await persist()
  setHealth('off', 'Not connected')
  updateConnectedUI()
  toast('Disconnected', 'ok')
}

function connectedLabel() {
  return creds ? (creds.model || 'Connected') : 'Not connected'
}

function openConnect() {
  document.getElementById('modal-bd').classList.remove('hidden')
  setTimeout(() => document.getElementById('cfg-key').focus(), 50)
}

function closeConnect() {
  document.getElementById('modal-bd').classList.add('hidden')
}

function updateConnectedUI() {
  const banner = document.getElementById('connect-banner')
  if (creds) {
    banner.classList.add('hidden')
    document.body.classList.remove('not-connected')
    closeConnect()
    if (!busy) setHealth('ok', connectedLabel())
  } else {
    banner.classList.remove('hidden')
    document.body.classList.add('not-connected')
    setHealth('', 'Idle')
  }
  updateSendBtn()
}