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
  const label  = isUser ? 'You' : ((creds?.model || 'LCL') + (typeof clsSuffix === 'function' ? clsSuffix(creds) : ''))

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
    mkEl('div', { class: 'msg-role' }, label),
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
  const role = (creds?.model || 'LCL') + (typeof clsSuffix === 'function' ? clsSuffix(creds) : '')
  const div = mkEl('div', { class: 'msg-group' }, [
    mkEl('div', { class: 'msg-hdr' }, [
      mkEl('div', { class: 'msg-av ai' }, 'LCL'),
      mkEl('div', { class: 'msg-role' }, role)
    ]),
    mkEl('div', { class: 'msg-body' }, mkEl('div', { class: 'typing', html: '<span></span><span></span><span></span>' }))
  ])
  inner.appendChild(div)
  document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight
  return div
}
