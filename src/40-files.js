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
      // Mammoth WARNINGS are log-only (console in full + first 3 to the server log)
      // - they are cosmetic (unrecognised styles, skipped text boxes/TOC fields) and
      // don't merit a toast. parseWarning (which toasts) is reserved for real
      // failures: the catch branch below and the library-unavailable fallback.
      if (result.messages && result.messages.length) {
        try { console.warn('[docx] Mammoth warnings for ' + file.name + ':', result.messages.map(m => (m.type || 'warn') + ': ' + m.message)) } catch {}
        if (typeof lclCrumb === 'function') lclCrumb('docx_warnings', { doc: file.name, n: result.messages.length, first: result.messages.slice(0, 3).map(m => String(m.message || '').slice(0, 90)) })
      }
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

function imageExtractor(file) {
  return Promise.resolve({ text: '', scanWarning: 'Image file - run OCR to extract text.', ocrFile: file, structure: { kind: 'image' } })
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
  png:  (file) => imageExtractor(file),
  jpg:  (file) => imageExtractor(file),
  jpeg: (file) => imageExtractor(file),
  webp: (file) => imageExtractor(file),
  bmp:  (file) => imageExtractor(file),
  gif:  (file) => imageExtractor(file),
  tif:  (file) => imageExtractor(file),
  tiff: (file) => imageExtractor(file),
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

// --- Tesseract OCR engine -------------------------------------------------
// tesseract.js already defaults workerPath + corePath to jsDelivr (reachable
// here); only langPath defaults to the upstream tessdata host, which is blocked
// on the gov network - point it at the SAME language data mirrored on jsDelivr.
// A single PERSISTENT worker is reused. cacheMethod:'none' disables Tesseract's
// IndexedDB cache: gov Edge "tracking prevention" blocks storage access for the
// CDN worker (surfaces as an opaque "Script error. 0:0" and breaks OCR), so we
// skip caching and just download the language data into memory once per session.
const TESSERACT_CDN  = 'https://cdn.jsdelivr.net/npm/tesseract.js@4.1.1/dist/tesseract.min.js'
const TESSERACT_LANG = 'https://cdn.jsdelivr.net/gh/naptha/tessdata@gh-pages/4.0.0'

let _ocrWorker = null            // shared Tesseract worker (created once, reused)
let _ocrState  = 'idle'          // 'idle' | 'loading' | 'ready' | 'blocked'

function ocrState() { return _ocrState }
function setOcrState(s) { _ocrState = s; if (typeof renderOcrChip === 'function') renderOcrChip() }

// Live per-run OCR progress for the chip (separate from engine-load state).
let _ocrProg = null
function ocrProgress() { return _ocrProg }
function setOcrProgress(done, total) { _ocrProg = total ? { done: done, total: total } : null; if (typeof renderOcrChip === 'function') renderOcrChip() }

// Single popover toggle: load the engine when idle/blocked, free it when ready.
function toggleOcrEngine() {
  const st = (typeof ocrState === 'function') ? ocrState() : 'idle'
  if (st === 'ready') { clearOcrEngine() }
  else if (st !== 'loading') { enableOcrEngine() }
}

// Offer OCR for scanned files. verb = 'embed' | 'attach'. Resolves to 'ocr'
// (run OCR then proceed), 'plain' (proceed without OCR), or 'cancel' (abort).
async function promptOcr(scannedItems, verb) {
  if (!scannedItems.length) return 'plain'
  if (typeof confirmDialog3 !== 'function') { return confirm('Scanned files detected - run OCR before ' + verb + '?') ? 'ocr' : 'plain' }
  const list = scannedItems.map(f => '- ' + f.name).join('\n')
  const cap = verb.charAt(0).toUpperCase() + verb.slice(1)
  return confirmDialog3({
    title: 'Scanned files detected',
    message: 'These files are scanned images with no selectable text:\n\n' + list + '\n\nRun OCR to read their text first?',
    buttons: [
      { text: 'Run OCR + ' + verb, value: 'ocr', primary: true },
      { text: cap + ' without OCR', value: 'plain' },
      { text: 'Cancel', value: 'cancel' }
    ]
  })
}

// Run OCR on the scanned items; one summary toast at the end.
async function runOcrOnItems(scannedItems) {
  let ocrOk = 0
  for (const item of scannedItems) {
    try { await ocrQueueItem(item); ocrOk++ }
    catch (e) { toast('OCR failed for ' + item.name + ': ' + e.message, 'err') }
  }
  if (ocrOk) toast('OCR done - read ' + ocrOk + ' file' + (ocrOk > 1 ? 's' : ''), 'ok')
}

// Load the script + create ONE worker, reused across files and OCR runs.
async function ensureOcrWorker() {
  if (_ocrWorker) return _ocrWorker
  setOcrState('loading')
  try {
    if (!window.Tesseract) {
      toast('Loading OCR engine (first use downloads it, ~15 MB)...', 'info')
      await loadScript(TESSERACT_CDN)
    }
    // This tesseract.js (v4.1.x) createWorker takes a SINGLE options object as its
    // first arg and does NOT auto-load. langPath MUST go in that first-arg object -
    // passing it later is ignored and it falls back to the default tessdata host,
    // which the gov proxy serves without CORS (fetch blocked). After creating, we
    // must explicitly loadLanguage + initialize or the core stays null and recognize
    // throws "reading 'SetImageFile' of null".
    const w = await Tesseract.createWorker({ langPath: TESSERACT_LANG, cacheMethod: 'none' })
    if (typeof w.loadLanguage === 'function') await w.loadLanguage('eng')
    if (typeof w.initialize === 'function') await w.initialize('eng', 1)
    _ocrWorker = w
    setOcrState('ready')
    return _ocrWorker
  } catch (e) {
    _ocrWorker = null
    setOcrState('blocked')
    throw new Error('OCR engine could not load (the download may be blocked on your network): ' + ((e && e.message) || e))
  }
}

// Terminate the worker + drop the cached engine/language data so the next OCR
// re-downloads fresh. Wired to the OCR chip popover's "Clear engine".
async function clearOcrEngine() {
  try { if (_ocrWorker) await _ocrWorker.terminate() } catch (e) {}
  _ocrWorker = null
  let cleared = false
  try { if (window.indexedDB) { indexedDB.deleteDatabase('keyval-store'); cleared = true } } catch (e) {}
  setOcrState('idle')
  if (typeof toast === 'function') toast(cleared ? 'OCR engine cleared - it re-downloads on next use' : 'OCR engine reset', 'ok')
}

// Force the engine to load now (chip popover "Enable engine") so a blocked
// download is surfaced before the user relies on it.
async function enableOcrEngine() {
  if (typeof toast === 'function') toast('Enabling OCR engine...', 'info')
  try { await ensureOcrWorker(); if (typeof toast === 'function') toast('OCR engine ready', 'ok') }
  catch (e) { if (typeof toast === 'function') toast(e.message, 'err') }
}

// OCR a queued item in place: a scanned PDF (empty pages -> canvas) or an image
// file (item.ocrFile). Patches item.extractedText and clears item.scanWarning.
async function ocrQueueItem(item) {
  const worker = await ensureOcrWorker()
  try {
    if (item.pdfDoc) {
      const pdf = item.pdfDoc
      const pageTexts = item.pages.map(p => p.text)   // index 0 = page 1
      for (let i = 0; i < item.emptyPageNums.length; i++) {
        const pageNum  = item.emptyPageNums[i]
        setHealth('warn', 'OCR ' + (i + 1) + '/' + item.emptyPageNums.length)
        setOcrProgress(i + 1, item.emptyPageNums.length)
        const page     = await pdf.getPage(pageNum)
        const viewport = page.getViewport({ scale: CFG.OCR_SCALE || 2.0 })
        const canvas   = document.createElement('canvas')
        canvas.width   = viewport.width
        canvas.height  = viewport.height
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
        const { data: { text } } = await worker.recognize(canvas)
        pageTexts[pageNum - 1] = (text || '').trim()
      }
      item.extractedText = pageTexts.join('\n').trim()
    } else if (item.ocrFile) {
      setHealth('warn', 'OCR image')
      setOcrProgress(1, 1)
      const { data: { text } } = await worker.recognize(item.ocrFile)
      item.extractedText = (text || '').trim()
    }
    item.scanWarning = null
  } finally {
    setOcrProgress(null, 0)
    setHealth('ok', connectedLabel())
  }
}

// =============================================================================
// File preview queue
// =============================================================================
let previewQueue   = []   // { name, size, extractedText, confirmed }
let previewTarget  = null // 'attach' | 'docs'
let previewTabIdx  = 0
let _previewGen    = 0    // bumped on new queue / cancel / confirm: aborts in-flight extraction

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
  const gen = ++_previewGen

  // Attach flow: open the panel IMMEDIATELY with placeholder rows and fill each
  // in as its extraction completes. Large PDF batches previously left a frozen
  // gap between the "Extracting text..." toast fading and the panel appearing.
  const progressive = target === 'attach'
  if (progressive) {
    previewQueue = valid.map(f => ({ name: f.name, size: f.size, extractedText: '', _extracting: true }))
    showFilePreview()
  } else {
    if (typeof setHealth === 'function') setHealth('warn', 'Reading files...')
  }
  for (let _i = 0; _i < valid.length; _i++) {
    const f = valid[_i]
    const rec = progressive ? previewQueue.find(r => r.name === f.name && r._extracting) : null
    if (progressive && !rec) continue   // row was removed while still queued
    if (typeof setHealth === 'function') setHealth('warn', 'Reading ' + (_i + 1) + '/' + valid.length)
    await new Promise(r => setTimeout(r, 0))   // let the placeholder rows paint before the heavy parse
    if (gen !== _previewGen) return            // cancelled / superseded mid-extraction
    try {
      const extracted = await extractText(f)
      const { text, scanWarning, pdfDoc, ocrFile, emptyPageNums, pages, structure, parseWarning } = extracted
      if (gen !== _previewGen) return
      if (progressive) {
        const idx = previewQueue.indexOf(rec)
        if (idx < 0) continue   // removed mid-extraction
        Object.assign(rec, { extractedText: text, scanWarning, parseWarning, pdfDoc, ocrFile, emptyPageNums, pages, structure, _extracting: false })
        renderPreviewTabs()
        if (idx === previewTabIdx) selectPreviewTab(previewTabIdx)
        updateFpHint()
      } else {
        previewQueue.push({ name: f.name, size: f.size, extractedText: text, scanWarning, parseWarning, pdfDoc, ocrFile, emptyPageNums, pages, structure })
      }
      if (parseWarning) toast(f.name + ': ' + parseWarning, 'info')
    } catch (err) {
      toast('Could not read ' + f.name + ': ' + err.message, 'err')
      if (progressive) {
        const idx = previewQueue.indexOf(rec)
        if (idx >= 0) {
          previewQueue.splice(idx, 1)
          if (previewTabIdx >= previewQueue.length) previewTabIdx = Math.max(0, previewQueue.length - 1)
          renderPreviewTabs()
          if (previewQueue.length) selectPreviewTab(previewTabIdx)
        }
      }
    }
  }
  // Attach: back to ok. Docs: hand off to the embed flow without flashing green
  // ("Extracting 5/5" -> ok -> "Embedding" read as "done, usable" - it is not).
  if (typeof setHealth === 'function') {
    if (progressive) setHealth('ok', (typeof connectedLabel === 'function') ? connectedLabel() : 'Ready')
    else setHealth('warn', 'Preparing to embed…')
  }
  if (progressive && !previewQueue.length) { cancelFilePreview(); return }
  if (!previewQueue.length) return

  // Embed flow: skip the text-preview panel entirely. Users uploading a file
  // for RAG want the whole file embedded as-is; showing a preview-and-edit
  // step is misleading. One confirmation dialog with file name + size is
  // enough.
  if (target === 'docs') {
    // If any files have scanned pages, offer to OCR them before embedding.
    const scannedItems = previewQueue.filter(f => f.scanWarning && (f.pdfDoc || f.ocrFile))
    if (scannedItems.length) {
      const choice = await promptOcr(scannedItems, 'embed')
      if (choice === 'cancel') { previewQueue = []; previewTarget = null; document.getElementById('file-in').value = ''; if (typeof renderDocPanel === 'function') renderDocPanel(); return }
      if (choice === 'ocr') await runOcrOnItems(scannedItems)
    }

    const items = previewQueue.slice()
    previewQueue  = []
    previewTarget = null
    await commitDocs(items)
    document.getElementById('file-in').value = ''
    return
  }

  // Attach-to-message flow: SAME OCR prompt as embed. If any shown files are
  // scanned, offer the identical 3-way choice right after extraction (not hidden
  // behind Confirm) so a scanned file never just looks empty in the preview.
  const scannedItems = previewQueue.filter(f => f.scanWarning && (f.pdfDoc || f.ocrFile))
  if (scannedItems.length) {
    const choice = await promptOcr(scannedItems, 'attach')
    if (choice === 'cancel') { cancelFilePreview(); return }
    if (choice === 'ocr') await runOcrOnItems(scannedItems)
  }
  // The panel is already open (progressive rows); refresh the final state.
  renderPreviewTabs()
  if (previewQueue[previewTabIdx]) selectPreviewTab(previewTabIdx)
  updateFpHint()
}

