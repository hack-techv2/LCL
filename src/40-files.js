// =============================================================================
// Documents (per chat)
// =============================================================================
function toggleDP() {
  dpOpen = !dpOpen
  document.getElementById('doc-panel').classList.toggle('hidden', !dpOpen)
  if (dpOpen) {
    // Remove any stale banner first
    document.getElementById('embed-key-banner')?.remove()
    if (creds && (!creds.embedApiKey || !creds.embedModelId)) {
      const desc = document.getElementById('embed-panel-desc')
      if (desc) {
        const banner = document.createElement('div')
        banner.id = 'embed-key-banner'
        banner.style.cssText = 'padding:10px 12px;background:var(--pinbg);border-bottom:1px solid rgba(240,165,0,.3);font-size:12px;color:var(--pin)'
        const existingModel = creds?.embedModelId || ''
        banner.innerHTML = '<div style="margin-bottom:6px;font-weight:500">Embedding settings required for RAG</div>'
          + '<div style="margin-bottom:4px;font-size:11px;color:var(--tx3)">API Key</div>'
          + '<input type="password" id="embed-key-input" placeholder="Paste embedding API key" style="width:100%;background:var(--bg3);border:1px solid var(--bdr2);border-radius:4px;padding:6px 9px;color:var(--tx);font-family:var(--mono);font-size:12px;outline:none;margin-bottom:8px;box-sizing:border-box">'
          + '<div style="margin-bottom:4px;font-size:11px;color:var(--tx3)">Model ID</div>'
          + '<select id="embed-model-input-sel" class="model-sel" style="margin-bottom:8px"></select>'
          + '<input type="text" id="embed-model-input" placeholder="cohere.embed-english-v3" value="'+(existingModel||'cohere.embed-english-v3')+'" style="width:100%;background:var(--bg3);border:1px solid var(--bdr2);border-radius:4px;padding:6px 9px;color:var(--tx);font-family:var(--mono);font-size:12px;outline:none;margin-bottom:8px;box-sizing:border-box">'
          + '<div style="display:flex;gap:6px">'
          + '<button onclick="saveEmbedKey()" style="padding:5px 12px;background:var(--ac);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px">Save</button>'
          + '<button onclick="testEmbedConnection()" style="padding:5px 12px;background:var(--bg3);color:var(--tx);border:1px solid var(--bdr2);border-radius:4px;cursor:pointer;font-size:12px">Test</button>'
          + '</div>'
          + '<div id="embed-test-result" style="margin-top:6px;font-size:11px"></div>'
        desc.insertAdjacentElement('afterend', banner)
        if (typeof wireModelField === 'function') wireModelField('embed-model-input', tierGroups('embed', (creds && creds.classification) || inferTier(creds && creds.model) || 'cce'))
      }
    }
  }
}

function saveEmbedKey() {
  const keyVal   = (document.getElementById('embed-key-input')?.value  || '').trim()
  const modelVal = (document.getElementById('embed-model-input')?.value || '').trim()
  if (!keyVal) { toast('API key required', 'err'); return }
  if (!modelVal) { toast('Model ID required', 'err'); return }
  if (creds) { creds.embedApiKey = keyVal; creds.embedModelId = modelVal }
  // Mirror into D.settings so persist() also carries these to disk
  if (D.settings) { D.settings.embedApiKey = keyVal; D.settings.embedModelId = modelVal }
  const settingsBody = { apiKey: creds?.apiKey||'', modelId: creds?.model||'', maxTokens: creds?.maxTokens||8192, systemPrompt: creds?.systemPrompt||'', embedApiKey: keyVal, embedModelId: modelVal }
  saveSettings(settingsBody)
  persist()
  document.getElementById('embed-key-banner')?.remove()
  toast('Embedding settings saved', 'ok')
  // Refresh status dot and health pill so the new embed-ready state shows up
  updateDocsBtn()
  if (creds) setHealth('ok', connectedLabel())
}

