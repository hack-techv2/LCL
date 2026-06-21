// =============================================================================
// Render — core orchestration + small shared helpers
// =============================================================================

function renderAll() {
  renderChatList(); renderTopbar(); renderMessages(); renderDocPanel(); updateDocsBtn()
  updateSendBtn()
  renderSkillPicker(); renderSkillChip()
}

function renderTopbar() {
  const chat = curChat()
  const subEl = document.getElementById('tb-chat-title'); if(subEl) subEl.textContent = (chat && chat.title && chat.title !== 'New chat') ? chat.title : ''
}

// Returns the appropriate "Connected" status label based on whether the
// embedding key is also configured. Used by setHealth() callers.
function connectedLabel() {
  if (!creds) return 'Idle'
  return (creds.embedApiKey && creds.embedModelId)
    ? 'Chat + embed'
    : 'Chat only'
}

// ---------------------------------------------------------------------------
// merged from 71-render-chatlist.js
// ---------------------------------------------------------------------------

// =============================================================================
// Render — sidebar chat list (mkEl + one delegated listener; no inline onclick)
// =============================================================================

// Trusted, static icon markup for the per-row action buttons.
const ICON_PIN = fill => '<svg width="12" height="12" viewBox="0 0 16 16" fill="' + fill + '"><path d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z"/></svg>'
const ICON_RENAME = '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61zm1.414 1.06a.25.25 0 00-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 000-.354l-1.086-1.086zM11.189 6.25L9.75 4.81l-6.286 6.287a.25.25 0 00-.064.108l-.558 1.953 1.953-.558a.249.249 0 00.108-.064L11.189 6.25z"/></svg>'
const ICON_DELETE = '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M6.5 1.75a.25.25 0 01.25-.25h2.5a.25.25 0 01.25.25V3h-3V1.75zm4.5 0V3h2.25a.75.75 0 010 1.5H2.75a.75.75 0 010-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75zM4.496 6.675l.66 6.6a.25.25 0 00.249.225h5.19a.25.25 0 00.249-.225l.66-6.6a.75.75 0 011.492.149l-.66 6.6A1.748 1.748 0 0110.595 15h-5.19a1.75 1.75 0 01-1.741-1.575l-.66-6.6a.75.75 0 011.492-.15z"/></svg>'

function renderChatList() {
  const el    = document.getElementById('chat-list')
  const chats = sortedChats().filter(c => c.messages.length || (c.docs && c.docs.length))
  el.innerHTML = ''
  if (!chats.length) {
    el.appendChild(mkEl('div', { style: 'padding:12px 10px;font-size:12px;color:var(--tx3)' }, 'No chats yet'))
    return
  }

  const pinned   = chats.filter(c => c.pinned)
  const unpinned = chats.filter(c => !c.pinned)
  const frag     = document.createDocumentFragment()

  const section = (label, items) => {
    if (!items.length) return
    frag.appendChild(mkEl('div', { class: 'section-lbl' }, label))
    items.forEach(c => frag.appendChild(chatItemEl(c)))
  }

  section('Pinned', pinned)

  // group unpinned by date
  const today     = new Date(); today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  const week      = new Date(today); week.setDate(today.getDate() - 7)

  section('Today',           unpinned.filter(c => new Date(c.updatedAt) >= today))
  section('Yesterday',       unpinned.filter(c => { const d = new Date(c.updatedAt); return d >= yesterday && d < today }))
  section('Previous 7 days', unpinned.filter(c => { const d = new Date(c.updatedAt); return d >= week && d < yesterday }))
  section('Older',           unpinned.filter(c => new Date(c.updatedAt) < week))

  el.appendChild(frag)
  setupChatListDelegation()
  setupChatTitleScroll()
}

// One delegated click listener on the persistent #chat-list container, installed
// once. Reads data-id / data-act off the clicked row/button — no per-item binding
// and no inline onclick="fn('id')" (so no escJs string-interpolation either).
let _chatListBound = false
function setupChatListDelegation() {
  if (_chatListBound) return
  _chatListBound = true
  const el = document.getElementById('chat-list')
  el.addEventListener('click', e => {
    const item = e.target.closest('.chat-item')
    if (!item) return
    const id  = item.getAttribute('data-id')
    const btn = e.target.closest('.ca-btn')
    if (btn) {
      const act = btn.getAttribute('data-act')
      if (act === 'pin')    return togglePin(id, e)
      if (act === 'rename') return startRename(id, e)
      if (act === 'delete') return deleteChat(id, e)
      return
    }
    switchChat(id)
  })
}