function showFilePreview() {
  const _ob = document.getElementById('fp-oversize'); if (_ob) _ob._crumbed = false
  document.getElementById('messages').style.display = 'none'
  document.getElementById('input-wrap').style.display = 'none'
  const panel = document.getElementById('file-preview')
  panel.classList.remove('hidden')
  renderPreviewTabs()
  selectPreviewTab(0)
  updateFpHint()
}

function renderPreviewTabs() {
  // One ROW per file (full name, char/token meta, per-file remove) - the old
  // horizontally-scrolling tabs hid every file after the first with long names.
  const tabsEl = document.getElementById('fp-tabs')
  const over = (typeof attachOversizeInfo === 'function') ? attachOversizeInfo(previewQueue).over : false
  tabsEl.innerHTML = previewQueue.map((f, i) => {
    const meta = f._extracting ? 'extracting…' : (over
      ? '~' + Math.round(estTokens(f.extractedText || '') / 1000) + 'k tok'
      : (f.extractedText || '').length.toLocaleString() + ' chars')
    return `
    <div class="fp-row ${i === previewTabIdx ? 'active' : ''}" onclick="selectPreviewTab(${i})">
      <span class="fp-row-name">${esc(f.name)}</span>
      <span class="fp-row-meta">${meta}</span>
      <span class="fp-row-x" title="Remove this file" onclick="removePreviewFile(${i}, event)">\u2715</span>
    </div>`
  }).join('')
  renderPreviewOversize()
}

