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

// Structured extraction helpers. These keep parser output RAG-friendly while
// remaining browser-only. PDF uses pdf.js coordinates; DOCX uses Mammoth HTML.
const PDFJS_WORKER_SRC = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.worker.min.mjs'

async function ensurePdfJsReady() {
  // pdf.js v5 is an ES module (loaded in <head>); window.pdfjsLib is set once it
  // resolves. Poll briefly so a very-early upload doesn't race the module load.
  for (let i = 0; i < 100 && typeof pdfjsLib === 'undefined'; i++) {
    await new Promise(r => setTimeout(r, 50))
  }
  if (typeof pdfjsLib === 'undefined') throw new Error('PDF needs pdf.js library (module not loaded)')
  if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC
  }
}

async function loadPdfDocumentFromBytes(bytes) {
  await ensurePdfJsReady()
  const first = bytes.slice ? bytes.slice() : new Uint8Array(bytes)
  try {
    return await pdfjsLib.getDocument({ data: first, verbosity: 0 }).promise
  } catch (e) {
    // Corporate proxies/CDN blockers sometimes return HTML for pdf.worker.min.js,
    // which shows up in the browser as a PDF "content type"/MIME error. Retry
    // with workers disabled so extraction can still proceed entirely in-page.
    if (/worker|module|mime|content.?type|script/i.test(String(e && e.message || e))) {
      console.warn('[pdf] worker failed; retrying with disableWorker:', e.message || e)
      const second = bytes.slice ? bytes.slice() : new Uint8Array(bytes)
      return await pdfjsLib.getDocument({ data: second, verbosity: 0, disableWorker: true }).promise
    }
    throw e
  }
}

function pdfItemsToLines(items) {
  const clean = (items || []).filter(it => it && it.str && it.str.trim()).map(it => ({
    text: it.str.trim(),
    x: it.transform ? it.transform[4] : 0,
    y: it.transform ? it.transform[5] : 0,
    h: Math.abs((it.transform && (it.transform[3] || it.transform[0])) || 0)
  }))
  clean.sort((a,b) => Math.abs(b.y - a.y) > 3 ? b.y - a.y : a.x - b.x)
  const lines = []
  for (const item of clean) {
    let line = lines.find(l => Math.abs(l.y - item.y) <= 3)
    if (!line) { line = { y: item.y, items: [] }; lines.push(line) }
    line.items.push(item)
  }
  return lines.map(l => {
    const sorted = l.items.sort((a,b)=>a.x-b.x)
    return {
      y: l.y,
      text: sorted.map(i=>i.text).join(' ').replace(/\s+/g, ' ').trim(),
      avgFontHeight: sorted.reduce((n,i)=>n+(i.h||0),0) / Math.max(1, sorted.length)
    }
  }).filter(l => l.text)
}

function pdfLinesToStructuredText(lines) {
  if (!lines || !lines.length) return ''
  const sizes = lines.map(l => l.avgFontHeight).filter(Boolean).sort((a,b)=>a-b)
  const median = sizes[Math.floor(sizes.length / 2)] || 10
  const out = []
  for (const line of lines) {
    const t = line.text.trim()
    if (!t) continue
    const looksHeading =
      line.avgFontHeight > median * 1.25 ||
      /^\d+(\.\d+)*\s+[A-Z]/.test(t) ||
      (/^[A-Z0-9 /&()\-:]{8,}$/.test(t) && t.length < 120)
    out.push((looksHeading ? '## ' : '') + t)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

async function extractPdfStructured(file) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const pdf = await loadPdfDocumentFromBytes(bytes)
  const totalPages = pdf.numPages
  const pages = []
  const emptyPageNums = []

  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i)
    const tc = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false })
    const lines = pdfItemsToLines(tc.items)
    let pageText = pdfLinesToStructuredText(lines).trim()
    if (!pageText) {
      // Fallback: if coordinate grouping fails, preserve the raw pdf.js text runs.
      pageText = (tc.items || []).map(it => it && it.str ? it.str : '').join(' ').replace(/\s+/g, ' ').trim()
    }
    if (!pageText) emptyPageNums.push(i)
    pages.push({ pageNum: i, text: pageText, lines })
  }

  const text = pages.map(p => '=== Page ' + p.pageNum + ' ===\n' + (p.text || '')).join('\n\n').trim() || '[No text found in PDF]'
  const emptyShare = totalPages ? emptyPageNums.length / totalPages : 0
  const looksScanned = emptyPageNums.length >= CFG.SCAN_MIN_PAGES && emptyShare >= CFG.SCAN_MIN_SHARE
  const scanWarning = looksScanned
    ? emptyPageNums.length + ' of ' + totalPages + ' pages had no extractable text - this PDF may be partially or fully scanned. Embedded content will be incomplete.'
    : null
  return { text, scanWarning, pdfDoc: scanWarning ? pdf : null, emptyPageNums, pages, structure: { kind: 'pdf-structured', totalPages } }
}
function tableToMarkdown(table) {
  const rows = [...table.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.textContent.replace(/\s+/g, ' ').trim()))
  if (!rows.length) return ''
  const width = Math.max(...rows.map(r => r.length))
  const norm = rows.map(r => [...r, ...Array(width - r.length).fill('')])
  const header = norm[0]
  const sep = header.map(() => '---')
  return [header, sep, ...norm.slice(1)].map(r => '| ' + r.join(' | ') + ' |').join('\n')
}

