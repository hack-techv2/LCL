// =============================================================================
// Init & persistence
// =============================================================================
// Factory for the in-memory creds object so its shape + defaults live in ONE
// place (was hand-built in init/connect/demo). Accepts `model` or `modelId`;
// callers that compute classification pass it in.

// --- Shared RAG memory (v0.67e item 3): search current chat's docs + optionally
// prior chats' docs. Migration (upgradePersistedDocsForRag) intentionally omitted
// (item 6: old docs are re-embedded, not migrated). ---
function docMemoryKey(doc) {
  return doc?.id || [doc?.name || 'doc', doc?.size || 0, doc?.addedAt || 0].join('|')
}

function chatUsesPastEmbeddings(chat) {
  // Default OFF — a chat searches only its own uploaded files unless the user
  // explicitly enables shared past-chat embeddings from the Embed panel.
  return !!(chat && chat.usePastEmbeddings === true)
}

function setPastEmbeddingsForChat(on) {
  const chat = curChat()
  if (!chat) return
  chat.usePastEmbeddings = !!on
  chat.updatedAt = Date.now()
  ragStickyChunks = []
  ragKeywordIndexCache = { signature: '', index: null, records: [] }
  persist()
  renderDocPanel()
  updateDocsBtn()
  toast(on ? 'Past embeddings enabled for this chat' : 'Past embeddings disabled for this chat', on ? 'ok' : 'info')
}

// Per-chat RAG search mode: 'auto' (whole doc if it fits, else search), 'specific'
// (always search relevant passages), 'whole' (always send the full document).
function chatSearchMode(chat) {
  const m = chat && chat.searchMode
  return (m === 'specific' || m === 'whole') ? m : 'auto'
}
function setSearchMode(mode) {
  const chat = curChat()
  if (!chat) return
  chat.searchMode = (mode === 'specific' || mode === 'whole') ? mode : 'auto'
  chat.updatedAt = Date.now()
  ragStickyChunks = []
  persist()
  renderDocPanel()
  const label = chat.searchMode === 'specific' ? 'Specific (search passages)'
              : chat.searchMode === 'whole' ? 'Whole document'
              : 'Auto'
  toast('Search mode: ' + label, 'info')
}

function getRagMemoryDocs(chat) {
  const out = []
  const seen = new Set()
  const addDoc = d => {
    if (!d) return
    const key = docMemoryKey(d)
    if (seen.has(key)) return
    seen.add(key)
    out.push(d)
  }

  // Prefer the active chat's own files first. Past/shared embeddings are optional
  // per chat and controlled from the Embed panel checkbox.
  for (const d of (chat?.docs || [])) addDoc(d)
  if (chatUsesPastEmbeddings(chat)) {
    for (const ch of Object.values(D.chats || {})) {
      if (chat && ch.id === chat.id) continue
      for (const d of (ch.docs || [])) addDoc(d)
    }
  }
  return out
}

function findDocInAnyChat(docId) {
  for (const ch of Object.values(D.chats || {})) {
    if (!Array.isArray(ch.docs)) continue
    const idx = ch.docs.findIndex(d => d.id === docId)
    if (idx !== -1) return { chat: ch, idx, doc: ch.docs[idx] }
  }
  return null
}
function makeCreds(o){ o=o||{}; return {
  apiKey: o.apiKey||'', model: o.model||o.modelId||'',
  maxTokens: o.maxTokens||CFG.DEFAULT_MAX_TOKENS, systemPrompt: o.systemPrompt||'',
  chunkSize: o.chunkSize||CFG.DEFAULT_CHUNK_SIZE, topK: o.topK||CFG.DEFAULT_TOP_K,
  embedApiKey: o.embedApiKey||'', embedModelId: o.embedModelId||'',
  embedWarnTokens: (o.embedWarnTokens==null?'auto':o.embedWarnTokens), embedMaxTokens: (o.embedMaxTokens==null?'auto':o.embedMaxTokens),
  classification: o.classification||'' } }
// Inverse mapping for the on-disk settings shape (model -> modelId).
function credsToSettings(c){ return {
  apiKey: c.apiKey, modelId: c.model, maxTokens: c.maxTokens, systemPrompt: c.systemPrompt,
  chunkSize: c.chunkSize, topK: c.topK, embedApiKey: c.embedApiKey||'',
  embedModelId: c.embedModelId||'', embedWarnTokens: c.embedWarnTokens||'auto', embedMaxTokens: c.embedMaxTokens||'auto', classification: c.classification } }

