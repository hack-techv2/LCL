// =============================================================================
// Render — document (RAG) panel + embed button
// =============================================================================

function renderDocPanel() {
  const el   = document.getElementById('dp-body')
  const chat = curChat()
  const docs = chat?.docs||[]
  if (!docs.length) { el.innerHTML='<div class="dp-empty">No files attached.<br>Upload files to use as context for this chat.</div>'; return }
  el.innerHTML = docs.map(d=>`
    <div class="doc-card">
      <div class="doc-ext">${esc(d.name.split('.').pop().slice(0,4).toUpperCase())}</div>
      <div class="doc-inf">
        <div class="doc-name">${esc(d.name)}</div>
        <div class="doc-sz">${fmtSz(d.size)} * ${d.chunks?.length||0} chunks</div>
        <span class="doc-st ${d.status==='ready'?'ready':d.status==='error'?'error':'pending'}">${d.status||'pending'}</span>
      </div>
      <button class="doc-del" onclick="removeDoc('${d.id}',event)">x</button>
    </div>`).join('')
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