// Continuously scroll (ping-pong) an overflowing chat name while its row is
// hovered; names that already fit don't move. Re-bound after every render.
function setupChatTitleScroll() {
  document.querySelectorAll('#chat-list .chat-item').forEach(item => {
    const box = item.querySelector('.chat-title')
    const inner = item.querySelector('.chat-title-inner')
    if (!box || !inner) return
    item.onmouseenter = () => {
      if (!box.clientWidth) return
      const over = inner.scrollWidth - box.clientWidth
      if (over > 4) {
        inner.style.setProperty('--mq', '-' + over + 'px')
        inner.style.setProperty('--mqd', Math.max(3, over / 22) + 's')
        inner.classList.add('mq')
      }
    }
    item.onmouseleave = () => {
      inner.classList.remove('mq')
      inner.style.removeProperty('--mq')
    }
  })
}

function chatItemEl(c) {
  const n      = c.messages.length
  const title  = c.title || ''
  const avatar = mkEl('div', { class: 'chat-avatar', title: title }, (title.trim().charAt(0).toUpperCase() || '?'))

  const text = mkEl('div', { class: 'chat-item-text', title: title }, [
    mkEl('div', { class: 'chat-title' }, mkEl('span', { class: 'chat-title-inner' }, title)),
    mkEl('div', { class: 'chat-meta' }, n + ' msg' + (n !== 1 ? 's' : '') + ' * ' + fmtDate(c.updatedAt))
  ])

  const inner = mkEl('div', { class: 'chat-item-inner' }, [
    mkEl('div', { class: 'chat-pin-dot' }),
    text
  ])

  const actions = mkEl('div', { class: 'chat-actions' }, [
    mkEl('button', { class: 'ca-btn pin-btn', 'data-act': 'pin',    'data-tip': c.pinned ? 'Unpin' : 'Pin', html: ICON_PIN(c.pinned ? 'var(--pin)' : 'currentColor') }),
    mkEl('button', { class: 'ca-btn',         'data-act': 'rename', 'data-tip': 'Rename', html: ICON_RENAME }),
    mkEl('button', { class: 'ca-btn del-btn', 'data-act': 'delete', 'data-tip': 'Delete', html: ICON_DELETE })
  ])

  return mkEl('div', {
    class: 'chat-item' + (c.id === chatId ? ' active' : '') + (c.pinned ? ' pinned' : ''),
    'data-id': c.id
  }, [avatar, inner, actions])
}

// ---------------------------------------------------------------------------
// merged from 72-render-message.js
// ---------------------------------------------------------------------------

// =============================================================================
// Render — chat messages (bubbles, file chips, RAG tags, typing)
// mkEl + addEventListener throughout; no inline onclick / escJs string-building.
// Dynamic text goes through DOM text nodes (auto-escaped); only trusted, static
// markup (icons) and sanitised output (fmt() / statusBox()) use html:.
// =============================================================================

const LOGO_SVG = '<svg width="20" height="20" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><line x1="10" y1="10" x2="2" y2="18" stroke="white" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/><line x1="11.5" y1="10" x2="4" y2="18" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.45"/><line x1="10" y1="11.5" x2="2" y2="20" stroke="white" stroke-width="0.6" stroke-linecap="round" opacity="0.28"/><rect x="9" y="1" width="11" height="11" rx="1.5" fill="white" opacity="0.95"/><rect x="11" y="3" width="7" height="7" rx="0.5" fill="#e8610a"/><line x1="13.3" y1="3" x2="13.3" y2="10" stroke="white" stroke-width="0.5" opacity="0.6"/><line x1="15.7" y1="3" x2="15.7" y2="10" stroke="white" stroke-width="0.5" opacity="0.6"/><line x1="11" y1="5.3" x2="18" y2="5.3" stroke="white" stroke-width="0.5" opacity="0.6"/><line x1="11" y1="7.7" x2="18" y2="7.7" stroke="white" stroke-width="0.5" opacity="0.6"/><line x1="12.5" y1="1" x2="12.5" y2="0" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.8"/><line x1="15" y1="1" x2="15" y2="0" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.8"/><line x1="17.5" y1="1" x2="17.5" y2="0" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.8"/><line x1="12.5" y1="12" x2="12.5" y2="13.5" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.8"/><line x1="15" y1="12" x2="15" y2="13.5" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.8"/><line x1="17.5" y1="12" x2="17.5" y2="13.5" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.8"/><line x1="20" y1="3.5" x2="21.5" y2="3.5" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.8"/><line x1="20" y1="6.5" x2="21.5" y2="6.5" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.8"/><line x1="20" y1="9.5" x2="21.5" y2="9.5" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.8"/><line x1="9" y1="3.5" x2="7.5" y2="3.5" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.8"/><line x1="9" y1="6.5" x2="7.5" y2="6.5" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.8"/><line x1="9" y1="9.5" x2="7.5" y2="9.5" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.8"/></svg>'

