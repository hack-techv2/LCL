// =============================================================================
// Helpers
// =============================================================================
// Render markdown via marked + DOMPurify. LCL requires network access to
// reach PlatformAI anyway, so the CDN dependency is acceptable — no offline
// fallback. The raw markdown is preserved on the message bubble via data-raw
// so the Copy button returns the original text, not the rendered version.
function fmt(text) {
  if (!text) return ''
  marked.setOptions({ gfm: true, breaks: true })
  return DOMPurify.sanitize(marked.parse(text), {
    ALLOWED_TAGS: ['p','br','hr','strong','em','del','u','code','pre',
                   'h1','h2','h3','h4','h5','h6',
                   'ul','ol','li','blockquote',
                   'a','table','thead','tbody','tr','th','td','span','div'],
    ALLOWED_ATTR: ['href','title','target','rel','class','start']
  })
}

function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }
function escJs(s){ return esc(String(s == null ? '' : s).replace(/\\/g,'\\\\').replace(/'/g,"\\'")) }

function fmtSz(b) {
  if (!b) return '0 B'
  if (b<1024) return b+' B'
  if (b<1048576) return (b/1024).toFixed(1)+' KB'
  return (b/1048576).toFixed(1)+' MB'
}

function fmtDate(ts) {
  if (!ts) return ''
  const d=new Date(ts), now=new Date()
  if (d.toDateString()===now.toDateString()) return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})
  return d.toLocaleDateString([],{month:'short',day:'numeric'})
}

function toggleFileChip(chip, filename) {
  const chipsRow  = chip.closest('.msg-file-chips')
  const expandDiv = chipsRow.nextElementSibling  // .msg-file-expand
  if (!expandDiv) return

  const isOpen = chip.classList.contains('expanded')

  // Close any other open chips in this message first
  chipsRow.querySelectorAll('.msg-chip.expanded').forEach(c => c.classList.remove('expanded'))

  if (isOpen) {
    // Toggle off
    expandDiv.classList.add('hidden')
    expandDiv.innerHTML = ''
    return
  }

  // Parse stored content map
  let contentMap = {}
  try { contentMap = JSON.parse(expandDiv.dataset.fileContents || '{}') } catch {}
  const content = contentMap[filename] || '(no content found)'

  chip.classList.add('expanded')
  expandDiv.classList.remove('hidden')
  expandDiv.innerHTML = `<textarea readonly>${esc(content)}</textarea>`
  // Auto-size up to max-height
  const ta = expandDiv.querySelector('textarea')
  ta.style.height = 'auto'
  ta.style.height = Math.min(ta.scrollHeight, window.innerHeight * 0.4) + 'px'
}

function copyMsg(btn) {
  // Prefer the raw markdown stored on the bubble (data-raw). Falls back to
  // the rendered innerText if the attribute is missing (older messages).
  const group = btn.closest('.msg-group')
  const raw = group?.dataset?.raw
  const t = raw != null && raw !== ''
    ? raw
    : group.querySelector('.msg-body').innerText
  navigator.clipboard.writeText(t).then(() => {
    btn.textContent = 'Copied!'
    setTimeout(() => btn.textContent = 'Copy', 1500)
  })
}

// Resolve CSS custom properties (var(--x)) to their computed values so the
// copied HTML renders correctly in Word / Outlook which don't understand vars.
function resolveCssVars(html) {
  const cs = getComputedStyle(document.documentElement)
  return html.replace(/var\(--([^),\s]+)[^)]*\)/g, (_, name) => {
    return cs.getPropertyValue('--' + name).trim() || ''
  })
}

// Inline solid borders onto tables and cells. Word/Outlook honour inline
// styles + the legacy border attribute, but not <style> rules, so this is
// what actually makes table grid lines visible after paste.
function forceTableBorders(html) {
  return html
    .replace(/<table\b([^>]*)>/gi, (m, a) => {
      if (!/\bborder=/i.test(a)) a += ' border="1"'
      if (/style="/i.test(a)) a = a.replace(/style="([^"]*)"/i, (mm, s) =>
        'style="' + s.replace(/border[^;]*;?/gi, '') + ';border-collapse:collapse;border:1px solid #333"')
      else a += ' style="border-collapse:collapse;border:1px solid #333"'
      return '<table' + a + '>'
    })
    .replace(/<(t[dh])\b([^>]*)>/gi, (m, tag, a) => {
      if (/style="/i.test(a)) a = a.replace(/style="([^"]*)"/i, (mm, s) =>
        'style="' + s.replace(/border[^;]*;?/gi, '') + ';border:1px solid #333;padding:4px 8px"')
      else a += ' style="border:1px solid #333;padding:4px 8px"'
      return '<' + tag + a + '>'
    })
}

function copyMsgHtml(btn) {
  // Write text/html + text/plain so Word and Outlook render the formatted
  // version (headings, bold, tables, etc.) while plain-text targets still work.
  const group = btn.closest('.msg-group')
  const body  = group?.querySelector('.msg-body')
  if (!body) return

  // Wrap in Aptos (Outlook default). Word/Outlook ignore <style> blocks for
  // table borders, and LCL's cell borders come from the stylesheet (no inline
  // style), so we must inline a solid border onto every table/td/th. Without
  // this the lines render white/invisible in Word.
  const inner = forceTableBorders(resolveCssVars(body.innerHTML))
  const html  = '<style>table{border-collapse:collapse}td,th{border:1px solid #333}</style>' +
                '<div style="font-family:Aptos,Calibri,Arial,sans-serif">' + inner + '</div>'
  const plain = body.innerText

  const htmlBlob  = new Blob([html],  { type: 'text/html' })
  const plainBlob = new Blob([plain], { type: 'text/plain' })

  navigator.clipboard.write([new ClipboardItem({
    'text/html':  htmlBlob,
    'text/plain': plainBlob
  })]).then(() => {
    btn.textContent = 'Copied!'
    setTimeout(() => btn.textContent = 'Copy for Word / Outlook', 1500)
  }).catch(() => {
    // ClipboardItem not supported (Firefox) — fall back to plain text
    navigator.clipboard.writeText(plain).then(() => {
      btn.textContent = 'Copied!'
      setTimeout(() => btn.textContent = 'Copy for Word / Outlook', 1500)
    })
  })
}

function useHint(text) {
  const el = document.getElementById('msg-in')
  if (!el) return
  el.value = text
  autoResize(el)
  el.focus()
  try { el.setSelectionRange(el.value.length, el.value.length) } catch {}
}

function handleKey(e) {
  if (e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); send() }
  else if (e.key==='Escape' && busy) { e.preventDefault(); stopStreaming() }
}

// Global Esc-to-stop (works even when focus isn't in the textarea). Skip if the
// search modal is open - it has its own Esc handler.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !busy) return
  const searchOpen = !document.getElementById('search-bd').classList.contains('hidden')
  if (searchOpen) return
  stopStreaming()
})

function autoResize(el) { el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,180)+'px' }

function exportChat() {
  const chat=curChat(); if (!chat||!chat.messages.length) return
  const text=chat.messages.map(m=>{ const c=typeof m.content==='string'?m.content:m.content?.find?.(b=>b.type==='text')?.text||''; return '['+m.role.toUpperCase()+']\n'+c }).join('\n\n---\n\n')
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([text],{type:'text/plain'})); a.download=chat.title.replace(/[^a-z0-9]/gi,'_')+'_'+Date.now()+'.txt'; a.click()
}

let toastT=null