async function testEmbedConnection() {
  const keyVal   = (document.getElementById('embed-key-input')?.value  || creds?.embedApiKey  || '').trim()
  const modelVal = (document.getElementById('embed-model-input')?.value || creds?.embedModelId || '').trim()
  const resultEl = document.getElementById('embed-test-result')
  if (!keyVal || !modelVal) {
    if (resultEl) { resultEl.style.color='var(--red)'; resultEl.textContent='Enter API key and model ID first.' }
    return
  }
  if (resultEl) { resultEl.style.color='var(--tx3)'; resultEl.textContent='Testing...' }
  try {
    // /api/embed (single-shot) returns plain JSON. /api/embed/batch is SSE
    // and would make resp.json() throw — that was the previous bug here.
    const resp = await httpPost('/api/embed', { apiKey: keyVal, modelId: modelVal, input: 'test' })
    const data = await resp.json().catch(() => ({}))
    const vec = data.data?.[0]?.embedding || data.embedding
    if (resp.ok && Array.isArray(vec) && vec.length) {
      if (resultEl) { resultEl.style.color='#4caf50'; resultEl.textContent='✓ Connected — '+vec.length+' dims' }
    } else {
      const msg = data.error?.message || data.error || ('HTTP '+resp.status)
      if (resultEl) { resultEl.style.color='var(--red)'; resultEl.textContent='✗ '+msg }
    }
  } catch(e) {
    if (resultEl) { resultEl.style.color='var(--red)'; resultEl.textContent='✗ '+e.message }
  }
}

// =============================================================================
// File parsing (PDF, DOCX, XLSX, plain text)
// =============================================================================
function getExt(name) { return (name.split('.').pop()||'').toLowerCase() }

// File acceptance: pdf/docx/pptx/xlsx/xls have dedicated EXTRACTORS; every other
// file is attempted as plain text and rejected during extraction if it isn't
// readable text (EXTRACTORS._default). So there is no upload allowlist — text /
// code / config and no-extension files (Dockerfile, .env, …) all pass through.

// ---------------------------------------------------------------------------
// merged from 41-files-extract.js
// ---------------------------------------------------------------------------

