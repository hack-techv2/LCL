// =============================================================================
// RAG — chunking, hashing, embedding, retrieval
// =============================================================================

// ---------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------
function cosine(a, b) {
  let dot=0, na=0, nb=0
  for (let i=0; i<a.length; i++) { dot+=a[i]*b[i]; na+=a[i]*a[i]; nb+=b[i]*b[i] }
  return dot / (Math.sqrt(na)*Math.sqrt(nb) + 1e-10)
}

function chunkText(text, size, overlap) {
  size=size||800; overlap=overlap||150
  const chunks=[]; let i=0
  while (i<text.length) {
    const end=Math.min(i+size, text.length)
    chunks.push(text.slice(i,end).trim())
    if (end===text.length) break
    i+=size-overlap
  }
  return chunks.filter(c=>c.length>40)
}

// ---------------------------------------------------------------------------
// Hashing — Web Crypto SHA-1 → 16-char base64url (matches server hashText)
// ---------------------------------------------------------------------------
async function hashText(s) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s))
  const arr = Array.from(new Uint8Array(buf))
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    .slice(0, 16)
}

// ---------------------------------------------------------------------------
// embedBatch — send texts to /api/embed-batch; returns vectors in input order.
// Full cache hit → plain JSON; partial / full miss → SSE with progress toasts.
// ---------------------------------------------------------------------------
async function embedBatch(texts) {
  const embedModel = creds?.embedModelId
  if (!embedModel) throw new Error('No embedding model configured')

  return new Promise((resolve, reject) => {
    fetch('/api/embed-batch', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        apiKey:  creds?.embedApiKey,
        modelId: embedModel,
        inputs:  texts
      })
    }).then(async res => {
      const contentType = res.headers.get('content-type') || ''

      if (contentType.includes('application/json')) {
        const data = await res.json()
        if (!res.ok) return reject(new Error('Embed failed: ' + (data.error || res.status)))
        return resolve({ embeddings: data.embeddings, hashes: data.hashes })
      }

      if (!contentType.includes('text/event-stream')) {
        return reject(new Error('Unexpected content-type: ' + contentType))
      }

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let   buffer  = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          let evt
          try { evt = JSON.parse(line.slice(6)) } catch { continue }
          if (evt.type === 'progress') {
            toast('Embedding... batch ' + evt.batchDone + '/' + evt.batchTotal
              + '  (' + evt.done + '/' + evt.total + ' chunks)', 'info')
            if (typeof setHealth === 'function') setHealth('warn', 'Embedding ' + evt.done + '/' + evt.total)
          } else if (evt.type === 'pacing') {
            // Server is waiting out the API rate-limit window. Make the pause
            // obvious so the UI doesn't look frozen.
            toast('⏳ API rate limit reached — resuming embedding in ~' + evt.waitSec + 's'
              + ' (' + evt.done + '/' + evt.total + ' done)', 'info')
            if (typeof setHealth === 'function') setHealth('warn', 'Rate limit — resuming in ' + evt.waitSec + 's')
          } else if (evt.type === 'done') {
            return resolve({ embeddings: evt.embeddings, hashes: evt.hashes })
          } else if (evt.type === 'error') {
            return reject(new Error(evt.message))
          }
        }
      }
      reject(new Error('SSE stream ended without a done event'))
    }).catch(reject)
  })
}

// ---------------------------------------------------------------------------
// retrieveChunks — embed query, lookup chunk vectors by hash, rank + merge
// with sticky chunks from the previous turn (30% of topK slots).
// ---------------------------------------------------------------------------
async function retrieveChunks(query, docs, topK, stickyChunks) {
  const all = []
  for (const d of docs) {
    if (!d.chunks) continue
    for (const ch of d.chunks) {
      // Back-compat: older builds mistakenly stored the vector itself in embHash.
      const legacyVec = Array.isArray(ch.embHash) ? ch.embHash : null
      const hashStr   = (typeof ch.embHash === 'string') ? ch.embHash : null
      if (hashStr || ch.embedding || legacyVec) {
        all.push({ docName: d.name, text: ch.text, embHash: hashStr, embedding: ch.embedding || legacyVec || null })
      }
    }
  }
  if (!all.length) return []

  // Fetch vectors for hash-only chunks (live in server cache, not client memory)
  const needLookup = all.filter(c => c.embHash && !c.embedding)
  if (needLookup.length) {
    try {
      const r    = await fetch('/api/embed-lookup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hashes: needLookup.map(c => c.embHash) })
      })
      const data = await r.json()
      for (let i = 0; i < needLookup.length; i++) {
        needLookup[i].embedding = data.vectors[i]
      }
    } catch (e) {
      console.warn('[retrieveChunks] lookup failed:', e.message)
    }
  }

  const { embeddings: queryEmbeddings } = await embedBatch([query])
  const qe = queryEmbeddings[0]

  const scored = all
    .filter(c => c.embedding)
    .map(c => ({ docName: c.docName, text: c.text, score: cosine(qe, c.embedding) }))
    .sort((a, b) => b.score - a.score)

  // Reserve 30% of slots for sticky chunks from the prior turn
  const stickySlots = Math.max(1, Math.floor(topK * 0.3))
  const freshSlots  = topK - stickySlots
  const freshChunks = scored.slice(0, freshSlots)

  const freshTexts = new Set(freshChunks.map(c => c.text))
  const carried    = (stickyChunks || [])
    .filter(c => !freshTexts.has(c.text))
    .slice(0, stickySlots)

  return [...freshChunks, ...carried]
}

// ---------------------------------------------------------------------------
// evictDocFromCache — remove a document's vectors from the server cache
// ---------------------------------------------------------------------------
async function evictDocFromCache(doc) {
  if (!Array.isArray(doc?.chunks)) return
  const hashes = doc.chunks.map(c => c.embHash).filter(Boolean)
  if (!hashes.length) return
  try {
    await fetch('/api/embed-evict', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes })
    })
  } catch (e) {
    console.warn('[evictDocFromCache]', e.message)
  }
}