// Remove ONE file from the preview queue (the row's remove button); empty queue = cancel.
function removePreviewFile(i, event) {
  if (event) event.stopPropagation()
  if (typeof lclCrumb === 'function') lclCrumb('attach_preview_remove', { file: (previewQueue[i] || {}).name })
  previewQueue.splice(i, 1)
  if (!previewQueue.length) { cancelFilePreview(); return }
  if (i < previewTabIdx) previewTabIdx--
  if (previewTabIdx >= previewQueue.length) previewTabIdx = previewQueue.length - 1
  selectPreviewTab(previewTabIdx)
  updateFpHint()
}

// Oversize note + footer buttons: when the extracted text cannot fit inline,
// offer "Embed for RAG instead" and relabel Confirm to "Attach anyway".
function renderPreviewOversize() {
  const box = document.getElementById('fp-oversize')
  const embedBtn = document.getElementById('fp-embed-btn')
  const confirmBtn = document.getElementById('fp-confirm-btn')
  if (!box) return
  const info = attachOversizeInfo(previewQueue)
  const k = n => Math.round(n / 1000) + 'k'
  if (info.over && previewQueue.length) {
    box.classList.remove('hidden')
    box.innerHTML = '<div class="fp-oversize-box"><strong style="color:var(--pin)">Too large to attach inline:</strong> ' +
      (previewQueue.length > 1 ? ('these ' + previewQueue.length + ' files are') : 'this file is') + ' ~' + k(info.newEst) +
      ' tokens' + (info.histEst > 2000 ? ' (+ ~' + k(info.histEst) + ' already in this chat\u2019s history \u2014 earlier attachments are re-sent every turn)' : '') + ' \u2014 over the ~' + k(info.ceil) + ' per-request limit. Embedding stores them once and retrieves only the relevant parts per question. Or remove files until it fits.</div>'
    if (embedBtn) embedBtn.classList.remove('hidden')
    if (confirmBtn) {
      confirmBtn.textContent = 'Attach anyway'
      confirmBtn.classList.toggle('hidden', info.est > info.ceil * 0.95)   // over the ABSOLUTE ceiling: can never send
    }
    if (typeof lclCrumb === 'function' && !box._crumbed) { box._crumbed = true; lclCrumb('attach_oversize_offered', { files: previewQueue.length, est: info.est, where: 'preview' }) }
  } else {
    box.classList.add('hidden')
    if (embedBtn) embedBtn.classList.add('hidden')
    if (confirmBtn) { confirmBtn.innerHTML = 'Confirm &amp; attach'; confirmBtn.classList.remove('hidden') }
  }
}

