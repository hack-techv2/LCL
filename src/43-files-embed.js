async function embedDoc(doc) {
  // Embeds doc chunks via /api/embed-batch (SSE or cached JSON).
  // Only the 16-char SHA-1 hash is stored per chunk (embHash) — the actual
  // vector lives in the server's binary cache (embed_cache.bin).
  try {
    if (!creds?.embedApiKey || !creds?.embedModelId) {
      throw new Error('Embedding API key / model not configured')
    }
    const embedModel = creds.embedModelId
    const size = creds.chunkSize || 800
    const raw  = chunkText(doc.content, size, Math.floor(size * 0.2))
    if (!raw.length) {
      doc.chunks = []; doc.status = 'ready'
      toast(doc.name + ' ready (no chunks)', 'ok')
      renderDocPanel(); return
    }

    setHealth('warn', 'Embedding 0/' + raw.length)

    // Re-use existing embHash for chunks that haven't changed
    const existing = Array.isArray(doc.chunks) ? doc.chunks : []
    const chunks   = new Array(raw.length).fill(null)
    const toEmbed  = [], toEmbedIdx = []

    for (let i = 0; i < raw.length; i++) {
      if (existing[i]?.text === raw[i] && existing[i]?.embHash) {
        chunks[i] = { text: raw[i], embHash: existing[i].embHash }
      } else {
        toEmbed.push(raw[i]); toEmbedIdx.push(i)
      }
    }

    if (toEmbed.length) {
      // embedBatch handles SSE progress toasts internally
      const { hashes } = await embedBatch(toEmbed)
      for (let k = 0; k < toEmbedIdx.length; k++) {
        chunks[toEmbedIdx[k]] = { text: toEmbed[k], embHash: hashes[k] }
      }
    }

    doc.chunks = chunks.filter(Boolean)
    doc.status = 'ready'
    persist()
    setHealth('ok', connectedLabel())
    toast(doc.name + ' embedded (' + doc.chunks.length + ' chunks)', 'ok')
    renderDocPanel()
  } catch (e) {
    doc.status = 'error'
    doc.error  = e.message
    toast('Embed failed: ' + e.message, 'err')
    setHealth('ok', connectedLabel())
    renderDocPanel()
  }
}
// Remove an embedded document: evict its vectors, drop it from chat.docs,
// persist, and refresh the panel.
async function removeDoc(id, event) {
  if (event) event.stopPropagation()
  const chat = curChat(); if (!chat || !Array.isArray(chat.docs)) return
  const idx = chat.docs.findIndex(d => d.id === id)
  if (idx === -1) return
  const doc = chat.docs[idx]
  chat.docs.splice(idx, 1)
  await persist()                                  // server now has the updated doc list
  try { await gcEmbedCache() } catch (e) { console.warn('[removeDoc]', e.message) }  // prune vectors no longer referenced
  renderDocPanel(); updateDocsBtn()
  toast('Removed ' + doc.name, 'ok')
}
