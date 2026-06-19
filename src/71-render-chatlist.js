// =============================================================================
// Render — sidebar chat list
// =============================================================================

function renderChatList() {
  const el    = document.getElementById('chat-list')
  const chats = sortedChats().filter(c => c.messages.length || (c.docs && c.docs.length))
  if (!chats.length) { el.innerHTML='<div style="padding:12px 10px;font-size:12px;color:var(--tx3)">No chats yet</div>'; return }

  const pinned   = chats.filter(c=>c.pinned)
  const unpinned = chats.filter(c=>!c.pinned)

  let html = ''

  if (pinned.length) {
    html += '<div class="section-lbl">Pinned</div>'
    html += pinned.map(c=>chatItemHTML(c)).join('')
  }

  // group unpinned by date
  const today     = new Date(); today.setHours(0,0,0,0)
  const yesterday = new Date(today); yesterday.setDate(today.getDate()-1)
  const week      = new Date(today); week.setDate(today.getDate()-7)

  const groups = [
    { label:'Today',          items: unpinned.filter(c=>new Date(c.updatedAt)>=today) },
    { label:'Yesterday',      items: unpinned.filter(c=>{ const d=new Date(c.updatedAt); return d>=yesterday&&d<today }) },
    { label:'Previous 7 days',items: unpinned.filter(c=>{ const d=new Date(c.updatedAt); return d>=week&&d<yesterday }) },
    { label:'Older',          items: unpinned.filter(c=>new Date(c.updatedAt)<week) },
  ]

  for (const g of groups) {
    if (!g.items.length) continue
    html += `<div class="section-lbl">${g.label}</div>`
    html += g.items.map(c=>chatItemHTML(c)).join('')
  }

  el.innerHTML = html
  setupChatTitleScroll()
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

function chatItemHTML(c) {
  return `<div class="chat-item ${c.id===chatId?'active':''} ${c.pinned?'pinned':''}" data-id="${c.id}" onclick="switchChat('${c.id}')">
    <div class="chat-avatar" title="${esc(c.title)}">${esc((c.title||'').trim().charAt(0).toUpperCase()||'?')}</div>
    <div class="chat-item-inner">
      <div class="chat-pin-dot"></div>
      <div class="chat-item-text" title="${esc(c.title)}">
        <div class="chat-title"><span class="chat-title-inner">${esc(c.title)}</span></div>
        <div class="chat-meta">${c.messages.length} msg${c.messages.length!==1?'s':''} * ${fmtDate(c.updatedAt)}</div>
      </div>
    </div>
    <div class="chat-actions">
      <button class="ca-btn pin-btn" onclick="togglePin('${c.id}',event)" data-tip="${c.pinned?'Unpin':'Pin'}">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="${c.pinned?'var(--pin)':'currentColor'}"><path d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z"/></svg>
      </button>
      <button class="ca-btn" onclick="startRename('${c.id}',event)" data-tip="Rename">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61zm1.414 1.06a.25.25 0 00-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 000-.354l-1.086-1.086zM11.189 6.25L9.75 4.81l-6.286 6.287a.25.25 0 00-.064.108l-.558 1.953 1.953-.558a.249.249 0 00.108-.064L11.189 6.25z"/></svg>
      </button>
      <button class="ca-btn del-btn" onclick="deleteChat('${c.id}',event)" data-tip="Delete">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M6.5 1.75a.25.25 0 01.25-.25h2.5a.25.25 0 01.25.25V3h-3V1.75zm4.5 0V3h2.25a.75.75 0 010 1.5H2.75a.75.75 0 010-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75zM4.496 6.675l.66 6.6a.25.25 0 00.249.225h5.19a.25.25 0 00.249-.225l.66-6.6a.75.75 0 011.492.149l-.66 6.6A1.748 1.748 0 0110.595 15h-5.19a1.75 1.75 0 01-1.741-1.575l-.66-6.6a.75.75 0 011.492-.15z"/></svg>
      </button>
    </div>
  </div>`
}