// "Embed for RAG instead": reroute the already-extracted preview files through
// the embed flow (no re-extraction) - RAG budgets them properly per question.
async function confirmFilePreviewAsEmbed() {
  if (previewQueue.some(function (r) { return r._extracting })) { toast('Still extracting text from some files — one moment…', 'info'); return }
  _previewGen++
  const ta = document.getElementById('fp-textarea')
  if (previewQueue[previewTabIdx]) previewQueue[previewTabIdx].extractedText = ta.value
  const files = previewQueue.slice()
  previewQueue = []
  previewTarget = null
  document.getElementById('file-preview').classList.add('hidden')
  document.getElementById('messages').style.display = ''
  document.getElementById('input-wrap').style.display = ''
  document.getElementById('file-in').value = ''
  if (typeof lclCrumb === 'function') lclCrumb('attach_oversize_converted', { files: files.length, where: 'preview' })
  commitDocs(files).catch(function (e) { try { console.warn('[commitDocs] ' + (e && e.message)) } catch (x) {} })
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
  const info = (typeof attachOversizeInfo === 'function') ? attachOversizeInfo(previewQueue) : { over: false }
  let text = total > 1
    ? `File ${previewTabIdx + 1} of ${total} — review each row before confirming`
    : 'Review and edit the text above if needed'
  if (info.over) text += ' · Total ~' + Math.round(info.est / 1000) + 'k tokens — limit ~' + Math.round(info.ceil / 1000) + 'k'
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
  _previewGen++
  previewQueue  = []
  previewTarget = null
  document.getElementById('file-preview').classList.add('hidden')
  document.getElementById('messages').style.display = ''
  document.getElementById('input-wrap').style.display = ''
  document.getElementById('file-in').value = ''
}