// File-type extractor registry: extension -> async (file) => { text, scanWarning, ... }.
// Adding a new file type is a single entry here; preview/embed stay generic.
const EXTRACTORS = {
  pdf: async (file) => {
    const ab = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: ab, verbosity: 0 }).promise
    const totalPages   = pdf.numPages
    const pages        = []
    const emptyPageNums = []
    for (let i = 1; i <= totalPages; i++) {
      const page = await pdf.getPage(i)
      const tc   = await page.getTextContent()
      const pageText = tc.items.map(it => it.str).join(' ').trim()
      if (!pageText) emptyPageNums.push(i)
      pages.push({ pageNum: i, text: pageText })
    }
    const text = pages.map(p => p.text).join('\n').trim() || '[No text found in PDF]'
    const emptyShare   = totalPages ? emptyPageNums.length / totalPages : 0
    const looksScanned = emptyPageNums.length >= CFG.SCAN_MIN_PAGES && emptyShare >= CFG.SCAN_MIN_SHARE
    const scanWarning = looksScanned
      ? emptyPageNums.length + ' of ' + totalPages + ' pages had no extractable text \u2014 this PDF may be partially or fully scanned. Embedded content will be incomplete.'
      : null
    return { text, scanWarning, pdfDoc: scanWarning ? pdf : null, emptyPageNums, pages }
  },
  docx: async (file) => {
    const ab = await file.arrayBuffer()
    const result = await mammoth.extractRawText({ arrayBuffer: ab })
    return { text: result.value.trim() || '[No text found in DOCX]', scanWarning: null }
  },
  xlsx: async (file) => {
    const ab = await file.arrayBuffer()
    const wb = XLSX.read(ab, { type: 'array' })
    let out = ''
    for (const name of wb.SheetNames) {
      const ws  = wb.Sheets[name]
      const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false })
      if (csv.trim()) out += '=== Sheet: ' + name + ' ===\n' + csv + '\n\n'
    }
    return { text: out.trim() || '[No data found in spreadsheet]', scanWarning: null }
  },
  // PowerPoint (.pptx) is a zip of slide XML; unzip (JSZip) and pull the
  // DrawingML <a:t> text runs per slide (also covers table cells). Speaker notes
  // are resolved per slide via the slide's .rels so they attach to the right
  // slide. Image-only decks yield no text (no OCR) and raise a scan warning.
  pptx: async (file) => {
    if (typeof JSZip === 'undefined') throw new Error('PPTX needs the JSZip library (offline / blocked?) — export the deck to PDF instead')
    const zip = await JSZip.loadAsync(await file.arrayBuffer())
    const ent = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    const runs = xml => { const out = []; const re = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g; let m; while ((m = re.exec(xml))) out.push(m[1]); return ent(out.join(' ')).replace(/\s+/g, ' ').trim() }
    const num = n => { const m = n.match(/slide(\d+)\.xml$/); return m ? +m[1] : 0 }
    const slides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b))
    const blocks = []
    let empty = 0
    for (let i = 0; i < slides.length; i++) {
      const body = runs(await zip.file(slides[i]).async('string'))
      // notes: resolve via the slide's rels (../notesSlides/notesSlideN.xml)
      let notes = ''
      const relsName = 'ppt/slides/_rels/' + slides[i].split('/').pop() + '.rels'
      const relsFile = zip.file(relsName)
      if (relsFile) {
        const rm = (await relsFile.async('string')).match(/Target="([^"]*notesSlide\d+\.xml)"/i)
        if (rm) {
          const np = ('ppt/slides/' + rm[1]).replace(/[^/]+\/\.\.\//g, '')
          if (zip.file(np)) notes = runs(await zip.file(np).async('string'))
        }
      }
      if (!body && !notes) empty++
      let block = '=== Slide ' + (i + 1) + ' ===\n' + (body || '[no slide text]')
      if (notes) block += '\n[Notes] ' + notes
      blocks.push(block)
    }
    const text = blocks.join('\n\n').trim() || '[No text found in PPTX]'
    const total = slides.length
    const imageOnly = total > 0 && empty >= (CFG.SCAN_MIN_PAGES || 3) && (empty / total) >= (CFG.SCAN_MIN_SHARE || 0.5)
    const scanWarning = imageOnly
      ? empty + ' of ' + total + ' slides had no extractable text — this deck may be image-only. Embedded content will be incomplete.'
      : null
    return { text, scanWarning }
  },
  // Any other file: read it as UTF-8 text. If it sniffs as binary (NUL bytes,
  // or a high share of U+FFFD replacement chars from undecodable bytes), reject
  // it as unsupported. queueFilesForPreview() catches this, shows a per-file
  // "Could not read ..." toast, and skips it.
  _default: (file) => new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload  = e => {
      const s = e.target.result || ''
      const head = s.slice(0, 8000)
      const bad = (head.match(/[\u0000\uFFFD]/g) || []).length
      if (head.indexOf('\u0000') !== -1 || (head.length && bad / head.length > 0.1)) {
        reject(new Error('unsupported file type (not readable as text)'))
      } else {
        resolve({ text: s, scanWarning: null })
      }
    }
    r.onerror = () => reject(new Error('read error'))
    r.readAsText(file)
  }),
}
EXTRACTORS.xls = EXTRACTORS.xlsx   // legacy spreadsheet alias

async function extractText(file) {
  const ext = getExt(file.name)
  return (EXTRACTORS[ext] || EXTRACTORS._default)(file)
}

// =============================================================================
// On-demand OCR via Tesseract.js (loaded only when a scanned PDF is detected)
// =============================================================================
// Injects a script element at call time. Resolves immediately if the script is
// already present (i.e. already loaded and cached by the browser).
function loadScript(url) {
  return new Promise((resolve, reject) => {
    if (document.querySelector('script[src="' + url + '"]')) { resolve(); return }
    const s = document.createElement('script')
    s.src = url
    s.onload = resolve
    s.onerror = () => reject(new Error('Could not load: ' + url))
    document.head.appendChild(s)
  })
}

