async function queueFilesForPreview(files, target) {
  const valid = []
  for (const f of Array.from(files)) {
    if (!isSupported(f)) {
      toast('Unsupported file: ' + f.name + '. Supported: PDF, Word, Excel, text/code files.', 'err')
      continue
    }
    valid.push(f)
  }
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