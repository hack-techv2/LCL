// =============================================================================
// Render — chat messages (bubbles, file chips, RAG tags, typing)
// =============================================================================

function renderMessages() {
  const el   = document.getElementById('messages')
  const chat = curChat()

  if (!chat||!chat.messages.length) {
    const embModel = (creds && creds.embedModelId) || (D.settings && D.settings.embedModelId) || ''
    const embKey   = (creds && creds.embedApiKey)  || (D.settings && D.settings.embedApiKey)  || ''
    const embOk    = !!(embModel && embKey)
    // Example hint cards are first-run onboarding only: hide once the user
    // already has chat history (more than just this empty new chat).
    const firstRun = Object.keys(D.chats||{}).length <= 1
    const cap = ' — ask questions, write &amp; review code, summarise and draft documents.'
    const copyLine = '<br><em style="color:var(--tx2)">Copy any reply straight into Word or Outlook with formatting intact.</em>'
    let sub
    if (creds) {
      sub = 'Connected to <strong style="color:var(--ac)">' + esc(creds.model||'a model') + '</strong>' + clsSuffix(creds) + cap + copyLine + '<br>' +
        (embOk ? 'Embeddings ready (<strong style="color:var(--ac)">' + esc(embModel) + '</strong>) — attach files to chat over them.'
               : 'Add an embedding key in Settings to chat over your files.')
    } else if (embOk) {
      sub = 'Embeddings ready (<strong style="color:var(--ac)">' + esc(embModel) + '</strong>).<br>Click <strong style="color:var(--ac)">Connect</strong> to add a chat model and get started.'
    } else {
      sub = 'Your AI chatbot, running locally on Comet.<br>Click <strong style="color:var(--ac)">Connect</strong> below to get started.'
    }
    el.innerHTML = `<div id="empty">
      <div class="empty-logo" style="padding:6px"><svg width="20" height="20" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><line x1="10" y1="10" x2="2" y2="18" stroke="white" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/><line x1="11.5" y1="10" x2="4" y2="18" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.45"/><line x1="10" y1="11.5" x2="2" y2="20" stroke="white" stroke-width="0.6" stroke-linecap="round" opacity="0.28"/><rect x="9" y="1" width="11" height="11" rx="1.5" fill="white" opacity="0.95"/><rect x="11" y="3" width="7" height="7" rx="0.5" fill="#e8610a"/><line x1="13.3" y1="3" x2="13.3" y2="10" stroke="white" stroke-width="0.5" opacity="0.6"/><line x1="15.7" y1="3" x2="15.7" y2="10" stroke="white" stroke-width="0.5" opacity="0.6"/><line x1="11" y1="5.3" x2="18" y2="5.3" stroke="white" stroke-width="0.5" opacity="0.6"/><line x1="11" y1="7.7" x2="18" y2="7.7" stroke="white" stroke-width="0.5" opacity="0.6"/><line x1="12.5" y1="1" x2="12.5" y2="0" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.8"/><line x1="15" y1="1" x2="15" y2="0" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.8"/><line x1="17.5" y1="1" x2="17.5" y2="0" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.8"/><line x1="12.5" y1="12" x2="12.5" y2="13.5" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.8"/><line x1="15" y1="12" x2="15" y2="13.5" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.8"/><line x1="17.5" y1="12" x2="17.5" y2="13.5" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.8"/><line x1="20" y1="3.5" x2="21.5" y2="3.5" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.8"/><line x1="20" y1="6.5" x2="21.5" y2="6.5" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.8"/><line x1="20" y1="9.5" x2="21.5" y2="9.5" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.8"/><line x1="9" y1="3.5" x2="7.5" y2="3.5" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.8"/><line x1="9" y1="6.5" x2="7.5" y2="6.5" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.8"/><line x1="9" y1="9.5" x2="7.5" y2="9.5" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.8"/></svg></div>
      <div class="empty-title">${chat?chat.title:'Local Comet LLM (LCL)'}</div>
      <div class="empty-sub">${sub}</div>
      ${firstRun ? `<div class="hint-cards">
        <button class="hint-card" onclick="useHint('Summarise this document for me: ')"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 1.5A1.5 1.5 0 015.5 0h4.1a1.5 1.5 0 011.06.44l1.9 1.9A1.5 1.5 0 0113 3.41V14.5A1.5 1.5 0 0111.5 16h-6A1.5 1.5 0 014 14.5v-13zM6 6.5a.5.5 0 000 1h4a.5.5 0 000-1H6zm0 2.5a.5.5 0 000 1h4a.5.5 0 000-1H6zm0 2.5a.5.5 0 000 1h2a.5.5 0 000-1H6z"/></svg><span class="hint-card-title">Summarise a document</span><span class="hint-card-sub">Paste or attach a file</span></button>
        <button class="hint-card" onclick="useHint('Help me write a pentest report. ')"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 .6l5.4 2.1v4.2c0 3.4-2.3 6.5-5.4 7.4C4.9 13.4 2.6 10.3 2.6 6.9V2.7L8 .6z"/></svg><span class="hint-card-title">Write a pentest report</span><span class="hint-card-sub">Draft findings &amp; structure</span></button>
        <button class="hint-card" onclick="useHint('Explain this concept to me step by step: ')"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a4.5 4.5 0 00-2.7 8.1c.4.3.6.8.6 1.3v.6h4.2v-.6c0-.5.2-1 .6-1.3A4.5 4.5 0 008 1zM6 13h4v.4A1.6 1.6 0 018.4 15h-.8A1.6 1.6 0 016 13.4V13z"/></svg><span class="hint-card-title">Explain a concept</span><span class="hint-card-sub">Step-by-step breakdown</span></button>
      </div>` : ''}
    </div>`
    return
  }

  const inner = document.createElement('div')
  inner.className = 'msgs-inner'
  chat.messages.forEach(m => {
    const t = typeof m.content==='string'?m.content:m.content?.find?.(b=>b.type==='text')?.text||'[attachment]'
    const div = buildMsgEl(m.role==='user'?'user':'ai', t, new Date(m.ts), m.sources, m.fileNames)
    inner.appendChild(div)
  })
  el.innerHTML=''
  el.appendChild(inner)
  el.scrollTop=el.scrollHeight
  refreshTailActions()
}

