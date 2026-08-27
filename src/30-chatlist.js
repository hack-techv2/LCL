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
  // Finish-in-background: an in-flight reply keeps generating into its origin chat
  // (which has messages, so it is never the reused blank). Stop it explicitly with
  // the Stop button / Esc if you want to cancel.
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
  // Resync the health pill (see switchChat): don't leave a stale 'Replying' from a
  // reply that finished in the background.
  if (typeof setHealth === 'function' && typeof creds !== 'undefined' && creds) {
    if (busy) setHealth('warn', 'Replying — Stop to interrupt')
    else if (typeof connectedLabel === 'function') setHealth('ok', connectedLabel())
  }
  const inp = document.getElementById('msg-in')
  inp.value = ''; autoResize(inp); inp.focus()
}

function switchChat(id) {
  if (typeof lclCrumb === 'function') lclCrumb('switch_chat')
  // Finish-in-background: do NOT abort an in-flight reply on switch. runStream is
  // chat-scoped (writes to the live view only while its own chat is on screen), so
  // the reply keeps generating into its origin chat and is there when you switch
  // back. Use Stop (button / Esc) to actually cancel. (Was: stopStreaming(true),
  // which aborted and then leaked a (stopped)/error bubble into the chat you opened.)
  chatId = id
  ragStickyChunks = []
  renderAll()
  // Resync the health pill to the chat you're now viewing. A reply that finished in
  // the background left the pill on 'Replying' (its uiHealth was guarded while off
  // screen), so reflect reality: 'Replying' only while something is still generating.
  if (typeof setHealth === 'function' && typeof creds !== 'undefined' && creds) {
    if (busy) setHealth('warn', 'Replying — Stop to interrupt')
    else if (typeof connectedLabel === 'function') setHealth('ok', connectedLabel())
  }
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
  // Deleting a chat used to leave its in-flight work running: split-summary
  // bubbles kept appending into whichever chat became active, and its docs kept
  // embedding (spending budget). Abort the run if it belongs to this chat, and
  // cancel embeds for docs no other chat still references.
  const hadRun = (chatId === id && typeof inflightCtl !== 'undefined' && inflightCtl)
  if (typeof lclCrumb === 'function') lclCrumb('delete_chat', { hadDocs: hadDocs, abortedRun: !!hadRun })
  if (hadRun) { try { inflightCtl.abort() } catch {} }
  delete D.chats[id]
  if (chat && Array.isArray(chat.docs)) {
    for (const d of chat.docs) {
      const shared = Object.values(D.chats).some(ch => Array.isArray(ch.docs) && ch.docs.some(x => x.id === d.id))
      if (!shared) d._cancelled = true
    }
  }
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
  const cur = (D.chats[id] && D.chats[id].title) || ''
  // Built with DOM APIs, never innerHTML. A title can contain quotes and angle
  // brackets (e.g. markup echoed back by the titler); interpolating it into
  // value="..." closed the attribute early - the input rendered blank/mangled so
  // the rename could not take, and a crafted title could inject a live handler.
  item.textContent = ''
  const inp = document.createElement('input')
  inp.className = 'rename-input'
  inp.type = 'text'
  inp.value = cur
  // Enter commits directly rather than via blur(): blur() is a no-op when the
  // window has lost focus, which silently dropped the rename. Guarded so the
  // blur that follows a commit does not run finishRename twice.
  let settled = false
  const commit = () => { if (settled) return; settled = true; finishRename(id, inp) }
  inp.addEventListener('blur', commit)
  inp.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); commit() }
    else if (ev.key === 'Escape') { settled = true; renderChatList() }
  })
  item.appendChild(inp)
  inp.focus(); inp.select()
}

function finishRename(id, inp) {
  const val = inp.value.trim()
  if (val && D.chats[id]) mutate(D => { D.chats[id].title = val })
  renderChatList()
  renderTopbar()   // keep the title under the top header in sync with the rename
}

function curChat() { return chatId ? D.chats[chatId] : null }