// Hint-card markup is fully static (no user data) — safe to assemble as html.
const HINT_CARDS = [
  { prompt: 'Summarise this document for me: ',        html: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 1.5A1.5 1.5 0 015.5 0h4.1a1.5 1.5 0 011.06.44l1.9 1.9A1.5 1.5 0 0113 3.41V14.5A1.5 1.5 0 0111.5 16h-6A1.5 1.5 0 014 14.5v-13zM6 6.5a.5.5 0 000 1h4a.5.5 0 000-1H6zm0 2.5a.5.5 0 000 1h4a.5.5 0 000-1H6zm0 2.5a.5.5 0 000 1h2a.5.5 0 000-1H6z"/></svg><span class="hint-card-title">Summarise a document</span><span class="hint-card-sub">Paste or attach a file</span>' },
  { prompt: 'Help me write a pentest report. ',         html: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 .6l5.4 2.1v4.2c0 3.4-2.3 6.5-5.4 7.4C4.9 13.4 2.6 10.3 2.6 6.9V2.7L8 .6z"/></svg><span class="hint-card-title">Write a pentest report</span><span class="hint-card-sub">Draft findings &amp; structure</span>' },
  { prompt: 'Explain this concept to me step by step: ', html: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a4.5 4.5 0 00-2.7 8.1c.4.3.6.8.6 1.3v.6h4.2v-.6c0-.5.2-1 .6-1.3A4.5 4.5 0 008 1zM6 13h4v.4A1.6 1.6 0 018.4 15h-.8A1.6 1.6 0 016 13.4V13z"/></svg><span class="hint-card-title">Explain a concept</span><span class="hint-card-sub">Step-by-step breakdown</span>' }
]

const ICON_CHIP_FILE = '<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2a2 2 0 012-2h8a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V2z"/></svg>'
const ICON_CHIP_CHEVRON = '<svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor"><path d="M8 10.94L1.53 4.47a.75.75 0 011.06-1.06L8 8.81l5.41-5.4a.75.75 0 111.06 1.06L8 10.94z"/></svg>'

function renderMessages() {
  const el   = document.getElementById('messages')
  const chat = curChat()

  if (!chat || !chat.messages.length) {
    const embModel = (creds && creds.embedModelId) || (D.settings && D.settings.embedModelId) || ''
    const embKey   = (creds && creds.embedApiKey)  || (D.settings && D.settings.embedApiKey)  || ''
    const embOk    = !!(embModel && embKey)
    // Example hint cards are first-run onboarding only: hide once the user
    // already has chat history (more than just this empty new chat).
    const firstRun = Object.keys(D.chats || {}).length <= 1
    const cap = ' — ask questions, write &amp; review code, summarise and draft documents.'
    const copyLine = '<br><em style="color:var(--tx2)">Copy any reply straight into Word or Outlook with formatting intact.</em>'
    let sub
    if (creds) {
      sub = 'Connected to <strong style="color:var(--ac)">' + esc(creds.model || 'a model') + '</strong>' + clsSuffix(creds) + cap + copyLine + '<br>' +
        (embOk ? 'Embeddings ready (<strong style="color:var(--ac)">' + esc(embModel) + '</strong>) — attach files to chat over them.'
               : 'Add an embedding key in Settings to chat over your files.')
    } else if (embOk) {
      sub = 'Embeddings ready (<strong style="color:var(--ac)">' + esc(embModel) + '</strong>).<br>Click <strong style="color:var(--ac)">Connect</strong> to add a chat model and get started.'
    } else {
      sub = 'Your AI chatbot, running locally on Comet.<br>Click <strong style="color:var(--ac)">Connect</strong> below to get started.'
    }

    const empty = mkEl('div', { id: 'empty' }, [
      mkEl('div', { class: 'empty-logo', style: 'padding:6px', html: LOGO_SVG }),
      mkEl('div', { class: 'empty-title' }, chat ? chat.title : 'Local Comet LLM (LCL)'),
      mkEl('div', { class: 'empty-sub', html: sub })
    ])
    if (firstRun) {
      empty.appendChild(mkEl('div', { class: 'hint-cards' },
        HINT_CARDS.map(h => mkEl('button', { class: 'hint-card', html: h.html, onclick: () => useHint(h.prompt) }))
      ))
    }
    el.innerHTML = ''
    el.appendChild(empty)
    return
  }

  const inner = document.createElement('div')
  inner.className = 'msgs-inner'
  chat.messages.forEach(m => {
    const t = typeof m.content === 'string' ? m.content : m.content?.find?.(b => b.type === 'text')?.text || '[attachment]'
    const div = buildMsgEl(m.role === 'user' ? 'user' : 'ai', t, new Date(m.ts), m.sources, m.fileNames, m.errored)
    inner.appendChild(div)
  })
  el.innerHTML = ''
  el.appendChild(inner)
  el.scrollTop = el.scrollHeight
  refreshTailActions()
}

function appendMsg(role, text, date, sources, fileNames, errored) {
  let inner = document.querySelector('.msgs-inner')
  if (!inner) {
    document.getElementById('messages').innerHTML = ''
    inner = document.createElement('div')
    inner.className = 'msgs-inner'
    document.getElementById('messages').appendChild(inner)
  }
  const div = buildMsgEl(role, text, date, sources, fileNames, errored)
  inner.appendChild(div)
  document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight
  refreshTailActions()
  return div
}

function buildMsgEl(role, text, date, sources, fileNames, errored) {
  const isUser = role === 'user'
  const time   = (date || new Date()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  // strip injected file content blocks from display - only show the user's actual typed text
  let displayText = text
  // Build a map of filename -> extracted content for expandable chips
  const fileContentMap = {}
  if (isUser) {
    const blockRe = /<file name="([^"]*)">([\s\S]*?)<\/file>/g
    let m
    while ((m = blockRe.exec(text)) !== null) fileContentMap[m[1]] = m[2].trim()
    displayText = text.replace(/<file name="[^"]*">[\s\S]*?<\/file>/g, '').trim()
  }

  const div = mkEl('div', { class: 'msg-group' })
  // Stash the raw markdown (or user text) so Copy grabs the original text,
  // not the rendered innerText.
  div.dataset.raw = isUser ? displayText : (text || '')

  // Header
  div.appendChild(mkEl('div', { class: 'msg-hdr' }, [
    mkEl('div', { class: 'msg-av ' + (isUser ? 'user' : 'ai') }, isUser ? 'U' : 'LCL'),
    (isUser
      ? mkEl('div', { class: 'msg-role' }, 'You')
      : mkEl('div', { class: 'msg-role', html: esc(creds?.model || 'LCL') + (typeof clsSuffix === 'function' ? clsSuffix(creds) : '') })),
    mkEl('div', { class: 'msg-time' }, time)
  ]))

  // Filename chips above the body — clickable to expand extracted content.
  if (fileNames && fileNames.length) {
    const chipsRow = mkEl('div', { class: 'msg-file-chips' })
    fileNames.forEach(f => {
      const hasContent = !!fileContentMap[f]
      const chip = mkEl('span', { class: 'msg-chip', title: hasContent ? 'Click to expand' : null })
      chip.appendChild(svgNode(ICON_CHIP_FILE))
      chip.appendChild(document.createTextNode(f))
      if (hasContent) {
        chip.appendChild(document.createTextNode(' '))
        chip.appendChild(svgNode(ICON_CHIP_CHEVRON))
        chip.addEventListener('click', e => toggleFileChip(e.currentTarget, f))
      }
      chipsRow.appendChild(chip)
    })
    div.appendChild(chipsRow)
    // The expand target must be chipsRow.nextElementSibling (see toggleFileChip).
    const expand = mkEl('div', { class: 'msg-file-expand hidden' })
    expand.dataset.fileContents = JSON.stringify(fileContentMap)
    div.appendChild(expand)
  }

  // Body: errored assistant replies go through the shared statusBox; everything
  // else through fmt() (marked + DOMPurify). Both return trusted/sanitised HTML.
  let bodyInner
  if (errored && !isUser) {
    const raw = String(text || ''); const dash = raw.indexOf(' — ')
    const title = dash > -1 ? raw.slice(0, dash) : raw
    const body  = dash > -1 ? raw.slice(dash + 3) : ''
    bodyInner = statusBox('err', title, esc(body))
  } else {
    bodyInner = fmt(displayText)
  }
  div.appendChild(mkEl('div', { class: 'msg-body', html: bodyInner }))

  // RAG source tags
  if (sources && sources.length) {
    div.appendChild(mkEl('div', { class: 'rag-row' },
      sources.map(s => mkEl('span', { class: 'rag-tag' }, String(s)))
    ))
  }

  // Action row: Copy always; Regenerate on assistant messages; Edit on user
  // messages (both hidden until refreshTailActions reveals the tail ones).
  const acts = mkEl('div', { class: 'msg-acts' })
  if (!(errored && !isUser)) {
    acts.appendChild(mkEl('button', { class: 'mact', title: 'Copy raw markdown to clipboard', onclick: e => copyMsg(e.currentTarget) }, 'Copy'))
    if (isUser) {
      acts.appendChild(mkEl('button', { class: 'mact edit-act', style: 'display:none', onclick: () => editLastUser() }, 'Edit'))
    } else {
      acts.appendChild(mkEl('button', { class: 'mact', title: 'Paste into Word or Outlook to preserve formatting (tables, bold, headings)', onclick: e => copyMsgHtml(e.currentTarget) }, 'Copy for Word / Outlook'))
      acts.appendChild(mkEl('button', { class: 'mact regen-act', style: 'display:none', title: 'Re-send the last message and get a new response', onclick: () => regenerateLast() }, 'Regenerate'))
    }
  }
  div.appendChild(acts)

  return div
}

// Show Edit button only on the last user message, and Regenerate only on the
// last assistant message. Called after any render that might change the tail.
function refreshTailActions() {
  const inner = document.querySelector('.msgs-inner')
  if (!inner) return
  inner.querySelectorAll('.edit-act, .regen-act').forEach(b => b.style.display = 'none')
  const groups = Array.from(inner.querySelectorAll('.msg-group'))
  // Last assistant
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i].querySelector('.msg-av.ai')) {
      const b = groups[i].querySelector('.regen-act')
      if (b) b.style.display = ''
      break
    }
  }
  // Last user
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i].querySelector('.msg-av.user')) {
      const b = groups[i].querySelector('.edit-act')
      if (b) b.style.display = ''
      break
    }
  }
}