async function init() {
  // Demo mode (?demo=1) seeds sample content and skips all network work.
  if (typeof maybeDemo === 'function' && maybeDemo()) return
  await loadData()
  // Scrub any leaked #demo sentinel ('demo') from saved settings so a prior demo
  // visit never looks connected or "embeddings ready" in normal mode.
  if (D.settings) {
    if (D.settings.apiKey === 'demo' || D.settings.apiKey === 'DEMOKEY') D.settings.apiKey = ''
    if (D.settings.embedApiKey === 'demo' || D.settings.embedApiKey === 'DEMOKEY') D.settings.embedApiKey = ''
  }
  // Try to auto-connect from saved settings
  try {
    const cfg = await loadSettings()
    // Primary: settings from /api/config. Fallback: settings embedded in D (from /api/data)
    // Ignore the demo sentinel ('demo') so a prior #demo visit never looks
    // connected in normal mode.
    const real = (o) => o && o.apiKey && o.apiKey !== 'demo' && o.apiKey !== 'DEMOKEY' && o.modelId
    const s = real(cfg) ? cfg : real(D.settings) ? D.settings : null
    if (s) {
      creds = makeCreds(s)
      setHealth('ok', connectedLabel())
      document.body.classList.remove('not-connected')
      document.getElementById('connect-banner')?.classList.add('hidden')
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
  const d = await loadAppData()
  if (d && d.chats) D = d
}

async function persist() {
  // Persistence + the #demo write-guard live in saveAppData (18-store).
  await saveAppData(D)
}

// =============================================================================
// Auth
// =============================================================================
async function connect() {
  if (typeof demoOn === 'function' && demoOn()) {
    // Demo: run the REAL validation call (httpPost adds the x-lcl-demo header so
    // the server demo responder answers) to exercise the Connect path, then set
    // creds WITHOUT the persist/loadData side-effects that would wipe demo seed.
    const model = (document.getElementById('cfg-mdl')?.value.trim()) || 'cce.claude-opus-4-6'
    const dErr = document.getElementById('modal-err'), dBtn = document.getElementById('connect-btn')
    if (dErr) dErr.classList.remove('show')
    if (dBtn) { dBtn.disabled = true; dBtn.textContent = 'Connecting...' }
    setHealth('warn','Connecting')
    try {
      const r = await httpPost('/api/chat', { apiKey: DEMOKEY_CLIENT, modelId: model, payload: { messages:[{role:'user',content:'Hi'}], max_tokens:16, stream:false } })
      if (!r.ok) { const d = await r.json().catch(()=>({})); if (dErr) { dErr.textContent = 'Connection failed: ' + (d?.error?.message || ('HTTP '+r.status)); dErr.classList.add('show') } setHealth('err','Failed'); return }
    } catch(e) { if (dErr) { dErr.textContent = 'Connection error: ' + e.message; dErr.classList.add('show') } setHealth('err','Unreachable'); return }
    finally { if (dBtn) { dBtn.disabled = false; dBtn.textContent = 'Connect' } }
    creds = makeCreds({ apiKey: DEMOKEY_CLIENT, model, embedApiKey: DEMOKEY_CLIENT, embedModelId:'cohere.embed-english-v3', classification: ((typeof _clsState!=='undefined' && _clsState.cfg) || inferTier(model) || 'cce') })
    if (typeof closeConnect==='function') closeConnect()
    if (typeof updateConnectedUI==='function') updateConnectedUI()
    setHealth('ok', connectedLabel())
    if (typeof toast==='function') toast('Connected (demo)','ok')
    return
  }
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
  creds = makeCreds({ apiKey, model, embedApiKey: prevEmbedApiKey, embedModelId: prevEmbedModelId, classification: ((typeof _clsState!=='undefined' && _clsState.cfg) || inferTier(model) || 'cce') })
  // Write settings into D directly — persist() will carry them to disk on every save
  D.settings = credsToSettings(creds)
  // Also save via /api/config for immediate server-side update
  await saveSettings(D.settings)
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
  // Also clear the server-side /api/config (mirror of connect()'s write). init()
  // prefers /api/config over D.settings, so a stale config would silently
  // auto-reconnect on next launch. Push blank credentials to wipe it.
  await saveSettings({ apiKey:'', modelId:'', embedApiKey:'', embedModelId:'' })
  setHealth('off', 'Not connected')
  updateConnectedUI()
  toast('Disconnected', 'ok')
}

// connectedLabel() is defined in 70-render.js (chat+embed vs chat only).

function openConnect() {
  if (typeof initClassification === 'function') initClassification('cfg', (creds && creds.classification) || inferTier(creds && creds.model) || 'cce')
  document.getElementById('modal-bd').classList.remove('hidden')
  if (typeof demoKeyHint === 'function') demoKeyHint('cfg-key')
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