async function confirmFilePreview() {
  if (previewQueue.some(function (r) { return r._extracting })) { toast('Still extracting text from some files — one moment…', 'info'); return }
  _previewGen++
  // Sync final edits from active textarea
  const ta = document.getElementById('fp-textarea')
  if (previewQueue[previewTabIdx]) previewQueue[previewTabIdx].extractedText = ta.value

  const target = previewTarget
  // OCR is offered up-front when the scanned file is extracted into the preview
  // (same 3-way dialog as embed), so no prompt is needed here at confirm time.
  const files = previewQueue.slice()
  previewQueue  = []
  previewTarget = null
  // Restore the composer + message list IMMEDIATELY. Embedding can take minutes,
  // so it runs in the BACKGROUND (docs show as 'pending') instead of holding the UI
  // hostage — otherwise a new chat looks like it has no message box while it embeds.
  document.getElementById('file-preview').classList.add('hidden')
  document.getElementById('messages').style.display = ''
  document.getElementById('input-wrap').style.display = ''
  document.getElementById('file-in').value = ''
  if (target === 'attach') commitAttachments(files)
  else commitDocs(files).catch(function (e) { try { console.warn('[commitDocs] ' + (e && e.message)) } catch (x) {} })
}

// Attachment tray (v0.67e "working set"): confirmed files live on the CHAT, not
// in the composer or the message history. The tray above the composer shows the
// current set with a live token meter; every send injects the CURRENT set once.
function commitAttachments(files) {
  const chat = (typeof curChat === 'function') ? curChat() : null
  if (!chat) return
  if (!Array.isArray(chat.attachedFiles)) chat.attachedFiles = []
  for (const f of files) {
    const rec = { name: f.name, size: f.size || (f.extractedText || '').length, textContent: f.extractedText }
    const i = chat.attachedFiles.findIndex(function (x) { return x.name === f.name })
    if (i >= 0) chat.attachedFiles[i] = rec; else chat.attachedFiles.push(rec)
  }
  persist()
  renderAttachTray()
}