function htmlToRagText(html) {
  const dom = new DOMParser().parseFromString(html || '', 'text/html')
  const out = []
  function emit(s) { s = String(s || '').replace(/\s+/g, ' ').trim(); if (s) out.push(s) }
  function walk(node) {
    for (const el of [...node.children]) {
      const tag = el.tagName.toLowerCase()
      if (tag === 'h1') out.push('\n# ' + el.textContent.trim() + '\n')
      else if (tag === 'h2') out.push('\n## ' + el.textContent.trim() + '\n')
      else if (tag === 'h3') out.push('\n### ' + el.textContent.trim() + '\n')
      else if (tag === 'h4') out.push('\n#### ' + el.textContent.trim() + '\n')
      else if (tag === 'p') emit(el.textContent)
      else if (tag === 'li') emit('- ' + el.textContent)
      else if (tag === 'table') out.push('\n[TABLE]\n' + tableToMarkdown(el) + '\n[/TABLE]\n')
      else walk(el)
    }
  }
  walk(dom.body)
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function decodeXmlEntities(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&')
}

function xmlTextRuns(xml) {
  const out = []
  const re = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g
  let m
  while ((m = re.exec(xml || ''))) out.push(decodeXmlEntities(m[1]))
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

async function extractDocxWithZip(ab) {
  if (typeof JSZip === 'undefined') throw new Error('DOCX fallback needs JSZip library')
  const zip = await JSZip.loadAsync(ab)
  const parts = []
  const docFile = zip.file('word/document.xml')
  if (docFile) parts.push(await docFile.async('string'))
  const headerFooter = Object.keys(zip.files).filter(n => /^word\/(header|footer)\d+\.xml$/.test(n)).sort()
  for (const n of headerFooter) parts.push(await zip.file(n).async('string'))
  const text = parts.map(xmlTextRuns).filter(Boolean).join('\n\n')
  return text || '[No text found in DOCX]'
}

async function extractDocxStructured(file) {
  const ab = await file.arrayBuffer()
  const warnings = []

  if (typeof mammoth !== 'undefined') {
    try {
      const result = await mammoth.convertToHtml({ arrayBuffer: ab.slice(0) }, {
        styleMap: [
          "p[style-name='Title'] => h1:fresh",
          "p[style-name='Subtitle'] => h2:fresh",
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh",
          "p[style-name='Heading 4'] => h4:fresh"
        ],
        includeDefaultStyleMap: true
      })
      let text = inferHeadingNumbers(htmlToRagText(result.value || ''))
      if (!text) {
        const raw = await mammoth.extractRawText({ arrayBuffer: ab.slice(0) })
        text = inferHeadingNumbers((raw.value || '').trim())
      }
      if (result.messages && result.messages.length) warnings.push('DOCX parsed with ' + result.messages.length + ' Mammoth warning(s).')
      return { text: text || '[No text found in DOCX]', scanWarning: null, parseWarning: warnings.join(' '), structure: { kind: 'docx-html' } }
    } catch (e) {
      warnings.push('Mammoth failed (' + e.message + '); used DOCX XML fallback.')
    }
  } else {
    warnings.push('Mammoth library unavailable; used DOCX XML fallback.')
  }

  const fallbackText = inferHeadingNumbers(await extractDocxWithZip(ab.slice(0)))
  return { text: fallbackText, scanWarning: null, parseWarning: warnings.join(' '), structure: { kind: 'docx-xml-fallback' } }
}
// File-type extractor registry: extension -> async (file) => { text, scanWarning, ... }.
// Adding a new file type is a single entry here; preview/embed stay generic.
async function extractXlsxStructured(file) {
  if (typeof XLSX === 'undefined') throw new Error('Spreadsheet parsing needs the XLSX library')
  const ab = await file.arrayBuffer()
  const wb = XLSX.read(ab, { type: 'array', cellDates: true, dense: false })
  const blocks = []
  for (const name of wb.SheetNames || []) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false, FS: ',', RS: '\n' }).trim()
    if (csv) blocks.push('=== Sheet: ' + name + ' ===\n' + csv)
  }
  return { text: blocks.join('\n\n').trim() || '[No data found in spreadsheet]', scanWarning: null, structure: { kind: 'xlsx-sheets', sheetCount: (wb.SheetNames || []).length } }
}

