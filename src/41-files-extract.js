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
  // Plain text / code files - default for any unlisted extension.
  _default: (file) => new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload  = e => resolve({ text: e.target.result || '', scanWarning: null })
    r.onerror = () => reject(new Error('Read error'))
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