// Render each scanned (empty-text) page to canvas at 2× scale, run Tesseract
// OCR on it, and patch the recovered text back into item.extractedText.
// Clears item.scanWarning on success so the embed confirm shows no residual warning.
async function ocrQueueItem(item) {
  const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@4.1.1/dist/tesseract.min.js'
  if (!window.Tesseract) {
    toast('Loading OCR engine — first use only (~3 MB, cached after this)...', 'info')
    await loadScript(TESSERACT_CDN)
  }
  const worker    = await Tesseract.createWorker('eng')
  const pdf       = item.pdfDoc
  const pageTexts = item.pages.map(p => p.text)  // per-page copy, index 0 = page 1
  try {
    for (let i = 0; i < item.emptyPageNums.length; i++) {
      const pageNum  = item.emptyPageNums[i]
      setHealth('warn', 'OCR ' + (i + 1) + '/' + item.emptyPageNums.length)
      toast('OCR: scanning page ' + pageNum + ' of ' + pdf.numPages + '...', 'info')
      const page     = await pdf.getPage(pageNum)
      const viewport = page.getViewport({ scale: 2.0 })  // 2× for better accuracy
      const canvas   = document.createElement('canvas')
      canvas.width   = viewport.width
      canvas.height  = viewport.height
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
      const { data: { text } } = await worker.recognize(canvas)
      pageTexts[pageNum - 1] = text.trim()
    }
  } finally {
    await worker.terminate()
    setHealth('ok', connectedLabel())
  }
  item.extractedText = pageTexts.join('\n').trim()
  item.scanWarning   = null  // resolved — all pages now have text
}

// =============================================================================
// File preview queue
// =============================================================================
let previewQueue   = []   // { name, size, extractedText, confirmed }
let previewTarget  = null // 'attach' | 'docs'
let previewTabIdx  = 0

// ---------------------------------------------------------------------------
// merged from 42-files-preview.js
// ---------------------------------------------------------------------------

async function queueFilesForPreview(files, target) {
  if (typeof demoOn === 'function' && demoOn()) {
    files = demoCapFiles(Array.from(files), target)
    if (!files.length) return
  }
  const valid = Array.from(files)
  if (!valid.length) return

  previewTarget = target
  previewQueue  = []
  previewTabIdx = 0

  toast('Extracting text...', 'info')
  for (const f of valid) {
    try {
      const { text, scanWarning, pdfDoc, emptyPageNums, pages } = await extractText(f)
      previewQueue.push({ name: f.name, size: f.size, extractedText: text, scanWarning, pdfDoc, emptyPageNums, pages })
    } catch (err) {
      toast('Could not read ' + f.name + ': ' + err.message, 'err')
    }
  }

  if (!previewQueue.length) return

  // Embed flow: skip the text-preview panel entirely. Users uploading a file
  // for RAG want the whole file embedded as-is; showing a preview-and-edit
  // step is misleading. One confirmation dialog with file name + size is
  // enough.
  if (target === 'docs') {
    // If any files have scanned pages, offer to OCR them before embedding.
    const scannedItems = previewQueue.filter(f => f.scanWarning && f.pdfDoc)
    if (scannedItems.length) {
      const ocrList = scannedItems.map(f => '  - ' + f.name + ': ' + f.scanWarning).join('\n')
      const doOcr = confirm(
        '⚠️ Scanned pages detected:\n\n' + ocrList + '\n\n' +
        'Run OCR on the scanned pages before embedding?\n\n' +
        'OK     = Run OCR first (recommended — ~3 MB one-time download, cached)\n' +
        'Cancel = Embed as-is (scanned pages will be missing from context)'
      )
      if (doOcr) {
        for (const item of scannedItems) {
          try {
            await ocrQueueItem(item)
            toast(item.name + ' — OCR complete', 'ok')
          } catch (e) {
            toast('OCR failed for ' + item.name + ': ' + e.message, 'err')
          }
        }
      }
    }

    const items = previewQueue.slice()
    previewQueue  = []
    previewTarget = null
    await commitDocs(items)
    // Reset the DOCS picker (id="doc-file-in"), not the attach input — otherwise
    // its value stays set and re-selecting the SAME filename won't refire the
    // change event, so the upload silently does nothing. (file-in is reset
    // separately on the attach/preview path.)
    const docIn = document.getElementById('doc-file-in')
    if (docIn) docIn.value = ''
    return
  }

  // Attach-to-message flow: keep the preview panel so the user can edit
  // the extracted text before sending it into chat context.
  showFilePreview()
}