function pptxResolveTarget(baseName, target) {
  if (!target) return null
  if (target.startsWith('/')) return target.replace(/^\//, '')
  const baseParts = baseName.split('/'); baseParts.pop()
  for (const part of target.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') baseParts.pop()
    else baseParts.push(part)
  }
  return baseParts.join('/')
}

async function extractPptxStructured(file) {
  if (typeof JSZip === 'undefined') throw new Error('PPTX needs the JSZip library')
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const runs = xml => {
    const out = []
    const re = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g
    let m
    while ((m = re.exec(xml || ''))) out.push(m[1])
    return decodeXmlEntities(out.join(' ')).replace(/\s+/g, ' ').trim()
  }
  const num = n => { const m = n.match(/slide(\d+)\.xml$/); return m ? +m[1] : 0 }
  const slides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b))
  const blocks = []
  let empty = 0
  for (let i = 0; i < slides.length; i++) {
    const slideName = slides[i]
    const body = runs(await zip.file(slideName).async('string'))
    let notes = ''
    const relsName = 'ppt/slides/_rels/' + slideName.split('/').pop() + '.rels'
    const relsFile = zip.file(relsName)
    if (relsFile) {
      const relsXml = await relsFile.async('string')
      const rm = relsXml.match(/Type="[^"]*notesSlide"[^>]*Target="([^"]+)"/i) || relsXml.match(/Target="([^"]*notesSlide\d+\.xml)"/i)
      const np = rm ? pptxResolveTarget(slideName, rm[1]) : null
      if (np && zip.file(np)) notes = runs(await zip.file(np).async('string'))
    }
    if (!body && !notes) empty++
    let block = '=== Slide ' + (i + 1) + ' ===\n' + (body || '[no slide text]')
    if (notes) block += '\n[Notes] ' + notes
    blocks.push(block)
  }
  const text = blocks.join('\n\n').trim() || '[No text found in PPTX]'
  const total = slides.length
  const imageOnly = total > 0 && empty >= (CFG.SCAN_MIN_PAGES || 2) && (empty / total) >= (CFG.SCAN_MIN_SHARE || 0.15)
  const scanWarning = imageOnly
    ? empty + ' of ' + total + ' slides had no extractable text - this deck may be image-only. Embedded content will be incomplete.'
    : null
  return { text, scanWarning, structure: { kind: 'pptx-slides', slideCount: total } }
}

