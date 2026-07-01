// =============================================================================
// Chats
// =============================================================================
function sortedChats() {
  const all = Object.values(D.chats)
  const pinned   = all.filter(c=>c.pinned).sort((a,b)=>b.updatedAt-a.updatedAt)
  const unpinned = all.filter(c=>!c.pinned).sort((a,b)=>b.updatedAt-a.updatedAt)
  return [...pinned, ...unpinned]
}

function newChat() {
  if (typeof lclCrumb === 'function') lclCrumb('new_chat')
  stopStreaming(true)
  // A chat is "blank" only with no messages AND no embedded docs. Reuse an
  // existing blank instead of piling up empties, and prune any extra blanks.
  const isBlank = c => !c.messages.length && !(c.docs && c.docs.length)
  const blanks = Object.values(D.chats).filter(isBlank)
  let id
  if (blanks.length) {
    id = blanks[0].id
    blanks.slice(1).forEach(c => delete D.chats[c.id])
  } else {
    id = 'chat_' + Date.now()
    D.chats[id] = { id, title:'New chat', messages:[], docs:[], pinned:false, createdAt:Date.now(), updatedAt:Date.now() }
  }
  chatId = id
  ragStickyChunks = []
  persist()
  renderAll()
  const inp = document.getElementById('msg-in')
  inp.value = ''; autoResize(inp); inp.focus()
}

function switchChat(id) {
  if (typeof lclCrumb === 'function') lclCrumb('switch_chat')
  stopStreaming(true)
  chatId = id
  ragStickyChunks = []
  renderAll()
  const inp = document.getElementById('msg-in')
  inp.value = ''; autoResize(inp); inp.focus()
}

function togglePin(id, e) {
  e.stopPropagation()
  mutate(D => { D.chats[id].pinned = !D.chats[id].pinned })
  renderChatList()
  toast(D.chats[id].pinned ? 'Pinned' : 'Unpinned', 'ok')
}

async function deleteChat(id, e) {
  if (e) e.stopPropagation()
  const chat = D.chats[id]
  const hadDocs = !!(chat && Array.isArray(chat.docs) && chat.docs.length)
  // v0.67e item 9: confirm before delete (reuses alpha confirmDialog), then
  // prune orphaned embeddings via GC and toast when the chat had docs.
  const ok = await confirmDialog({
    title: 'Delete chat?',
    message: 'Permanently delete \u201c' + (chat?.title || 'this chat') + '\u201d' + (hadDocs ? ' and prune its embeddings' : '') + '? This cannot be undone.',
    okText: 'Delete', cancelText: 'Cancel'
  })
  if (!ok) return
  if (typeof lclCrumb === 'function') lclCrumb('delete_chat', { hadDocs: hadDocs })
  delete D.chats[id]
  const afterDelete = () => {
    if (hadDocs) {
      gcEmbedCache().catch(err => console.warn('[deleteChat] gc', err.message))
      toast('Deleted chat and pruned embeddings', 'ok')
    }
  }
  if (chatId === id) {
    const remaining = sortedChats().filter(c => c.messages.length || (c.docs && c.docs.length))
    if (remaining.length) { chatId = remaining[0].id; persist(); renderAll() }
    else { newChat() }   // blank, unlisted, ready to type
    afterDelete()
    return
  }
  persist(); renderChatList()
  afterDelete()
}

function startRename(id, e) {
  e.stopPropagation()
  const item = document.querySelector(`.chat-item[data-id="${id}"] .chat-title`)
  if (!item) return
  const cur = D.chats[id].title
  item.innerHTML = `<input class="rename-input" value="${cur}" onblur="finishRename('${id}',this)" onkeydown="if(event.key==='Enter')this.blur();if(event.key==='Escape'){this.value='${cur}';this.blur()}">`
  const inp = item.querySelector('input')
  inp.focus(); inp.select()
}

function finishRename(id, inp) {
  const val = inp.value.trim()
  if (val && D.chats[id]) mutate(D => { D.chats[id].title = val })
  renderChatList()
  renderTopbar()   // keep the title under the top header in sync with the rename
}

function curChat() { return chatId ? D.chats[chatId] : null }