function showFilePreview() {
  document.getElementById('messages').style.display = 'none'
  document.getElementById('input-wrap').style.display = 'none'
  const panel = document.getElementById('file-preview')
  panel.classList.remove('hidden')
  renderPreviewTabs()
  selectPreviewTab(0)
  updateFpHint()
}

function renderPreviewTabs() {
  const tabsEl = document.getElementById('fp-tabs')
  tabsEl.innerHTML = previewQueue.map((f, i) => `
    <div class="fp-tab ${i === previewTabIdx ? 'active' : ''}" onclick="selectPreviewTab(${i})">
      ${esc(f.name)}
    </div>`).join('')
}

function selectPreviewTab(i) {
  previewTabIdx = i
  renderPreviewTabs()
  const f = previewQueue[i]
  if (!f) return
  document.getElementById('fp-filename').textContent = f.name
  const ta = document.getElementById('fp-textarea')
  ta.value = f.extractedText
  updateCharCount()
  updateFpHint()
}

function updateFpHint() {
  const total = previewQueue.length
  const hint  = document.getElementById('fp-hint')
  if (!hint) return
  const f = previewQueue[previewTabIdx]
  let text = total > 1
    ? `File ${previewTabIdx + 1} of ${total} — review each tab before confirming`
    : 'Review and edit the text above if needed'
  if (f?.scanWarning) text += ' · ⚠️ ' + f.scanWarning
  hint.textContent = text
}

function updateCharCount() {
  const ta  = document.getElementById('fp-textarea')
  const cnt = ta.value.length
  document.getElementById('fp-charcount').textContent = cnt.toLocaleString() + ' chars'
  // Keep extractedText in sync as user edits
  if (previewQueue[previewTabIdx]) previewQueue[previewTabIdx].extractedText = ta.value
}

// fp-textarea input wired up in Boot section below

function cancelFilePreview() {
  previewQueue  = []
  previewTarget = null
  document.getElementById('file-preview').classList.add('hidden')
  document.getElementById('messages').style.display = ''
  document.getElementById('input-wrap').style.display = ''
  document.getElementById('file-in').value = ''
}

async function confirmFilePreview() {
  // Sync final edits from active textarea
  const ta = document.getElementById('fp-textarea')
  if (previewQueue[previewTabIdx]) previewQueue[previewTabIdx].extractedText = ta.value

  const files = previewQueue.slice()
  previewQueue  = []
  previewTarget === 'attach' ? commitAttachments(files) : await commitDocs(files)
  previewTarget = null
  document.getElementById('file-preview').classList.add('hidden')
  document.getElementById('messages').style.display = ''
  document.getElementById('input-wrap').style.display = ''
  document.getElementById('file-in').value = ''
}

function commitAttachments(files) {
  for (const f of files) {
    attachments.push({ name: f.name, textContent: f.extractedText, isText: true })
  }
  renderChips()
}

async function commitDocs(files) {
  const chat = curChat(); if (!chat) return
  if (!Array.isArray(chat.docs)) chat.docs = []
  for (const f of files) {
    const doc = {
      id: 'doc_' + Date.now() + '_' + Math.random().toString(36).slice(2),
      name: f.name, size: f.size, content: f.extractedText,
      chunks: [], status: creds ? 'pending' : 'ready', addedAt: Date.now()
    }
    chat.docs.push(doc)
    renderDocPanel(); updateDocsBtn()
    if (creds) {
      toast('Embedding ' + f.name + '...', 'info')
      await embedDoc(doc)
    } else {
      toast(f.name + ' added (connect to embed for RAG)', 'info')
    }
  }
  await persist(); renderDocPanel(); updateDocsBtn()
}
// File-input change handlers: attachments go to the preview panel, doc
// uploads go straight to the embed flow.
function handleAttach(files) {
  if (files && files.length) queueFilesForPreview(files, 'attach')
}

function uploadDocs(files) {
  if (files && files.length) queueFilesForPreview(files, 'docs')
}

