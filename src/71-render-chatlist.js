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