function appendTyping() {
  let inner = document.querySelector('.msgs-inner')
  if (!inner) { inner = document.createElement('div'); inner.className = 'msgs-inner'; document.getElementById('messages').appendChild(inner) }
  const div = mkEl('div', { class: 'msg-group' }, [
    mkEl('div', { class: 'msg-hdr' }, [
      mkEl('div', { class: 'msg-av ai' }, 'LCL'),
      mkEl('div', { class: 'msg-role', html: esc(creds?.model || 'LCL') + (typeof clsSuffix === 'function' ? clsSuffix(creds) : '') })
    ]),
    mkEl('div', { class: 'msg-body' }, mkEl('div', { class: 'typing', html: '<span></span><span></span><span></span>' }))
  ])
  inner.appendChild(div)
  document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight
  return div
}

// ---------------------------------------------------------------------------
// merged from 73-render-docpanel.js
// ---------------------------------------------------------------------------

// =============================================================================
// Render — document (RAG) panel + embed button
// =============================================================================

function renderDocPanel() {
  const el   = document.getElementById('dp-body')
  const chat = curChat()
  const docs = chat?.docs||[]
  el.innerHTML = ''
  if (!docs.length) {
    el.append(mkEl('div', { class: 'dp-empty', html: 'No files attached.<br>Upload files to use as context for this chat.' }))
    return
  }
  for (const d of docs) {
    const ext   = (d.name.split('.').pop() || '').slice(0, 4).toUpperCase()
    const status = d.status || 'pending'
    const stCls = d.status === 'ready' ? 'ready' : d.status === 'error' ? 'error' : 'pending'
    el.append(mkEl('div', { class: 'doc-card' }, [
      mkEl('div', { class: 'doc-ext' }, ext),
      mkEl('div', { class: 'doc-inf' }, [
        mkEl('div', { class: 'doc-name' }, d.name),
        mkEl('div', { class: 'doc-sz' }, fmtSz(d.size) + ' * ' + (d.chunks?.length || 0) + ' chunks'),
        mkEl('span', { class: 'doc-st ' + stCls }, status),
      ]),
      mkEl('button', { class: 'doc-del', title: 'Remove', onclick: (e) => removeDoc(d.id, e) }, 'x'),
    ]))
  }
}

function updateDocsBtn() {
  const cnt = curChat()?.docs?.length||0
  const btn = document.getElementById('docs-btn')
  // Status dot reflects whether the embedding key is configured.
  // Green dot = embed key + model set; amber = missing (RAG won't work yet).
  const hasEmbed = !!(creds?.embedApiKey && creds?.embedModelId)
  btn.innerHTML = '<span class="embed-dot'+(hasEmbed?' on':'')+'"></span>Embed ('+cnt+')'
  btn.setAttribute('data-tip-bottom-left',
    hasEmbed ? 'Embedding configured — RAG ready' :
               'Embed API key not set — click to configure')
}
