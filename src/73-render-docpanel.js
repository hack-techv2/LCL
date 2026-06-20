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
