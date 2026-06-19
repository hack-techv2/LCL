// =============================================================================
// Send
// =============================================================================
// Resolves the system prompt for a chat: skill body if chat.skillId is set,
// otherwise the global creds.systemPrompt. Returns { sys, error }. On a
// missing/unreadable skill, returns { sys: null, error: '...' } so the caller
// can block the send and surface the error.
async function resolveSystemPrompt(chat) {
  if (!chat || !chat.skillId) return { sys: creds.systemPrompt || '', error: null }
  try {
    const r = await fetch('/skills/' + encodeURIComponent(chat.skillId))
    if (r.status === 404) return { sys: null, error: 'Skill "' + chat.skillId + '" not found' }
    if (!r.ok) return { sys: null, error: 'Skill "' + chat.skillId + '" failed to load (HTTP ' + r.status + ')' }
    const data = await r.json()
    return { sys: data.body || '', error: null }
  } catch (e) {
    return { sys: null, error: 'Skill "' + chat.skillId + '" load error: ' + e.message }
  }
}

async function loadSkillsList() {
  try {
    const r = await fetch('/skills')
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
      html += `<div class="sb-skill-item${active}" data-id="${esc(s.id)}" onclick="onSkillPicked('${esc(s.id)}')" data-tip-right="${esc(s.id)}">
        <span class="sb-skill-dot"></span>
        <span class="sb-skill-name">${esc(s.title)}</span>
      </div>`
    }
    if (current && !skillsCache.some(s => s.id === current)) {
      html += `<div class="sb-skill-item active" data-id="${esc(current)}" data-tip-right="missing skill">
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
  el.textContent = 'Skill: ' + id
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

async function send() {
  if (!creds) { openConnect(); return }
  const input = document.getElementById('msg-in')
  const text  = input.value.trim()
  if (!text||busy||!chatId) return

  // If a 429 retry was pending from a previous send, cancel it. The user
  // is starting fresh; the old payload shouldn't auto-fire later.
  if (pendingRetry) { pendingRetry.cancel(); pendingRetry = null }

  const chat = curChat(); if (!chat) return

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

  // Document context. If the chat's ready docs fit the model's window, send the
  // FULL text of every doc (the model sees everything — best quality, and the
  // reason small PDFs already "just work"). Only fall back to chunk-retrieval
  // (RAG) when the combined text exceeds the char budget.
  let ragChunks=[], ragSources=[], fullDocText=''
  const readyDocs   = (chat.docs||[]).filter(d=>d.status==='ready')
  const docsForFull = readyDocs.filter(d=>d.content)
  const totalChars  = docsForFull.reduce((n,d)=>n+d.content.length,0)
  const fullLimit   = creds.docFullTextLimit || 200000
  const useFullText = docsForFull.length>0 && totalChars<=fullLimit

  if (useFullText) {
    fullDocText = docsForFull.map(d=>'--- '+d.name+' ---\n'+d.content).join('\n\n')
    ragSources  = docsForFull.map(d=>d.name)
  } else if (readyDocs.some(d=>d.chunks?.length)) {
    try {
      ragChunks = await retrieveChunks(text, chat.docs, creds.topK||10, ragStickyChunks)
      ragSources = [...new Set(ragChunks.map(c=>c.docName))]
      ragStickyChunks = ragChunks.slice(0, Math.max(1, Math.floor((creds.topK||10) * 0.3)))
    }
    catch(e) { console.warn('RAG:',e.message) }
  }

  const { sys: sysBase, error: skillErr } = await resolveSystemPrompt(chat)
  if (skillErr) {
    chat.messages.pop()
    chat.updatedAt = Date.now()
    renderMessages()
    toast(skillErr, 'err')
    return
  }
  let sys = sysBase
  if (fullDocText) {
    sys = 'The following document(s) are provided IN FULL. Use them to answer the user.\n\n'+fullDocText+(sys?'\n\n'+sys:'')
  } else if (ragChunks.length) {
    const ctx = ragChunks.map((c,i)=>`[${i+1}] (${c.docName})\n${c.text}`).join('\n\n')
    sys = 'Use the following document excerpts to answer. If the answer is not in them, say so.\n\n'+ctx+(sys?'\n\n'+sys:'')
  }

  const baseMessages = chat.messages.map(m=>({role:m.role,content:m.content}))
  const msgs = sys ? [{ role:'system', content:sys }, ...baseMessages] : baseMessages
  const payload = { messages:msgs, max_tokens:creds.maxTokens||8192 }

  await runStream(chat, payload, ragSources)
}

// Core send loop. Streams from /api/chat (stream:true) and writes tokens into
// the message bubble live as they arrive. The previous non-streaming code path
// is gone — auto-title and any other utility calls explicitly send stream:false
// in their own payload and hit the buffered path on the server.