async function extractLegacyPptText(file) {
  const ab = await file.arrayBuffer()
  const u8 = new Uint8Array(ab)
  const ascii = new TextDecoder('latin1').decode(u8)
  const utf16 = new TextDecoder('utf-16le').decode(u8)
  const strings = []
  const addMatches = (s) => {
    const re = /[\p{L}\p{N}\p{P}\p{Zs}]{5,}/gu
    let m
    while ((m = re.exec(s || ''))) {
      const t = m[0].replace(/\s+/g, ' ').trim()
      if (t.length >= 5 && !/^\d+$/.test(t)) strings.push(t)
    }
  }
  addMatches(ascii)
  addMatches(utf16)
  const seen = new Set()
  const cleaned = strings.filter(t => {
    const key = t.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 2000)
  const text = cleaned.join('\n')
  if (!text) throw new Error('No readable text found in legacy .ppt. Save as .pptx or PDF and upload again.')
  return { text, scanWarning: 'Legacy .ppt was parsed with best-effort binary text extraction. For reliable slide order/layout, save as .pptx or PDF.', structure: { kind: 'ppt-legacy-best-effort' } }
}

const EXTRACTORS = {
  pdf:  async (file) => extractPdfStructured(file),
  docx: async (file) => extractDocxStructured(file),
  xlsx: async (file) => extractXlsxStructured(file),
  xlsm: async (file) => extractXlsxStructured(file),
  xls:  async (file) => extractXlsxStructured(file),
  pptx: async (file) => extractPptxStructured(file),
  pptm: async (file) => extractPptxStructured(file),
  ppsx: async (file) => extractPptxStructured(file),
  potx: async (file) => extractPptxStructured(file),
  ppt:  async (file) => extractLegacyPptText(file),
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
        resolve({ text: s, scanWarning: null, structure: { kind: 'plain-text' } })
      }
    }
    r.onerror = () => reject(new Error('read error'))
    r.readAsText(file)
  }),
}

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
  if (typeof lclCrumb === 'function') lclCrumb('attach_files', { count: valid.length, target: target, bytes: valid.reduce((n, f) => n + (f.size || 0), 0) })

  previewTarget = target
  previewQueue  = []
  previewTabIdx = 0

  toast('Extracting text...', 'info')
  for (const f of valid) {
    try {
      const extracted = await extractText(f)
      const { text, scanWarning, pdfDoc, emptyPageNums, pages, structure, parseWarning } = extracted
      previewQueue.push({ name: f.name, size: f.size, extractedText: text, scanWarning, parseWarning, pdfDoc, emptyPageNums, pages, structure })
      if (parseWarning) toast(f.name + ': ' + parseWarning, 'info')
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
    document.getElementById('file-in').value = ''
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
  if (f?.scanWarning) text += ' · Warning: ' + f.scanWarning
  if (f?.parseWarning) text += ' · Note: ' + f.parseWarning
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
  // Add ALL dropped files up front (pending), then embed them sequentially — so a
  // multi-file drop shows every file queued at once (pending cards greyed) instead
  // of appearing one at a time as each finishes embedding.
  const added = []
  let skipped = 0
  for (const f of files) {
    // Don't re-embed a file already embedded in this chat (match name + size).
    if (chat.docs.some(d => d.name === f.name && d.size === f.size)) { skipped++; continue }
    const doc = {
      id: 'doc_' + Date.now() + '_' + Math.random().toString(36).slice(2),
      name: f.name, size: f.size, content: f.extractedText,
      structure: f.structure || null, sections: [], docAliases: [],
      chunks: [], status: creds ? 'pending' : 'ready', addedAt: Date.now()
    }
    doc.docAliases = buildDocAliases(doc)
    chat.docs.push(doc)
    added.push(doc)
  }
  if (skipped) toast(skipped + (skipped > 1 ? ' files' : ' file') + ' already embedded \u2014 skipped', 'info')
  renderDocPanel(); updateDocsBtn()
  if (creds) {
    // Plan every file up front so a multi-file drop shows ONE budget dialog
    // (per-file size + estimated time) instead of a separate prompt per file.
    if (typeof refreshBudget === 'function') await refreshBudget()
    const caps = resolveEmbedCaps()
    const plans = added.map(doc => ({ doc, plan: planDocEmbed(doc) }))
    const totalEst = plans.reduce((s, p) => s + p.plan.est, 0)
    const recent = (typeof recentEmbedTokens === 'function') ? recentEmbedTokens() : 0
    const over = (caps.remaining != null && (totalEst + recent) > caps.remaining)
      || (caps.warnOverride != null && totalEst > caps.warnOverride)
      || (totalEst > caps.hard)
    let selectedIds = null
    if (over && plans.some(p => p.plan.toEmbed.length) && typeof confirmEmbedBatch === 'function') {
      selectedIds = await confirmEmbedBatch(plans, caps)
      if (!selectedIds) {
        for (const p of plans) {
          for (const ch of Object.values(D.chats || {})) if (Array.isArray(ch.docs)) ch.docs = ch.docs.filter(d => d.id !== p.doc.id)
        }
        toast('Embedding cancelled', 'info')
        renderDocPanel(); updateDocsBtn(); await persist(); return
      }
    }
    const sel = new Set(selectedIds || plans.map(p => p.doc.id))
    for (const p of plans) {
      if (sel.has(p.doc.id)) continue
      for (const ch of Object.values(D.chats || {})) if (Array.isArray(ch.docs)) ch.docs = ch.docs.filter(d => d.id !== p.doc.id)
    }
    renderDocPanel()
    for (const p of plans) {
      if (!sel.has(p.doc.id)) continue
      toast('Embedding ' + p.doc.name + '...', 'info')
      await embedDoc(p.doc, { plan: p.plan, skipGate: true })
    }
  } else {
    toast(added.length > 1 ? (added.length + ' files added (connect to embed for RAG)')
                           : ((added[0] ? added[0].name : 'File') + ' added (connect to embed for RAG)'), 'info')
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

// Budget warning message + confirm dialog (alpha Phase 2). True = proceed.
async function confirmEmbedBudget(name, nChunks, est, caps) {
  const k = n => n >= 1000 ? Math.round(n / 1000) + 'k' : String(Math.max(0, Math.round(n)))
  let msg = name + ' is ~' + nChunks + ' chunks (~' + k(est) + ' tokens).'
  if (caps.remaining != null) msg += ' About ' + k(caps.remaining) + ' left this minute' + (est > caps.remaining ? ' \u2014 this is more than that' : '') + '.'
  if (caps.limit) { const mins = Math.ceil(est / caps.limit); if (mins > 1) msg += ' It may queue and take ~' + mins + ' min on the shared ' + k(caps.limit) + '/min limit.' }
  msg += ' Embed anyway?'
  return confirmDialog({ title: 'Embed large file?', message: msg, okText: 'Embed anyway', cancelText: 'Cancel' })
}
// Plan a doc's embedding WITHOUT running it: chunk, reuse unchanged chunks, and
// return the work + token estimate. Shared by embedDoc and the batch dialog so a
// multi-file drop can be summarised (size + time) before any embedding starts.
function planDocEmbed(doc) {
  const embedModel = creds.embedModelId
  let size = creds.chunkSize || CFG.DEFAULT_CHUNK_SIZE || 800
  const _embMax = (typeof getEmbedMaxTokens === 'function') ? getEmbedMaxTokens(embedModel) : null
  if (_embMax) size = Math.min(size, Math.floor(_embMax * 4 * 0.9))
  const records = makeRagChunks(doc, size)
  const raw = records.map(r => r.text)
  const existing = Array.isArray(doc.chunks) ? doc.chunks : []
  const chunks = new Array(raw.length).fill(null)
  const toEmbed = [], toEmbedIdx = []
  for (let i = 0; i < raw.length; i++) {
    const rec = records[i]
    if (existing[i]?.text === raw[i] && existing[i]?.embHash) {
      const embHash = existing[i].embHash
      chunks[i] = { ...rec, embHash, chunkId: existing[i].chunkId || makeChunkId(doc, rec, i, embHash), ...(Array.isArray(existing[i].embedding) ? { embedding: existing[i].embedding } : {}) }
    } else {
      toEmbed.push(raw[i]); toEmbedIdx.push(i)
    }
  }
  return { size, records, chunks, toEmbed, toEmbedIdx, est: estTokens(toEmbed) }
}
async function embedDoc(doc, opts) {
  // Embeds doc chunks via /api/embed-batch (SSE or cached JSON). In #demo this
  // takes the same real path; the server returns deterministic demo vectors.
  // Normally only the 16-char SHA-1 hash is stored per chunk (embHash);
  // vectors live in the server cache and are retrieved later through
  // /api/embed-lookup. Upload embeddings always use /api/embed-batch.
  try {
    if (!creds?.embedApiKey || !creds?.embedModelId) {
      throw new Error('Embedding API key / model not configured')
    }
    const plan = (opts && opts.plan) || planDocEmbed(doc)
    const { records, chunks, toEmbed, toEmbedIdx } = plan
    if (!records.length) {
      doc.chunks = []; doc.status = 'ready'
      toast(doc.name + ' ready (no chunks)', 'ok')
      renderDocPanel(); return
    }
    setHealth('warn', 'Embedding 0/' + records.length)

    if (toEmbed.length) {
      // Token-budget gate (alpha Phase 2): warn only when this embed + recent
      // embeds won't fit in the tokens left this minute, exceed the hard cap, or
      // a Settings "warn above" override. Refresh the snapshot first; Cancel aborts.
      const _est = plan.est
      if (typeof refreshBudget === 'function') await refreshBudget()
      const _caps = resolveEmbedCaps()
      const _recent = recentEmbedTokens()
      const _over = (_caps.remaining != null && (_est + _recent) > _caps.remaining)
        || (_caps.warnOverride != null && _est > _caps.warnOverride)
        || (_est > _caps.hard)
      if (!(opts && opts.skipGate) && _over && typeof confirmDialog === 'function') {
        const proceed = await confirmEmbedBudget(doc.name, toEmbed.length, _est, _caps)
        if (!proceed) {
          if (doc.chunks && doc.chunks.length) {
            doc.status = 'ready'; doc.embedProgress = null
            toast('Embedding cancelled', 'info')
          } else {
            for (const ch of Object.values(D.chats || {})) {
              if (Array.isArray(ch.docs)) ch.docs = ch.docs.filter(d => d.id !== doc.id)
            }
            toast('Embedding cancelled \u2014 ' + doc.name + ' removed', 'info')
          }
          setHealth('ok', connectedLabel())
          await persist(); renderDocPanel(); updateDocsBtn()
          return
        }
      }
      // Persistent per-doc progress bar driven by embedBatch's SSE progress/pacing.
      doc.status = 'embedding'; doc.error = null
      doc.embedProgress = { state: 'embedding', done: 0, total: toEmbed.length, batchDone: 0, batchTotal: 0 }
      renderDocPanel()
      const { hashes, embeddings, storeVectors } = await embedBatch(toEmbed, prog => {
        doc.embedProgress = prog; renderDocPanel()
      })
      noteEmbed(_est)
      for (let k = 0; k < toEmbedIdx.length; k++) {
        const idx = toEmbedIdx[k]
        const rec = records[idx]
        const embHash = hashes[k]
        chunks[idx] = {
          ...rec,
          embHash,
          chunkId: makeChunkId(doc, rec, idx, embHash),
          ...(storeVectors && Array.isArray(embeddings?.[k]) ? { embedding: embeddings[k] } : {})
        }
      }
    }

    doc.chunks = chunks.filter(Boolean)
    ragKeywordIndexCache = { signature: '', index: null, records: [] }
    doc.status = 'ready'
    doc.embedProgress = null
    persist()
    setHealth('ok', connectedLabel())
    toast(doc.name + ' embedded (' + doc.chunks.length + ' chunks)', 'ok')
    renderDocPanel()
    if (typeof refreshBudget === 'function') refreshBudget()
  } catch (e) {
    doc.status = 'error'
    doc.error  = e.message
    doc.embedProgress = null
    toast('Embed failed: ' + e.message, 'err')
    setHealth('ok', connectedLabel())
    renderDocPanel()
  }
}
// Retry embedding a doc that previously failed. Chunks already embedded keep
// their embHash and are skipped inside embedDoc, so retry RESUMES.
async function retryEmbed(id, event) {
  if (event) event.stopPropagation()
  const found = findDocInAnyChat(id)
  if (!found) return
  await embedDoc(found.doc)
  await persist()
}
// Remove an embedded document across all chats (shared RAG memory), then GC
// orphaned vectors. Optimistic: card drops + panel refreshes immediately.
async function removeDoc(id, event) {
  if (event) event.stopPropagation()
  const found = findDocInAnyChat(id)
  if (!found) return
  const doc = found.doc
  for (const ch of Object.values(D.chats || {})) {
    if (!Array.isArray(ch.docs)) continue
    ch.docs = ch.docs.filter(d => d.id !== id)
  }
  ragKeywordIndexCache = { signature: '', index: null, records: [] }
  renderDocPanel(); updateDocsBtn()
  toast('Removed ' + doc.name + ' from RAG memory', 'ok')
  ;(async () => {
    try { await persist() } catch (e) { console.warn('[removeDoc] persist', e.message) }
    try { await gcEmbedCache() } catch (e) { console.warn('[removeDoc] gc', e.message) }
  })()
}