// Collapsed state is a global preference (localStorage) so it sticks across
// chats and reloads. Collapsed = one summary line; the token meter and the
// over-budget "Embed all" action stay visible so warnings can't be hidden.
function trayMin() { try { return localStorage.getItem('lcl_tray_min') === '1' } catch (e) { return false } }

function toggleTrayMin(event) {
  if (event && event.stopPropagation) event.stopPropagation()
  const min = !trayMin()
  try { localStorage.setItem('lcl_tray_min', min ? '1' : '0') } catch (e) {}
  if (typeof lclCrumb === 'function') lclCrumb('attach_tray_min', { min: min })
  renderAttachTray()
}

function renderAttachTray() {
  const el = document.getElementById('attach-tray')
  if (!el) return
  const chat = (typeof curChat === 'function') ? curChat() : null
  const files = (chat && chat.attachedFiles) || []
  if (!files.length) { el.className = 'hidden'; el.innerHTML = ''; return }
  const info = attachOversizeInfo(files, chat)
  const k = function (n) { return Math.round(n / 1000) + 'k' }
  const min = trayMin()
  el.className = ((info.over ? 'over' : '') + (min ? ' min' : '')).trim()
  const label = min
    ? files.length + ' file' + (files.length > 1 ? 's' : '') + ' attached' + (info.over ? ' \u2014 too large to send' : '')
    : (info.over ? 'Attached files \u2014 too large to send' : 'Attached files \u2014 sent with every message')
  const chips = min ? '' : files.map(function (a, i) {
    return '<span class="at-chip">' + esc(a.name) +
      ' <span class="at-tok">~' + k(estTokens(a.textContent || '')) + '</span>' +
      '<span class="at-x" title="Remove from the working set" onclick="removeTrayFile(' + i + ', event)">\u2715</span></span>'
  }).join('')
  el.innerHTML =
    '<div class="at-head">' +
      '<span class="at-lbl" title="' + (min ? 'Expand attached files' : 'Collapse attached files') + '" onclick="toggleTrayMin(event)">' + label + '</span>' +
      '<span style="flex:1"></span>' +
      (!min && files.length > 1 ? '<span class="at-clear" title="Remove all attached files" onclick="clearTrayFiles()">remove all</span>' : '') +
      '<span class="at-meter">~' + k(info.est) + ' / ' + k(info.budget) + ' tokens</span>' +
      (info.over ? '<button class="btn-s at-embed" onclick="embedTrayFiles()">Embed all for RAG</button>' : '') +
      '<span class="at-min" title="' + (min ? 'Expand attached files' : 'Collapse attached files') + '" onclick="toggleTrayMin(event)">' + (min ? '\u25b8' : '\u25be') + '</span>' +
    '</div>' +
    (min ? '' : '<div class="at-chips">' + chips +
      '<span class="at-add" onclick="document.getElementById(&quot;file-in&quot;).click()">+ add files</span>' +
    '</div>')
  if (info.over && typeof lclCrumb === 'function' && !el._overCrumbed) { el._overCrumbed = true; lclCrumb('attach_oversize_offered', { files: files.length, est: info.est, where: 'tray' }) }
  if (!info.over) el._overCrumbed = false
}

function removeTrayFile(i, event) {
  if (event && event.stopPropagation) event.stopPropagation()
  const chat = (typeof curChat === 'function') ? curChat() : null
  if (!chat || !Array.isArray(chat.attachedFiles)) return
  const f = chat.attachedFiles[i]
  if (typeof lclCrumb === 'function') lclCrumb('attach_tray_remove', { file: f && f.name })
  chat.attachedFiles.splice(i, 1)
  persist()
  renderAttachTray()
}

async function clearTrayFiles() {
  const chat = (typeof curChat === 'function') ? curChat() : null
  if (!chat || !Array.isArray(chat.attachedFiles) || !chat.attachedFiles.length) return
  const n = chat.attachedFiles.length
  if (typeof confirmDialog === 'function') {
    const ok = await confirmDialog({ title: 'Remove all attached files?', message: 'Remove all ' + n + ' file' + (n > 1 ? 's' : '') + ' from this chat’s working set? Their text will no longer be sent with your messages.', okText: 'Remove all', cancelText: 'Cancel' })
    if (!ok) return
  }
  if (typeof lclCrumb === 'function') lclCrumb('attach_tray_clear', { files: n })
  chat.attachedFiles = []
  persist()
  renderAttachTray()
}

