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

function chunkTextWithOffsets(text, size, overlap) {
  text = String(text || '')
  size = size || CFG.DEFAULT_CHUNK_SIZE
  overlap = Math.min(overlap || Math.floor(size * CFG.CHUNK_OVERLAP_RATIO), Math.floor(size * 0.5))
  const chunks = []
  let i = 0
  while (i < text.length) {
    const end = Math.min(i + size, text.length)
    const raw = text.slice(i, end)
    const trimmed = raw.trim()
    if (trimmed.length > (CFG.MIN_CHUNK_CHARS || 40)) {
      const leading = raw.length - raw.trimStart().length
      chunks.push({ text: trimmed, start: i + leading, end })
    }
    if (end === text.length) break
    i += Math.max(1, size - overlap)
  }
  return chunks
}

function normalizeRagText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

function normalizeSearchPhrase(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[_\-]+/g, ' ')
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function titleCaseCandidate(s) {
  return String(s || '')
    .replace(/^#+\s*/, '')
    .replace(/^===\s*|\s*===$/g, '')
    .replace(/^\d+(?:\.\d+)*[a-z]?\s*[).:-]?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseSectionNumber(title) {
  const raw = String(title || '').replace(/^#+\s*/, '').trim()
  const m = raw.match(/^(?:(?:section|sections|clause|clauses|point|points|part|article|item|para|paragraph|subsection)\s*)?(\d+(?:\.\d+)*[a-z]?)(?=\s|[).:-]|$)/i)
  return m ? m[1].toLowerCase() : null
}

function sectionDepthFromNo(no) {
  no = String(no || '').trim()
  return no ? no.split('.').length : null
}

function parentSectionNo(no) {
  no = String(no || '').trim()
  if (!no || !no.includes('.')) return null
  return no.split('.').slice(0, -1).join('.')
}

function sectionRefMatches(sectionNo, ref) {
  sectionNo = String(sectionNo || '').toLowerCase().trim()
  ref = String(ref || '').toLowerCase().trim()
  return !!sectionNo && !!ref && (sectionNo === ref || sectionNo.startsWith(ref + '.'))
}

function extractSectionRefs(q) {
  const refs = []
  const seen = new Set()
  const re = /\b(?:section|sections|clause|clauses|point|points|part|article|item|para|paragraph|subsection)\s*(?:no\.?|number|#)?\s*(\d+(?:\.\d+)*[a-z]?)\b/gi
  let m
  while ((m = re.exec(q || ''))) {
    const v = m[1].toLowerCase()
    if (!seen.has(v)) { seen.add(v); refs.push(v) }
  }
  return refs
}

function enrichSectionMeta(section) {
  const sectionNo = section?.sectionNo || parseSectionNumber(section?.title) || parseSectionNumber(section?.text)
  const depth = sectionDepthFromNo(sectionNo)
  return {
    ...section,
    sectionNo: sectionNo || null,
    sectionDepth: depth,
    parentSectionNo: sectionNo ? parentSectionNo(sectionNo) : null
  }
}

function inferHeadingNumbers(text) {
  const lines = String(text || '').split('\n')
  const headings = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+)$/)
    if (m) headings.push({ i, level: m[1].length, title: m[2].trim() })
  }
  if (headings.length < 3) return text
  const numbered = headings.filter(h => parseSectionNumber(h.title)).length
  if (numbered >= Math.max(2, Math.ceil(headings.length * 0.25))) return text

  let start = 0
  const h1s = headings.filter(h => h.level === 1)
  if (h1s.length > 1) {
    const first = normalizeSearchPhrase(h1s[0].title)
    if (first.length > 70 || /\b(code of practice|annual report|report|handbook|manual|standard|guideline|revision|edition|policy document)\b/.test(first)) {
      start = headings.findIndex(h => h.i === h1s[1].i)
    }
  }

  const nums = []
  for (let hi = 0; hi < headings.length; hi++) {
    const h = headings[hi]
    const m = lines[h.i].match(/^(#{1,6})\s+(.+)$/)
    if (!m) continue
    const currentNo = parseSectionNumber(m[2])
    if (currentNo) {
      const parts = currentNo.split('.').map(x => parseInt(x, 10)).filter(n => Number.isFinite(n))
      for (let j = 0; j < parts.length; j++) nums[j] = parts[j]
      nums.length = parts.length
      continue
    }
    if (hi < start) continue
    const level = h.level
    for (let j = 0; j < level - 1; j++) if (!nums[j]) nums[j] = 1
    nums[level - 1] = (nums[level - 1] || 0) + 1
    nums.length = level
    const no = nums.join('.')
    lines[h.i] = m[1] + ' ' + no + ' ' + m[2].trim()
  }
  return lines.join('\n')
}

function acronymFromPhrase(s) {
  const words = normalizeSearchPhrase(s).split(' ').filter(w => w && !/^\d/.test(w))
  if (words.length < 2) return ''
  const ac = words.map(w => w[0]).join('')
  return ac.length >= 2 && ac.length <= 12 ? ac : ''
}

function firstDocTitle(doc) {
  const sections = Array.isArray(doc?.sections) ? doc.sections : []
  for (const s of sections.slice(0, 6)) {
    const t = titleCaseCandidate(s?.title || '')
    if (t && t.toLowerCase() !== 'document') return t
  }
  const m = String(doc?.content || '').match(/^#{1,2}\s+(.+)$/m)
  return m ? titleCaseCandidate(m[1]) : ''
}

function buildDocAliases(doc) {
  const values = []
  const add = v => {
    v = normalizeSearchPhrase(v)
    if (v && v.length >= 2 && !values.includes(v)) values.push(v)
  }
  const name = String(doc?.name || '')
  const base = name.replace(/\.[^.]+$/, '')
  add(name); add(base)
  base.split(/[\s_\-()[\]{}]+/).forEach(add)
  add(acronymFromPhrase(base))
  const title = firstDocTitle(doc)
  add(title); add(acronymFromPhrase(title))
  if (Array.isArray(doc?.docAliases)) doc.docAliases.forEach(add)
  if (Array.isArray(doc?.aliases)) doc.aliases.forEach(add)
  return values
}

function docAliasesText(doc) {
  return buildDocAliases(doc).join(' ')
}

function analyzeRagQuery(query, docs) {
  const terms = tokenizeQuery(query)
  const sectionRefs = extractSectionRefs(query)
  const structuralTerms = new Set(['section','sections','clause','clauses','point','points','part','article','item','para','paragraph','subsection'])
  const docTerms = terms.filter(t => !/^\d/.test(t) && !structuralTerms.has(t))
  const qNorm = normalizeSearchPhrase(query)
  const docMatches = []
  for (const doc of docs || []) {
    const aliases = buildDocAliases(doc)
    const name = normalizeSearchPhrase(doc?.name || '')
    let score = 0
    for (const a of aliases) {
      if (!a || a.length < 2) continue
      if (qNorm === a) score += 12
      else if (qNorm.includes(a) && a.length >= 3) score += Math.min(10, 2 + a.length / 3)
    }
    for (const t of docTerms) {
      if (hasTerm(name, t)) score += 4
      if (aliases.some(a => hasTerm(a, t) || a === t)) score += 5
    }
    if (score > 0) docMatches.push({ doc, score })
  }
  docMatches.sort((a, b) => b.score - a.score)
  return { query, terms, sectionRefs, docTerms, docMatches }
}

function narrowDocsForQuery(plan, docs) {
  docs = docs || []
  const matches = plan?.docMatches || []
  if (!matches.length) return docs
  const best = matches[0].score
  const floor = Math.max(4, best * 0.45)
  const picked = matches.filter(m => m.score >= floor).map(m => m.doc)
  return picked.length ? picked : docs
}

function splitIntoRagSections(text) {
  text = normalizeRagText(text)
  const lines = text.split('\n')
  const sections = []
  let pageNum = null
  let headingPath = []
  let cur = null
  let charCursor = 0

  function startSection(title, kind) {
    flush()
    cur = { title: title || 'Document', kind: kind || 'body', headingPath: headingPath.slice(), pageStart: pageNum, pageEnd: pageNum, lines: [], charStart: charCursor }
    if (title) cur.lines.push(title)
  }
  function flush() {
    if (!cur) return
    const body = cur.lines.join('\n').trim()
    if (body.length >= (CFG.MIN_SECTION_CHARS || 120) || !sections.length) {
      sections.push(enrichSectionMeta({
        sectionIndex: sections.length,
        sectionId: 'sec_' + sections.length,
        title: cur.title || 'Document',
        kind: cur.kind || 'body',
        headingPath: cur.headingPath || [],
        pageStart: cur.pageStart,
        pageEnd: cur.pageEnd,
        charStart: cur.charStart || 0,
        charEnd: cur.charStart + body.length,
        text: body
      }))
    } else if (sections.length) {
      sections[sections.length - 1].text += '\n' + body
      sections[sections.length - 1].charEnd += body.length + 1
      sections[sections.length - 1].pageEnd = cur.pageEnd || sections[sections.length - 1].pageEnd
    }
    cur = null
  }

  for (const line of lines) {
    const t = line.trim()
    const pageM = t.match(/^===\s*Page\s+(\d+)\s*===/i)
    const structuralM = t.match(/^===\s*(Slide\s+\d+|Sheet:\s*.+?)\s*===/i)
    const headingM = t.match(/^(#{1,6})\s+(.+)$/)

    if (pageM) {
      pageNum = parseInt(pageM[1], 10)
      startSection(t, 'page')
    } else if (structuralM) {
      startSection(t, 'structure')
    } else if (headingM) {
      const level = headingM[1].length
      const heading = headingM[2].trim()
      headingPath = headingPath.slice(0, Math.max(0, level - 1))
      headingPath[level - 1] = heading
      headingPath = headingPath.filter(Boolean)
      startSection(t, 'heading')
    } else {
      if (!cur) startSection(headingPath[headingPath.length - 1] || 'Document', 'body')
      cur.lines.push(line)
      if (pageNum) cur.pageEnd = pageNum
    }
    charCursor += line.length + 1
  }
  flush()

  if (!sections.length && text) {
    sections.push(enrichSectionMeta({ sectionIndex: 0, sectionId: 'sec_0', title: 'Document', kind: 'body', headingPath: [], pageStart: null, pageEnd: null, charStart: 0, charEnd: text.length, text }))
  }
  return sections
}

function makeRagChunks(doc, size) {
  const sections = splitIntoRagSections(doc.content || '')
  doc.sections = sections.map((s, i) => enrichSectionMeta({ ...s, sectionId: s.sectionId || ('sec_' + i), sectionIndex: i }))
  doc.docAliases = buildDocAliases(doc)

  const chunks = []
  const overlap = Math.floor(size * (CFG.CHUNK_OVERLAP_RATIO || 0.2))
  for (const sec of doc.sections) {
    const childParts = sec.text.length <= Math.floor(size * 1.35)
      ? [{ text: sec.text, start: 0, end: sec.text.length }]
      : chunkTextWithOffsets(sec.text, size, overlap)
    for (let j = 0; j < childParts.length; j++) {
      const part = childParts[j]
      chunks.push({
        text: part.text,
        docId: doc.id,
        docName: doc.name,
        chunkIndex: chunks.length,
        chunkIndexInSection: j,
        sectionId: sec.sectionId,
        sectionIndex: sec.sectionIndex,
        sectionNo: sec.sectionNo || null,
        sectionDepth: sec.sectionDepth || null,
        parentSectionNo: sec.parentSectionNo || null,
        sectionTitle: sec.title,
        headingPath: sec.headingPath || [],
        pageStart: sec.pageStart,
        pageEnd: sec.pageEnd,
        charStart: sec.charStart + (part.start || 0),
        charEnd: sec.charStart + (part.end || part.text.length)
      })
    }
  }
  return chunks
}

function makeChunkId(doc, rec, i, embHash) {
  return [doc.id || 'doc', rec.sectionId || 'sec', i, embHash || 'nohash'].join(':')
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
async function embedBatch(texts, onProgress) {
  const embedModel = creds?.embedModelId
  if (!embedModel) throw new Error('No embedding model configured')
  if (!creds?.embedApiKey) throw new Error('No embedding API key configured')

  const inputs = (texts || []).map(t => String(t || '')).filter(t => t.trim())
  if (!inputs.length) return { embeddings: [], hashes: [], storeVectors: false }

  const MAX_POST_TEXTS = 1500
  const MAX_POST_CHARS = 8 * 1024 * 1024

  function shortBody(t) {
    return String(t || '').replace(/\s+/g, ' ').trim().slice(0, 700)
  }

  function isVector(v) {
    return Array.isArray(v) && v.length > 0 && v.every(n => typeof n === 'number' && Number.isFinite(n))
  }

  function extractEmbeddingsFromAnyJson(data) {
    if (!data) return []
    if (Array.isArray(data.data)) {
      const rows = data.data.slice().sort((a, b) => (a?.index ?? 0) - (b?.index ?? 0))
      const vecs = rows.map(r => r && r.embedding).filter(isVector)
      if (vecs.length) return vecs
    }
    if (Array.isArray(data.embeddings)) {
      if (isVector(data.embeddings)) return [data.embeddings]
      const vecs = data.embeddings.filter(isVector)
      if (vecs.length) return vecs
    }
    if (isVector(data.embedding)) return [data.embedding]
    const candidates = [data.output, data.result, data.results, data.response]
    for (const c of candidates) {
      if (!c) continue
      if (isVector(c.embedding)) return [c.embedding]
      if (isVector(c)) return [c]
      if (Array.isArray(c)) {
        const vecs = c.map(x => (x && x.embedding) || x).filter(isVector)
        if (vecs.length) return vecs
      }
    }
    return []
  }

  function embedErrorFromJson(data, status) {
    const msg = data?.error?.message || data?.error || data?.message || data?.detail || ('HTTP ' + status)
    return typeof msg === 'string' ? msg : JSON.stringify(msg)
  }

  function splitEmbedInputs(items) {
    const groups = []
    let cur = []
    let chars = 0
    for (const item of items) {
      const len = item.length
      if (cur.length && (cur.length >= MAX_POST_TEXTS || chars + len > MAX_POST_CHARS)) {
        groups.push(cur)
        cur = []
        chars = 0
      }
      cur.push(item)
      chars += len
    }
    if (cur.length) groups.push(cur)
    return groups
  }

  async function normaliseBatchResult(result, expectedInputs) {
    const embeddings = Array.isArray(result?.embeddings) ? result.embeddings : []
    if (embeddings.length !== expectedInputs.length) {
      throw new Error('Embed response count mismatch: got ' + embeddings.length + ', expected ' + expectedInputs.length)
    }
    const hashes = Array.isArray(result?.hashes) && result.hashes.length === expectedInputs.length
      ? result.hashes
      : await Promise.all(expectedInputs.map(t => hashText(embedModel + ':' + t)))
    return { embeddings, hashes }
  }

  async function embedBatchRequest(batchInputs, groupNum, groupTotal) {
    if (groupTotal > 1 && !onProgress) {
      toast('Embedding request group ' + groupNum + '/' + groupTotal + ' (' + batchInputs.length + ' chunks)', 'info')
    }

    const res = await httpPost('/api/embed-batch', {
      apiKey:  creds?.embedApiKey,
      modelId: embedModel,
      inputs:  batchInputs
    })

    const contentType = (res.headers.get('content-type') || '').toLowerCase()

    if (contentType.includes('application/json')) {
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error('Embed failed: ' + embedErrorFromJson(data, res.status))
      const embeddings = extractEmbeddingsFromAnyJson(data)
      return normaliseBatchResult({ embeddings, hashes: data.hashes || [] }, batchInputs)
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error('Embed failed (' + res.status + ', ' + (contentType || 'no content-type') + '): ' + shortBody(body))
    }

    if (!contentType.includes('text/event-stream')) {
      const body = await res.text().catch(() => '')
      const hint = contentType.includes('text/html')
        ? ' The running server returned HTML instead of /api/embed-batch. Restart Node.js with the matching server.txt, then retry.'
        : ''
      throw new Error('Embed failed: expected JSON/SSE from /api/embed-batch but got ' + (contentType || 'no content-type') + '. ' + shortBody(body) + hint)
    }

    const streamed = await new Promise(async (resolve, reject) => {
      let settled = false
      try {
        await streamSse(res, payload => {
          let evt
          try { evt = JSON.parse(payload) } catch { return }
          if (evt.type === 'progress') {
            if (onProgress) {
              onProgress({ state: 'embedding', done: evt.done, total: evt.total, batchDone: evt.batchDone, batchTotal: evt.batchTotal })
            } else {
              const prefix = groupTotal > 1 ? ('Group ' + groupNum + '/' + groupTotal + ' - ') : ''
              toast(prefix + 'Embedding... batch ' + evt.batchDone + '/' + evt.batchTotal
                + '  (' + evt.done + '/' + evt.total + ' chunks)', 'info')
            }
            if (typeof setHealth === 'function') setHealth('warn', 'Embedding ' + evt.done + '/' + evt.total)
          } else if (evt.type === 'pacing') {
            if (onProgress) {
              onProgress({ state: 'pacing', done: evt.done, total: evt.total, batchDone: evt.batchDone, batchTotal: evt.batchTotal, waitSec: evt.waitSec })
            } else {
              toast('API rate limit reached - resuming batch embedding in ~' + evt.waitSec + 's'
                + ' (' + evt.done + '/' + evt.total + ' done)', 'info')
            }
            if (typeof setHealth === 'function') setHealth('warn', 'Rate limit - resuming in ' + evt.waitSec + 's')
          } else if (evt.type === 'done') {
            settled = true
            const embeddings = extractEmbeddingsFromAnyJson(evt)
            resolve({ embeddings: embeddings.length ? embeddings : (evt.embeddings || []), hashes: evt.hashes || [] })
          } else if (evt.type === 'error') {
            settled = true
            reject(new Error(evt.message || 'Embedding stream error'))
          }
        })
        if (!settled) reject(new Error('SSE stream ended without a done event'))
      } catch (e) {
        reject(e)
      }
    })
    return normaliseBatchResult(streamed, batchInputs)
  }

  const groups = splitEmbedInputs(inputs)
  const allEmbeddings = []
  const allHashes = []
  for (let i = 0; i < groups.length; i++) {
    const part = await embedBatchRequest(groups[i], i + 1, groups.length)
    allEmbeddings.push(...part.embeddings)
    allHashes.push(...part.hashes)
  }
  return { embeddings: allEmbeddings, hashes: allHashes, storeVectors: false }
}
// ---------------------------------------------------------------------------
// Hybrid retrieval — vector + keyword recall, RRF fusion, heuristic reranking,
// parent/neighbor context expansion, and one optional "retrieve more" round.
// ---------------------------------------------------------------------------
function getChunkRecord(doc, ch, i) {
  const legacyVec = Array.isArray(ch.embHash) ? ch.embHash : null
  const hashStr   = (typeof ch.embHash === 'string') ? ch.embHash : null
  const chunkId   = ch.chunkId || [doc.id || doc.name || 'doc', ch.sectionId || 'sec', i, hashStr || 'legacy'].join(':')
  return {
    id: chunkId,
    chunkId,
    docId: ch.docId || doc.id,
    docName: ch.docName || doc.name,
    docTitle: firstDocTitle(doc),
    docAliases: buildDocAliases(doc),
    text: ch.text || '',
    embHash: hashStr,
    embedding: ch.embedding || legacyVec || null,
    chunkIndex: Number.isFinite(ch.chunkIndex) ? ch.chunkIndex : i,
    chunkIndexInSection: Number.isFinite(ch.chunkIndexInSection) ? ch.chunkIndexInSection : null,
    sectionId: ch.sectionId || null,
    sectionIndex: Number.isFinite(ch.sectionIndex) ? ch.sectionIndex : null,
    sectionNo: ch.sectionNo || parseSectionNumber(ch.sectionTitle) || null,
    sectionDepth: ch.sectionDepth || sectionDepthFromNo(ch.sectionNo || parseSectionNumber(ch.sectionTitle)) || null,
    parentSectionNo: ch.parentSectionNo || parentSectionNo(ch.sectionNo || parseSectionNumber(ch.sectionTitle)) || null,
    sectionTitle: ch.sectionTitle || '',
    headingPath: Array.isArray(ch.headingPath) ? ch.headingPath : [],
    pageStart: ch.pageStart || null,
    pageEnd: ch.pageEnd || null,
    charStart: ch.charStart || null,
    charEnd: ch.charEnd || null
  }
}

function getAllChunkRecords(docs) {
  const all = []
  for (const d of docs || []) {
    if (!Array.isArray(d.chunks)) continue
    for (let i = 0; i < d.chunks.length; i++) {
      const rec = getChunkRecord(d, d.chunks[i], i)
      if (rec.text) all.push(rec)
    }
  }
  return all
}

async function hydrateChunkEmbeddings(records) {
  const needLookup = records.filter(c => c.embHash && !c.embedding)
  if (!needLookup.length) return
  try {
    const r = await httpPost('/api/embed-lookup', { hashes: needLookup.map(c => c.embHash) })
    if (!r.ok) throw new Error('lookup HTTP ' + r.status)
    const data = await r.json()
    const vecs = (data && Array.isArray(data.vectors)) ? data.vectors : []
    for (let i = 0; i < needLookup.length; i++) {
      if (Array.isArray(vecs[i])) needLookup[i].embedding = vecs[i]
    }
  } catch (e) {
    console.warn('[hydrateChunkEmbeddings] lookup failed:', e.message)
  }
}

function ragDocsSignature(docs) {
  return (docs || []).map(d => {
    const hashes = (d.chunks || []).map(c => c.chunkId || c.embHash || '').join(',')
    const aliases = buildDocAliases(d).join(',')
    const sections = (d.sections || []).map(s => s.sectionNo || parseSectionNumber(s.title) || '').join(',')
    return [d.id || d.name, d.name, (d.chunks || []).length, hashes, aliases, sections].join('|')
  }).join('||')
}

function tokenizeQuery(q) {
  const stop = new Set(['the','and','for','that','this','with','from','into','about','what','when','where','which','who','why','how','does','have','has','are','was','were','been','being','shall','should','would','could','can','may','must','will','not','you','your','their','there','then','than','also','please','tell','give','show','list','explain'])
  const toks = String(q || '').toLowerCase().match(/\d+(?:\.\d+)*[a-z]?|[a-z][a-z0-9_./:-]{1,}/g) || []
  return toks.filter(t => /^\d/.test(t) || (!stop.has(t) && t.length > 2))
}

function escapeRegExp(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasTerm(text, term) {
  text = String(text || '').toLowerCase()
  term = String(term || '').toLowerCase().trim()
  if (!text || !term) return false
  return new RegExp('(^|[^a-z0-9_./:-])' + escapeRegExp(term) + '($|[^a-z0-9_./:-])').test(text)
}

function countTermHits(text, term, cap) {
  text = String(text || '').toLowerCase()
  term = String(term || '').toLowerCase().trim()
  if (!text || !term) return 0
  const re = new RegExp('(^|[^a-z0-9_./:-])' + escapeRegExp(term) + '($|[^a-z0-9_./:-])', 'g')
  let hits = 0
  while (re.exec(text)) {
    hits++
    if (hits >= cap) break
  }
  return hits
}

function phraseMatches(text, phrase, minLen) {
  text = String(text || '').toLowerCase()
  phrase = String(phrase || '').toLowerCase().trim()
  minLen = minLen || 4
  return phrase.length >= minLen && text.includes(phrase)
}

function headingText(c) {
  return [...(c.headingPath || []), c.sectionTitle || ''].filter(Boolean).join(' > ')
}

function getKeywordIndex(docs) {
  const records = getAllChunkRecords(docs)
  const sig = ragDocsSignature(docs)
  if (ragKeywordIndexCache.signature === sig && ragKeywordIndexCache.index) return ragKeywordIndexCache

  if (typeof MiniSearch === 'undefined') {
    ragKeywordIndexCache = { signature: sig, index: null, records }
    return ragKeywordIndexCache
  }
  const index = new MiniSearch({
    idField: 'id',
    fields: ['docName', 'docTitle', 'docAliases', 'sectionNo', 'sectionTitle', 'headingText', 'text'],
    storeFields: ['chunkId','docId','docName','docTitle','docAliases','text','embHash','chunkIndex','sectionId','sectionIndex','sectionNo','sectionDepth','parentSectionNo','sectionTitle','headingText','pageStart','pageEnd']
  })
  index.addAll(records.map(r => ({ ...r, id: r.chunkId, headingText: headingText(r), docAliases: (r.docAliases || []).join(' ') })))
  ragKeywordIndexCache = { signature: sig, index, records }
  return ragKeywordIndexCache
}

function keywordSearchFallback(query, records, limit) {
  const terms = tokenizeQuery(query)
  const refs = extractSectionRefs(query)
  const phrase = String(query || '').toLowerCase().trim()
  if (!terms.length && !phrase && !refs.length) return []
  return records.map(r => {
    const text = (r.text || '').toLowerCase()
    const head = headingText(r).toLowerCase()
    const aliases = (r.docAliases || []).join(' ').toLowerCase()
    const sectionNo = String(r.sectionNo || '').toLowerCase()
    let score = 0
    for (const ref of refs) {
      if (sectionRefMatches(sectionNo, ref)) score += 12
    }
    for (const t of terms) {
      if (hasTerm(aliases, t)) score += 3
      if (hasTerm(String(r.docName || '').toLowerCase(), t)) score += 2.5
      if (sectionNo && (sectionNo === t || sectionNo.startsWith(t + '.'))) score += 8
      if (hasTerm(head, t)) score += 2.5
      if (hasTerm(text, t)) score += 1
    }
    if (phraseMatches(head, phrase, 4)) score += 5
    if (phraseMatches(text, phrase, 4)) score += 3
    return score > 0 ? { ...r, keywordScore: score, via: 'keyword' } : null
  }).filter(Boolean).sort((a,b)=>b.keywordScore-a.keywordScore).slice(0, limit)
}

function keywordSearch(query, docs, limit) {
  const { index, records } = getKeywordIndex(docs)
  if (!index) return keywordSearchFallback(query, records, limit)
  try {
    return index.search(query, {
      prefix: true,
      fuzzy: 0.1,
      combineWith: 'OR',
      boost: { docAliases: 6, docTitle: 5, docName: 4, sectionNo: 8, sectionTitle: 5, headingText: 4, text: 1 }
    }).slice(0, limit).map(r => ({
      ...r,
      id: r.chunkId || r.id,
      chunkId: r.chunkId || r.id,
      keywordScore: r.score,
      via: 'keyword'
    }))
  } catch (e) {
    console.warn('[keywordSearch] MiniSearch failed; using fallback:', e.message)
    return keywordSearchFallback(query, records, limit)
  }
}

async function retrieveVectorChunks(query, docs, limit, queryEmbedding) {
  const all = getAllChunkRecords(docs)
  if (!all.length) return []
  await hydrateChunkEmbeddings(all)
  const qe = queryEmbedding || (await embedBatch([query])).embeddings[0]
  return all
    .filter(c => c.embedding)
    .map(c => ({ ...c, vectorScore: cosine(qe, c.embedding), score: cosine(qe, c.embedding), via: 'vector' }))
    .sort((a, b) => b.vectorScore - a.vectorScore)
    .slice(0, limit)
}

function rrfFuse(rankedLists, opts) {
  opts = opts || {}
  const k = opts.k || CFG.HYBRID_RRF_K || 60
  const weights = opts.weights || []
  const byId = new Map()
  rankedLists.forEach((list, li) => {
    const weight = weights[li] == null ? 1 : weights[li]
    ;(list || []).forEach((item, rank) => {
      const id = item.chunkId || item.id || (item.docName + ':' + item.text)
      const cur = byId.get(id) || { ...item, chunkId: id, rrfScore: 0, via: [] }
      cur.rrfScore += weight * (1 / (k + rank + 1))
      cur.vectorScore = cur.vectorScore ?? item.vectorScore
      cur.keywordScore = cur.keywordScore ?? item.keywordScore
      cur.vectorRank = cur.vectorRank ?? (item.via === 'vector' ? rank + 1 : item.vectorRank)
      cur.keywordRank = cur.keywordRank ?? (item.via === 'keyword' ? rank + 1 : item.keywordRank)
      if (!cur.via.includes(item.via || ('list' + li))) cur.via.push(item.via || ('list' + li))
      byId.set(id, cur)
    })
  })
  return [...byId.values()].sort((a,b)=>b.rrfScore-a.rrfScore)
}

function heuristicRerank(query, candidates) {
  const phrase = String(query || '').toLowerCase().trim()
  return (candidates || []).map((c, idx) => {
    const ev = retrievalEvidence(query, c)
    const rr = c.rrfScore || c.score || 0
    const vector = Math.max(0, ev.vectorScore || 0)
    const keyword = Math.log1p(Math.max(0, c.keywordScore || 0)) / 8
    const exactBoost = ev.exactSectionHit ? 8 : 0
    const docBoost = ev.docAliasHits ? 1.5 : 0
    const headingBoost = ev.headingHits * 0.8
    const bodyBoost = ev.textHits * 0.25
    const phraseBoost = ev.phraseHit && phrase.length > 12 ? 1.5 : 0
    const semanticOnlyPenalty = (!ev.termHits && vector > 0) ? 0.8 : 0
    const rerankScore = exactBoost + docBoost + headingBoost + bodyBoost + phraseBoost + ev.coverage * 2.2 + keyword + vector + rr * 10 - semanticOnlyPenalty - idx * 0.0001
    return { ...c, score: rerankScore, rerankScore, retrievalEvidence: ev }
  }).sort((a,b)=>b.rerankScore-a.rerankScore)
}

function retrievalEvidence(query, item) {
  const terms = tokenizeQuery(query)
  const refs = extractSectionRefs(query)
  const phrase = String(query || '').toLowerCase().trim()
  const name = String(item?.docName || item?.name || '').toLowerCase()
  const aliases = Array.isArray(item?.docAliases) ? item.docAliases.join(' ').toLowerCase() : docAliasesText(item || {}).toLowerCase()
  const head = headingText(item || {}).toLowerCase()
  const section = String(item?.sectionTitle || '').toLowerCase()
  const sectionNo = String(item?.sectionNo || parseSectionNumber(section) || '').toLowerCase()
  const text = String(item?.text || item?.content || '').toLowerCase()
  const exactSectionHit = refs.some(ref => sectionRefMatches(sectionNo, ref))
  let termHits = 0
  let headingHits = 0
  let textHits = 0
  let docAliasHits = 0
  for (const t of terms) {
    const isNum = /^\d/.test(t)
    const inName = hasTerm(name, t) || hasTerm(aliases, t)
    const inSectionNo = isNum && sectionNo && (sectionNo === t || sectionNo.startsWith(t + '.'))
    const inHead = hasTerm(head, t) || hasTerm(section, t) || inSectionNo
    const inText = hasTerm(text, t)
    if (inName || inHead || inText) termHits++
    if (inName) docAliasHits++
    if (inName || inHead) headingHits++
    if (inText) textHits++
  }
  const coverage = terms.length ? termHits / terms.length : (exactSectionHit ? 1 : 0)
  const hay = [name, aliases, head, sectionNo, section, text].join('\n')
  const phraseHit = phraseMatches(hay, phrase, terms.length > 1 ? 6 : 4)
  const vectorScore = Number.isFinite(item?.vectorScore) ? item.vectorScore : -1
  const hasUsableQuery = terms.length > 0 || phrase.length >= 4 || refs.length > 0
  return { termsLength: terms.length, termHits, headingHits, textHits, docAliasHits, coverage, phraseHit, exactSectionHit, vectorScore, hasUsableQuery }
}

function isRelevantHit(query, hit) {
  const ev = hit?.retrievalEvidence || retrievalEvidence(query, hit)
  if (!ev.hasUsableQuery) return false
  const minVector = CFG.RETRIEVAL_MIN_VECTOR_SCORE || 0.4
  const strongVector = CFG.RETRIEVAL_STRONG_VECTOR_SCORE || 0.48
  const shortVector = CFG.RETRIEVAL_SHORT_QUERY_MIN_VECTOR_SCORE || 0.45
  const minCoverage = CFG.RETRIEVAL_MIN_TERM_COVERAGE || 0.5
  if (ev.exactSectionHit) return true
  if (ev.docAliasHits && ev.headingHits) return true
  if (ev.phraseHit) return true
  if (ev.termsLength <= 2) return ev.termHits > 0 || ev.vectorScore >= Math.max(shortVector, minVector)
  if (ev.coverage >= minCoverage) return true
  if (ev.vectorScore >= strongVector) return true
  return ev.vectorScore >= minVector && ev.coverage >= Math.max(0.34, minCoverage * 0.6)
}

function canExpandHit(query, hit) {
  const ev = hit?.retrievalEvidence || retrievalEvidence(query, hit)
  if (!isRelevantHit(query, hit)) return false
  const minVector = CFG.CONTEXT_EXPAND_MIN_VECTOR_SCORE || CFG.RETRIEVAL_MIN_VECTOR_SCORE || 0.4
  const strongVector = CFG.RETRIEVAL_STRONG_VECTOR_SCORE || 0.48
  const minCoverage = CFG.CONTEXT_EXPAND_MIN_TERM_COVERAGE || 0.5
  if (ev.exactSectionHit) return true
  if (ev.phraseHit) return true
  if (ev.termsLength <= 2) return ev.headingHits > 0 || ev.vectorScore >= strongVector || (ev.termHits > 0 && ev.vectorScore >= minVector)
  return ev.coverage >= minCoverage || ev.vectorScore >= strongVector || (ev.termHits > 0 && ev.vectorScore >= minVector)
}

function findSourceDoc(docs, hit) {
  return (docs || []).find(d => d.id === hit.docId || d.name === hit.docName) || null
}

function sectionFamilySections(doc, sectionNo) {
  if (!doc) return []
  let sections = Array.isArray(doc.sections) && doc.sections.length ? doc.sections : []
  if (!sections.length && doc.content) sections = splitIntoRagSections(doc.content)
  sectionNo = String(sectionNo || '').toLowerCase().trim()
  return sections.map(enrichSectionMeta).filter(s => sectionRefMatches(s.sectionNo, sectionNo))
}

function sectionContextText(section, no) {
  const title = titleCaseCandidate(section?.title || '') || section?.title || 'Document section'
  const label = no ? ('[Section ' + no + ': ' + title + ']') : ('[Section: ' + title + ']')
  return label + '\n' + String(section?.text || '').trim()
}

function exactSectionLookup(refs, docs) {
  refs = (refs || []).filter(Boolean)
  if (!refs.length) return []
  const out = []
  const seen = new Set()
  for (const doc of docs || []) {
    let sections = Array.isArray(doc.sections) && doc.sections.length ? doc.sections : []
    if (!sections.length && doc.content) sections = splitIntoRagSections(doc.content)
    sections = sections.map(enrichSectionMeta)
    for (const sec of sections) {
      const no = sec.sectionNo || parseSectionNumber(sec.title) || parseSectionNumber(sec.text)
      if (!refs.some(ref => sectionRefMatches(no, ref))) continue
      const key = (doc.id || doc.name) + '|' + (no || sec.sectionId) + '|' + sec.sectionIndex
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        id: key,
        chunkId: key,
        docId: doc.id,
        docName: doc.name,
        docTitle: firstDocTitle(doc),
        docAliases: buildDocAliases(doc),
        sectionId: sec.sectionId,
        sectionIndex: sec.sectionIndex,
        sectionNo: no || null,
        sectionDepth: sectionDepthFromNo(no),
        parentSectionNo: parentSectionNo(no),
        sectionTitle: sec.title,
        headingPath: sec.headingPath || [],
        pageStart: sec.pageStart,
        pageEnd: sec.pageEnd,
        text: sectionContextText(sec, no),
        exactSectionHit: true,
        via: 'exact-section'
      })
    }
  }
  return packContextChunks(out, CFG.STRUCTURAL_SECTION_MAX_CHARS || CFG.CONTEXT_MAX_CHARS)
}

function expandChunkWithContext(hit, docs, neighborCount) {
  const doc = findSourceDoc(docs, hit)
  if (!doc || !Array.isArray(doc.chunks)) return hit
  const idx = Number.isFinite(hit.chunkIndex) ? hit.chunkIndex : doc.chunks.findIndex(c => (c.chunkId && c.chunkId === hit.chunkId) || c.text === hit.text)
  const section = Array.isArray(doc.sections) ? doc.sections.map(enrichSectionMeta).find(s => s.sectionId === hit.sectionId) : null

  const secNo = hit.sectionNo || section?.sectionNo
  if (secNo) {
    const family = sectionFamilySections(doc, secNo)
    const familyText = family.map(s => sectionContextText(s, s.sectionNo)).join('\n\n')
    const limit = CFG.STRUCTURAL_SECTION_MAX_CHARS || CFG.CONTEXT_MAX_CHARS || 40000
    if (familyText && familyText.length <= limit) {
      return {
        ...hit,
        text: familyText,
        expanded: 'section-family'
      }
    }
  }

  if (section && section.text && section.text.length <= (CFG.PARENT_SECTION_MAX_CHARS || 6000)) {
    return {
      ...hit,
      text: '[Section: ' + (section.title || hit.sectionTitle || 'Document section') + ']\n' + section.text,
      expanded: 'parent-section'
    }
  }

  if (idx < 0) return hit
  const start = Math.max(0, idx - neighborCount)
  const end = Math.min(doc.chunks.length - 1, idx + neighborCount)
  const parts = []
  for (let i = start; i <= end; i++) {
    const ch = doc.chunks[i]
    if (!ch) continue
    if (hit.sectionId && ch.sectionId && ch.sectionId !== hit.sectionId) continue
    parts.push(ch.text)
  }
  const merged = [...new Set(parts)].join('\n\n[continued]\n\n').trim()
  return merged ? { ...hit, text: merged, expanded: 'neighbors' } : hit
}

function packContextChunks(chunks, maxChars) {
  maxChars = maxChars || CFG.CONTEXT_MAX_CHARS || 60000
  const out = []
  let used = 0
  const seen = new Set()
  for (const c of chunks || []) {
    const key = c.chunkId || (c.docName + ':' + c.text.slice(0, 80))
    if (seen.has(key)) continue
    seen.add(key)
    let text = c.text || ''
    if (!text) continue
    const remaining = maxChars - used
    if (remaining <= 0) break
    if (text.length > remaining) text = text.slice(0, Math.max(0, remaining - 80)) + '\n[truncated to fit context budget]'
    out.push({ ...c, text })
    used += text.length
  }
  return out
}

function contextLooksSufficient(query, chunks) {
  if (!chunks || !chunks.length) return false
  const terms = tokenizeQuery(query)
  const phrase = String(query || '').toLowerCase().trim()
  if (!terms.length && phrase.length < 4) return false
  if ((chunks || []).some(c => c.exactSectionHit || retrievalEvidence(query, c).exactSectionHit || canExpandHit(query, c))) return true
  const ctx = chunks.map(c => c.text || '').join('\n').toLowerCase()
  const hits = terms.filter(t => hasTerm(ctx, t)).length
  const coverage = hits / Math.max(1, terms.length)
  if (terms.length <= 2) return hits === terms.length
  return coverage >= (CFG.SUFFICIENCY_MIN_TERM_COVERAGE || 0.6)
}


function docSearchCorpus(doc, maxChars) {
  maxChars = maxChars || 200000
  const parts = [doc?.name || '']
  if (Array.isArray(doc?.sections)) parts.push(doc.sections.map(s => s?.title || '').filter(Boolean).join('\n'))
  if (Array.isArray(doc?.chunks)) {
    let used = parts.join('\n').length
    for (const ch of doc.chunks) {
      const t = String(ch?.text || '')
      if (!t) continue
      if (used + t.length > maxChars) { parts.push(t.slice(0, Math.max(0, maxChars - used))); break }
      parts.push(t); used += t.length
    }
  } else if (doc?.content) {
    parts.push(String(doc.content).slice(0, maxChars))
  }
  return parts.join('\n').toLowerCase()
}

function scoreDocForQuery(query, doc) {
  const terms = tokenizeQuery(query)
  const phrase = String(query || '').toLowerCase().trim()
  if (!terms.length && phrase.length < 4) return 0
  const refs = extractSectionRefs(query)
  const name = String(doc?.name || '').toLowerCase()
  const aliases = docAliasesText(doc).toLowerCase()
  const headings = Array.isArray(doc?.sections) ? doc.sections.map(s => [s?.sectionNo || parseSectionNumber(s?.title) || '', s?.title || ''].join(' ')).join(' ').toLowerCase() : ''
  const corpus = docSearchCorpus(doc)
  let score = 0
  for (const ref of refs) {
    if ((doc.sections || []).some(s => sectionRefMatches(s.sectionNo || parseSectionNumber(s.title), ref))) score += 8
  }
  for (const t of terms) {
    if (hasTerm(name, t) || hasTerm(aliases, t)) score += 5
    if (hasTerm(headings, t)) score += 3
    const hits = countTermHits(corpus, t, 5)
    if (hits) score += Math.min(4, hits)
  }
  if (phrase.length > 12) {
    if (phraseMatches(name, phrase, 12)) score += 6
    if (phraseMatches(corpus, phrase, 12)) score += 8
  }
  return score
}

function selectRelevantFullDocs(query, docs, maxDocs) {
  docs = (docs || []).filter(d => d && d.content)
  if (!docs.length) return []
  maxDocs = Math.max(1, Math.min(docs.length, clampTopK(maxDocs || CFG.DEFAULT_TOP_K || 5)))
  const terms = tokenizeQuery(query)
  const phrase = String(query || '').trim()
  if (!terms.length && phrase.length < 4) return []

  const scored = docs.map((doc, idx) => ({ doc, idx, score: scoreDocForQuery(query, doc) }))
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
  const positives = scored.filter(x => x.score > 0)
  if (!positives.length) return []

  const best = positives[0].score
  const floor = Math.max(1, best * 0.2)
  return positives.filter(x => x.score >= floor).slice(0, maxDocs).map(x => x.doc)
}

function uniqueSourceNames(items) {
  const out = []
  const seen = new Set()
  for (const item of items || []) {
    const name = String(item?.docName || item?.name || '').trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

function sourceItemEvidence(query, item) {
  const ev = retrievalEvidence(query, item)
  if (!ev.hasUsableQuery) return { score: 0, hits: 0, coverage: 0 }
  let score = 0
  if (ev.exactSectionHit) score += 10
  score += ev.docAliasHits * 3
  score += ev.headingHits * 2
  score += ev.textHits
  score += ev.coverage * 2
  if (ev.phraseHit) score += 2
  if (Number.isFinite(item?.rerankScore)) score += Math.min(1, Math.max(0, item.rerankScore) / 5)
  else if (Number.isFinite(item?.score)) score += Math.min(0.5, Math.max(0, item.score) / 10)
  return { score, hits: ev.termHits + (ev.exactSectionHit ? 1 : 0), coverage: ev.coverage }
}

function displayedSourceNames(query, items) {
  const byName = new Map()
  const terms = tokenizeQuery(query)
  for (const item of items || []) {
    const name = String(item?.docName || item?.name || '').trim()
    if (!name) continue
    const ev = sourceItemEvidence(query, item)
    if (ev.score <= 0) continue
    const cur = byName.get(name)
    if (!cur || ev.score > cur.score) byName.set(name, { name, ...ev, firstIndex: byName.size })
  }

  const rows = [...byName.values()].sort((a,b)=>b.score-a.score || a.firstIndex-b.firstIndex)
  if (!rows.length) return []

  const minHits = terms.length >= 5 ? 2 : (terms.length >= 2 ? 1 : 0)
  const viable = rows.filter(r => r.hits >= minHits)
  if (!viable.length) return []

  const best = viable[0].score
  const floor = Math.max(best * 0.55, minHits ? (minHits + 0.5) : 0.5)
  return viable
    .filter(r => r.score >= floor)
    .slice(0, clampTopK(creds?.topK || CFG.DEFAULT_TOP_K || 5))
    .map(r => r.name)
}

async function retrieveRagChunks(query, docs, topK, stickyChunks) {
  topK = clampTopK(topK || CFG.DEFAULT_TOP_K || 5)
  const mode = CFG.DEFAULT_RETRIEVAL_MODE || 'hybrid'
  const rerankMode = CFG.DEFAULT_RERANK_MODE || 'heuristic'
  const autoMore = creds?.autoRetrieveMore !== false && CFG.ENABLE_AUTO_RETRIEVE_MORE
  const maxRounds = autoMore ? (CFG.MAX_RETRIEVAL_ROUNDS || 2) : 1
  const baseCandidateK = Math.min(CFG.HYBRID_MAX_CANDIDATES || 80, Math.max(topK, topK * (creds?.candidateMult || CFG.HYBRID_CANDIDATE_MULT || 5)))
  const stickySlots = Math.max(0, Math.floor(topK * (CFG.STICKY_CHUNK_RATIO || 0.3)))
  const finalSlots = Math.max(1, topK - stickySlots)
  const plan = analyzeRagQuery(query, docs)
  if (plan.sectionRefs.length) {
    const exact = exactSectionLookup(plan.sectionRefs, docs)
    if (exact.length) return exact
  }
  const queryEmbedding = (mode === 'keyword') ? null : (await embedBatch([query])).embeddings[0]
  let best = []

  for (let round = 1; round <= maxRounds; round++) {
    const candidateK = Math.min(CFG.HYBRID_MAX_CANDIDATES || 80, baseCandidateK * round)
    let candidates = []
    if (mode === 'vector') {
      candidates = await retrieveVectorChunks(query, docs, candidateK, queryEmbedding)
    } else if (mode === 'keyword') {
      candidates = keywordSearch(query, docs, candidateK)
    } else {
      const vectorHits = await retrieveVectorChunks(query, docs, candidateK, queryEmbedding)
      const keywordHits = keywordSearch(query, docs, candidateK)
      candidates = rrfFuse([vectorHits, keywordHits], { k: CFG.HYBRID_RRF_K || 60 })
    }

    const ranked = rerankMode === 'none' ? candidates.map(c => ({ ...c, retrievalEvidence: retrievalEvidence(query, c) })) : heuristicRerank(query, candidates)
    const filtered = ranked.filter(h => isRelevantHit(query, h))
    if (!filtered.length) {
      best = []
      break
    }
    const selected = filtered.slice(0, finalSlots).map(h => {
      if (!canExpandHit(query, h)) return h
      return expandChunkWithContext(h, docs, creds?.expandNeighbors ?? CFG.CONTEXT_EXPAND_NEIGHBORS ?? 1)
    })

    const selectedTexts = new Set(selected.map(c => c.text))
    const carried = selected.length ? (stickyChunks || []).filter(c => !selectedTexts.has(c.text) && isRelevantHit(query, c)).slice(0, stickySlots) : []
    best = packContextChunks([...selected, ...carried], CFG.CONTEXT_MAX_CHARS)

    if (round >= maxRounds || contextLooksSufficient(query, best)) break
    toast('Retrieved context looks thin — pulling more chunks...', 'info')
  }
  return best
}

// Back-compatible wrapper for older call sites.
async function retrieveChunks(query, docs, topK, stickyChunks) {
  return retrieveRagChunks(query, docs, topK, stickyChunks)
}


// Ask the server to prune vectors no longer referenced by any doc (called after
// a doc is removed). More thorough than per-hash eviction: clears orphans too.
async function gcEmbedCache() {
  try { const r = await httpPost('/api/embed-gc'); return await r.json() }
  catch (e) { console.warn('[gcEmbedCache]', e.message); return null }
}


// ---------------------------------------------------------------------------
// Token-budget estimation + caps (alpha Phase 2 gate; re-grafted after the
// v0.67e RAG adopt). Shared ~4-chars/token estimate; caps resolve from Settings
// overrides or adapt to the live per-minute limit. Also used by dynamic
// full-text injection (item 2). Depends on lastBudget/embedTally (10-state.js).
// ---------------------------------------------------------------------------
function estTokens(texts) {
  const arr = Array.isArray(texts) ? texts : [texts]
  let chars = 0
  for (const t of arr) chars += String(t == null ? '' : t).length
  return Math.ceil(chars / 4)
}
function resolveEmbedCaps() {
  // Warn only when an embed won't fit in what's left this minute, or exceeds the
  // hard cap, or an explicit Settings "warn above" override. Hard cap ~90% of
  // the per-minute limit.
  const lim = (typeof lastBudget !== 'undefined' && lastBudget.tokLimit) || 0
  const num = v => (typeof v === 'number' && v > 0) ? v : null
  const warnOverride = num(creds && creds.embedWarnTokens)
  const maxOv  = num(creds && creds.embedMaxTokens)
  const hard = maxOv != null ? maxOv : (lim ? Math.round(lim * 0.90) : 180000)
  const remaining = (typeof lastBudget !== 'undefined' && lastBudget.tokRemaining != null) ? lastBudget.tokRemaining : null
  return { warnOverride, hard, limit: lim || null, remaining }
}
// Rolling 60s record of embeds so several files in a row accumulate.
function noteEmbed(tokens) {
  const now = Date.now()
  embedTally = (embedTally || []).filter(e => now - e.ts < 60000)
  embedTally.push({ ts: now, tokens: tokens || 0 })
}
function recentEmbedTokens() {
  const now = Date.now()
  embedTally = (embedTally || []).filter(e => now - e.ts < 60000)
  return embedTally.reduce((sum, e) => sum + (e.tokens || 0), 0)
}