// Render attachment chips in the composer from the `attachments` array.
function renderChips() {
  const el = document.getElementById('chips')
  if (!el) return
  el.innerHTML = attachments.map((a, i) =>
    '<div class="chip">' + esc(a.name) +
    '<span class="chip-x" title="Remove" onclick="attachments.splice(' + i + ',1); renderChips()">\u2715</span>' +
    '</div>'
  ).join('')
}

// ---------------------------------------------------------------------------
// merged from 43-files-embed.js
// ---------------------------------------------------------------------------

// Budget warning message + confirm dialog. Returns true to proceed with the embed.
async function confirmEmbedBudget(name, nChunks, est, caps) {
  const k = n => n >= 1000 ? Math.round(n / 1000) + 'k' : String(Math.max(0, Math.round(n)))
  let msg = name + ' is ~' + nChunks + ' chunks (~' + k(est) + ' tokens).'
  if (caps.remaining != null) msg += ' About ' + k(caps.remaining) + ' left this minute' + (est > caps.remaining ? ' \u2014 this is more than that' : '') + '.'
  if (caps.limit) { const mins = Math.ceil(est / caps.limit); if (mins > 1) msg += ' It may queue and take ~' + mins + ' min on the shared ' + k(caps.limit) + '/min limit.' }
  msg += ' Embed anyway?'
  return confirmDialog({ title: 'Embed large file?', message: msg, okText: 'Embed anyway', cancelText: 'Cancel' })
}

async function embedDoc(doc) {
  // Embeds doc chunks via /api/embed-batch (SSE or cached JSON). In #demo this
  // takes the same real path; the server returns deterministic demo vectors.
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
      // Token-budget gate (Phase 2): estimate this embed plus recent embeds in the
      // last 60s; warn if it crosses the soft cap or exceeds what is left this
      // minute. Cancel aborts without sending anything.
      const _est = estTokens(toEmbed)
      const _caps = resolveEmbedCaps()
      const _recent = recentEmbedTokens()
      const _over = _est > _caps.warn || (_est + _recent) > _caps.warn || (_caps.remaining != null && _est > _caps.remaining)
      if (_over && typeof confirmDialog === 'function') {
        const proceed = await confirmEmbedBudget(doc.name, toEmbed.length, _est, _caps)
        if (!proceed) {
          doc.status = (doc.chunks && doc.chunks.length) ? 'ready' : 'pending'
          doc.embedProgress = null
          toast('Embedding cancelled', 'info')
          setHealth('ok', connectedLabel())
          renderDocPanel()
          return
        }
      }
      // Show a persistent per-doc progress bar (renderDocPanel) driven by the
      // SSE progress/pacing events forwarded from embedBatch.
      doc.status = 'embedding'
      doc.error  = null
      doc.embedProgress = { state: 'embedding', done: 0, total: toEmbed.length, batchDone: 0, batchTotal: 0 }
      renderDocPanel()
      const { hashes } = await embedBatch(toEmbed, prog => {
        doc.embedProgress = prog
        renderDocPanel()
      })
      noteEmbed(_est)
      for (let k = 0; k < toEmbedIdx.length; k++) {
        chunks[toEmbedIdx[k]] = { text: toEmbed[k], embHash: hashes[k] }
      }
    }
    doc.chunks = chunks.filter(Boolean)
    doc.status = 'ready'
    doc.embedProgress = null
    persist()
    setHealth('ok', connectedLabel())
    toast(doc.name + ' embedded (' + doc.chunks.length + ' chunks)', 'ok')
    renderDocPanel()
    if (typeof renderBudget === 'function') renderBudget()
  } catch (e) {
    doc.status = 'error'
    doc.error  = e.message
    doc.embedProgress = null
    toast('Embed failed: ' + e.message, 'err')
    setHealth('ok', connectedLabel())
    renderDocPanel()
  }
}
// Retry embedding a single doc that previously failed. Chunks already embedded
// keep their embHash and are skipped inside embedDoc, so a retry RESUMES from
// where it stopped rather than re-embedding everything.
async function retryEmbed(id, event) {
  if (event) event.stopPropagation()
  const chat = curChat(); if (!chat || !Array.isArray(chat.docs)) return
  const doc = chat.docs.find(d => d.id === id)
  if (!doc) return
  await embedDoc(doc)
  await persist()
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