// Remove every embedded file from THIS chat (confirm first), then GC orphaned
// vectors. Docs referenced by other chats keep their entries + vectors there.
async function removeAllDocs() {
  const chat = (typeof curChat === 'function') ? curChat() : null
  const docs = (chat && chat.docs) || []
  if (!docs.length) return
  const n = docs.length
  if (typeof confirmDialog === 'function') {
    const ok = await confirmDialog({ title: 'Remove all embedded files?', message: 'Remove all ' + n + ' file' + (n > 1 ? 's' : '') + ' from this chat and prune their embeddings from the local cache? Files shared with other chats are kept there.', okText: 'Remove all', cancelText: 'Cancel' })
    if (!ok) return
  }
  if (typeof lclCrumb === 'function') lclCrumb('docs_remove_all', { files: n })
  for (const d of docs) d._cancelled = true   // stop any in-flight embedding
  chat.docs = []
  ragKeywordIndexCache = { signature: '', index: null, records: [] }
  renderDocPanel(); updateDocsBtn()
  toast('Removed ' + n + ' file' + (n > 1 ? 's' : '') + ' from RAG memory', 'ok')
  ;(async () => {
    try { await persist() } catch (e) { console.warn('[removeAllDocs] persist', e.message) }
    try { await gcEmbedCache() } catch (e) { console.warn('[removeAllDocs] gc', e.message) }
  })()
}

function embedTrayFiles() {
  const chat = (typeof curChat === 'function') ? curChat() : null
  if (!chat || !Array.isArray(chat.attachedFiles) || !chat.attachedFiles.length) return
  const files = chat.attachedFiles.map(function (a) { return { name: a.name, size: a.size || (a.textContent || '').length, extractedText: a.textContent } })
  chat.attachedFiles = []
  persist()
  renderAttachTray()
  if (typeof lclCrumb === 'function') lclCrumb('attach_oversize_converted', { files: files.length, where: 'tray' })
  commitDocs(files).catch(function (e) { try { console.warn('[commitDocs] ' + (e && e.message)) } catch (x) {} })
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
    let embOk = 0, embChunks = 0
    for (const p of plans) {
      if (!sel.has(p.doc.id)) continue
      await embedDoc(p.doc, { plan: p.plan, skipGate: true, quiet: true })
      if (p.doc.status === 'ready') { embOk++; embChunks += (p.doc.chunks ? p.doc.chunks.length : 0) }
    }
    if (embOk) toast('Embedded ' + embOk + ' file' + (embOk > 1 ? 's' : '') + ', ' + embChunks + ' chunk' + (embChunks === 1 ? '' : 's'), 'ok')
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
      toast(doc.name + ' embedded - no text found', 'ok')
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
      if (typeof lclCrumb === 'function') lclCrumb('embed_start', { doc: doc.name, chunks: toEmbed.length })
      const { hashes, embeddings, storeVectors } = await embedBatch(toEmbed, prog => {
        doc.embedProgress = prog; renderDocPanel()
      }, function () { return doc._cancelled })
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
    if (!(opts && opts.quiet)) toast(doc.name + ' embedded (' + doc.chunks.length + ' chunks)', 'ok')
    if (typeof lclCrumb === 'function') lclCrumb('embed_done', { doc: doc.name, chunks: doc.chunks.length })
    renderDocPanel()
    if (typeof refreshBudget === 'function') refreshBudget()
  } catch (e) {
    if (e && e.cancelled) {   // removed mid-embed — stop quietly, no error card
      doc.embedProgress = null
      if (typeof lclCrumb === 'function') lclCrumb('embed_cancelled', { doc: doc.name })
      setHealth('ok', connectedLabel())
      return
    }
    doc.status = 'error'
    doc.error  = e.message
    doc.embedProgress = null
    if (typeof lclCrumb === 'function') lclCrumb('embed_fail', { doc: doc.name, err: String(e && e.message || '').slice(0, 60) })
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
  found.doc._cancelled = false
  if (typeof lclCrumb === 'function') lclCrumb('retry_embed', { doc: found.doc.name })
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
  doc._cancelled = true   // stop any in-flight embedding for this doc (checked between batches)
  if (typeof lclCrumb === 'function') lclCrumb('remove_doc', { doc: doc.name, wasEmbedding: doc.status === 'embedding' || doc.status === 'pending' })
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