function appendMsg(role, text, date, sources, fileNames) {
  let inner = document.querySelector('.msgs-inner')
  if (!inner) {
    document.getElementById('messages').innerHTML=''
    inner = document.createElement('div')
    inner.className='msgs-inner'
    document.getElementById('messages').appendChild(inner)
  }
  const div = buildMsgEl(role, text, date, sources, fileNames)
  inner.appendChild(div)
  document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight
  refreshTailActions()
  return div
}

function buildMsgEl(role, text, date, sources, fileNames) {
  const isUser = role==='user'
  const time   = (date||new Date()).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})
  const label  = isUser?'You':(creds?.model||'LCL')
  const srcHtml= (sources&&sources.length)?`<div class="rag-row">${sources.map(s=>`<span class="rag-tag">${s}</span>`).join('')}</div>`:''
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

  // show filename chips above the message body — clickable to expand content
  const fileChips = (fileNames && fileNames.length)
    ? `<div class="msg-file-chips">${fileNames.map(f => {
        const hasContent = !!fileContentMap[f]
        return `<span class="msg-chip" ${hasContent ? `onclick="toggleFileChip(this,'${esc(f)}')" title="Click to expand"` : ''}>
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2a2 2 0 012-2h8a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V2z"/></svg>
          ${esc(f)}${hasContent ? ' <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor"><path d="M8 10.94L1.53 4.47a.75.75 0 011.06-1.06L8 8.81l5.41-5.4a.75.75 0 111.06 1.06L8 10.94z"/></svg>' : ''}
        </span>`
      }).join('')}</div>
      <div class="msg-file-expand hidden" data-file-contents='${JSON.stringify(fileContentMap).replace(/'/g,"&#39;")}'></div>`
    : ''

  // Action row: Copy always; Regenerate on assistant messages; Edit on user messages.
  // The renderer sets `data-last-user` / `data-last-ai` on the final ones so the
  // specific buttons only show on the last matching message (cleaner UX).
  const acts = [
    `<button class="mact" onclick="copyMsg(this)" title="Copy raw markdown to clipboard">Copy</button>`,
    isUser
      ? `<button class="mact edit-act" onclick="editLastUser()" style="display:none">Edit</button>`
      : `<button class="mact" onclick="copyMsgHtml(this)" title="Paste into Word or Outlook to preserve formatting (tables, bold, headings)">Copy for Word / Outlook</button>
         <button class="mact regen-act" onclick="regenerateLast()" title="Re-send the last message and get a new response" style="display:none">Regenerate</button>`
  ].join('')

  const div = document.createElement('div')
  div.className='msg-group'
  // Stash the raw markdown (or user text) on the element so Copy can grab
  // the original text instead of the rendered innerText.
  div.dataset.raw = isUser ? displayText : (text || '')
  div.innerHTML=`
    <div class="msg-hdr">
      <div class="msg-av ${isUser?'user':'ai'}">${isUser?'U':'LCL'}</div>
      <div class="msg-role">${label}</div>
      <div class="msg-time">${time}</div>
    </div>
    ${fileChips}
    <div class="msg-body">${fmt(displayText)}</div>
    ${srcHtml}
    <div class="msg-acts">${acts}</div>`
  return div
}

// Show Edit button only on the last user message, and Regenerate only on the
// last assistant message. Called after any render that might change the tail.
function refreshTailActions() {
  const inner = document.querySelector('.msgs-inner')
  if (!inner) return
  inner.querySelectorAll('.edit-act, .regen-act').forEach(b => b.style.display='none')
  const groups = Array.from(inner.querySelectorAll('.msg-group'))
  // Last assistant
  for (let i=groups.length-1; i>=0; i--) {
    if (groups[i].querySelector('.msg-av.ai')) {
      const b = groups[i].querySelector('.regen-act')
      if (b) b.style.display=''
      break
    }
  }
  // Last user
  for (let i=groups.length-1; i>=0; i--) {
    if (groups[i].querySelector('.msg-av.user')) {
      const b = groups[i].querySelector('.edit-act')
      if (b) b.style.display=''
      break
    }
  }
}

function appendTyping() {
  let inner = document.querySelector('.msgs-inner')
  if (!inner) { inner=document.createElement('div'); inner.className='msgs-inner'; document.getElementById('messages').appendChild(inner) }
  const div=document.createElement('div'); div.className='msg-group'
  div.innerHTML=`<div class="msg-hdr"><div class="msg-av ai">LCL</div><div class="msg-role">${creds?.model||'LCL'}</div></div><div class="msg-body"><div class="typing"><span></span><span></span><span></span></div></div>`
  inner.appendChild(div); document.getElementById('messages').scrollTop=document.getElementById('messages').scrollHeight
  return div
}
