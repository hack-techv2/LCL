// =============================================================================
// Search across chats
// =============================================================================
let searchSelIdx = 0
let searchResults = []

function openSearch() {
  document.getElementById('search-bd').classList.remove('hidden')
  const inp = document.getElementById('search-inp')
  inp.value = ''
  runSearch()
  setTimeout(()=>inp.focus(), 30)
}

function closeSearch() {
  document.getElementById('search-bd').classList.add('hidden')
}

function runSearch() {
  const q = document.getElementById('search-inp').value.trim().toLowerCase()
  const out = document.getElementById('search-results')
  searchResults = []
  searchSelIdx = 0

  const chats = Object.values(D.chats)
  if (!q) {
    // Empty query: show recent chats.
    const recent = chats.sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,20)
    searchResults = recent.map(c => ({ chatId: c.id, title: c.title, snippet: c.messages.length+' msgs', msgIdx: null }))
  } else {
    for (const c of chats) {
      const titleHit = c.title.toLowerCase().includes(q)
      if (titleHit) searchResults.push({ chatId: c.id, title: c.title, snippet: '(title)', msgIdx: null, matchField: 'title' })
      for (let i=0; i<c.messages.length; i++) {
        const m = c.messages[i]
        const t = typeof m.content==='string' ? m.content : (m.content?.find?.(b=>b.type==='text')?.text || '')
        const idx = t.toLowerCase().indexOf(q)
        if (idx !== -1) {
          const start = Math.max(0, idx-30)
          const snip = (start>0?'...':'') + t.slice(start, idx+q.length+60) + (idx+q.length+60<t.length?'...':'')
          searchResults.push({ chatId: c.id, title: c.title, snippet: snip, msgIdx: i, matchField: 'body', role: m.role })
          if (searchResults.length > 100) break
        }
      }
      if (searchResults.length > 100) break
    }
  }

  if (!searchResults.length) {
    out.innerHTML = '<div class="search-empty">No matches</div>'
    return
  }
  const mark = (s, q) => {
    if (!q) return esc(s)
    const re = new RegExp('('+q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','ig')
    return esc(s).replace(re, '<mark>$1</mark>')
  }
  out.innerHTML = searchResults.map((res, i) => `
    <div class="search-res ${i===searchSelIdx?'sel':''}" onclick="pickSearchResult(${i})">
      <div class="search-res-title">${mark(res.title, q)}</div>
      <div class="search-res-snip">${mark(res.snippet, q)}</div>
    </div>`).join('')
}

function handleSearchKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeSearch(); return }
  if (e.key === 'Enter') { e.preventDefault(); if (searchResults[searchSelIdx]) pickSearchResult(searchSelIdx) }
}

function pickSearchResult(i) {
  const res = searchResults[i]
  if (!res) return
  switchChat(res.chatId)
  closeSearch()
  if (res.msgIdx != null) {
    setTimeout(() => {
      const groups = document.querySelectorAll('.msg-group')
      if (groups[res.msgIdx]) {
        groups[res.msgIdx].scrollIntoView({ behavior:'smooth', block:'center' })
        groups[res.msgIdx].style.background = 'var(--acbg)'
        setTimeout(()=>groups[res.msgIdx].style.background = '', 1500)
      }
    }, 80)
  }
}

