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
// Minimal DOM builder for renderers (avoids string-template innerHTML + inline
// onclick). mkEl('div',{class:'x',onclick:fn,title:'t'},[child|string|node]).
// Strings -> text nodes (auto-escaped by the DOM). Named mkEl, not el, because
// renderers use `el` as the container local. Use {html:'...'} for trusted markup.
function mkEl(tag, attrs, children) {
  const n = document.createElement(tag)
  if (attrs) for (const k in attrs) {
    const v = attrs[k]
    if (v == null || v === false) continue
    if (k === 'class') n.className = v
    else if (k === 'html') n.innerHTML = v
    else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v)
    else n.setAttribute(k, v)
  }
  const add = (c) => {
    if (c == null || c === false) return
    if (Array.isArray(c)) { c.forEach(add); return }
    n.append(c.nodeType ? c : document.createTextNode(String(c)))
  }
  add(children)
  return n
}

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

// Parse a trusted SVG/HTML string into a single DOM node, so icon markup can be
// inserted as a real child element (e.g. a direct <svg> child) rather than via a
// wrapper's innerHTML. Only ever called with static, in-source markup.
function svgNode(s) {
  const d = document.createElement('div')
  d.innerHTML = s
  return d.firstElementChild
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

// Native Ctrl+C / right-click Copy sanitiser, scoped to the chat transcript.
// Chrome serialises a selection by inlining computed styles onto the copied HTML
// (the dark-theme text colour, element backgrounds, and the orange ::selection
// wash). Rich editors like Teams / Outlook / Word keep those inline background /
// colour styles, so pasted text arrives with a red-ish highlight behind it. We
// intercept the copy event, rebuild the clipboard from the selection's OWN DOM
// (semantic tags + class names, no inlined computed styles), strip any inline
// background/colour, and write clean text/html + text/plain ourselves. Bold,
// italics, links, lists and tables survive; the colour bleed does not. Only the
// #messages transcript is touched — copying from inputs/settings is left alone,
// and the Copy buttons (navigator.clipboard.write) never dispatch this event.
function wireCopySanitizer() {
  document.addEventListener('copy', e => {
    try {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
      const msgs = document.getElementById('messages')
      if (!msgs) return
      const inMsgs = (node) => {
        const el = node && (node.nodeType === 1 ? node : node.parentElement)
        return !!(el && msgs.contains(el))
      }
      if (!inMsgs(sel.anchorNode) && !inMsgs(sel.focusNode)) return   // not the transcript -> leave native copy alone
      const wrap = document.createElement('div')
      for (let i = 0; i < sel.rangeCount; i++) wrap.appendChild(sel.getRangeAt(i).cloneContents())
      wrap.querySelectorAll('*').forEach(el => {
        if (!el.style) return
        el.style.removeProperty('background')
        el.style.removeProperty('background-color')
        el.style.removeProperty('color')
        if (el.getAttribute('style') === '') el.removeAttribute('style')
      })
      if (!e.clipboardData) return
      e.clipboardData.setData('text/html', wrap.innerHTML)
      e.clipboardData.setData('text/plain', sel.toString())
      e.preventDefault()
    } catch (err) { /* fall back to native copy */ }
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

// ---------------------------------------------------------------------------
// merged from 81-ui-settings.js
// ---------------------------------------------------------------------------

function toast(msg,type) {
  const el=document.getElementById('toast'); el.textContent=msg; el.className='show '+(type||'')
  clearTimeout(toastT); toastT=setTimeout(()=>el.className='',2800)
}

// Update a range slider's --fill custom property so the gradient track
// renders the orange "filled" portion correctly at its current value.
// Without this, the thumb floats over a flat grey track.
function refreshSliderFill(el) {
  if (!el) return
  const min = parseFloat(el.min) || 0
  const max = parseFloat(el.max) || 100
  const val = parseFloat(el.value) || 0
  const pct = max === min ? 0 : ((val - min) / (max - min)) * 100
  // Offset by the thumb radius so the filled portion lines up with the thumb
  // centre at both ends (native range thumbs are inset by half their width, so a
  // plain pct% gradient overshoots at max and shows under the thumb at min).
  const T = 16 // thumb width incl. border
  const off = (T / 2 - (pct / 100) * T).toFixed(2)
  el.style.setProperty('--fill', 'calc(' + pct + '% + ' + off + 'px)')
}

// Max-tokens preset chips + custom field. The custom number input (#s-tok-v-input)
// is the single source of truth that saveSP() reads; chips just write into it.
function setTok(v){
  const inp = document.getElementById('s-tok-v-input')
  if (inp) inp.value = v
  refreshSliderFill(document.getElementById('s-tok'))
}
function refreshTokChips(){
  const inp = document.getElementById('s-tok-v-input')
  const v = parseInt(inp && inp.value) || 0
  document.querySelectorAll('#tok-presets .tok-chip').forEach(b => b.classList.toggle('on', parseInt(b.dataset.tok) === v))
}

// Two-way sync for the RAG sliders + their editable value fields.
function onRangeIn(numId, range){
  const n = document.getElementById(numId)
  if (n) n.value = range.value
  refreshSliderFill(range)
}
function onNumIn(rangeId, num){
  const r = document.getElementById(rangeId)
  if (!r) return
  let v = parseInt(num.value)
  if (!isNaN(v)) r.value = Math.max(+r.min, Math.min(+r.max, v))
  refreshSliderFill(r)
}

// Settings
function openSP() {
  if (!creds) return
  document.getElementById('s-key').value   = creds.apiKey||''
  document.getElementById('s-mdl').value   = creds.model||''
  document.getElementById('s-sys').value   = creds.systemPrompt||''
  document.getElementById('s-tok-v-input').value = Math.min(CFG.MAX_TOKENS_CAP, creds.maxTokens||8192)
  document.getElementById('s-tok').value = Math.min(CFG.MAX_TOKENS_SLIDER, creds.maxTokens||8192)
  document.getElementById('s-chunk').value = creds.chunkSize||800
  document.getElementById('s-topk').value  = creds.topK||5
  document.getElementById('s-embk').value  = creds.embedApiKey||''
  document.getElementById('s-embm').value  = creds.embedModelId||''
  document.getElementById('s-embwarn').value = (typeof creds.embedWarnTokens === 'number') ? creds.embedWarnTokens : ''
  document.getElementById('s-embmax').value  = (typeof creds.embedMaxTokens  === 'number') ? creds.embedMaxTokens  : ''
  if (typeof demoKeyHint === 'function') { demoKeyHint('s-key'); demoKeyHint('s-embk') }
  document.getElementById('s-chunk-v').value = creds.chunkSize||800
  document.getElementById('s-topk-v').value  = creds.topK||5
  // Paint the slider fills to match initial values
  refreshSliderFill(document.getElementById('s-tok'))
  refreshSliderFill(document.getElementById('s-chunk'))
  refreshSliderFill(document.getElementById('s-topk'))
  if (typeof initClassification === 'function') initClassification('sp', creds.classification || inferTier(creds.model) || 'cce')
  document.getElementById('sp').classList.remove('hidden')
  let _spTab = 'models'; try { _spTab = localStorage.getItem('lcl_sp_tab') || 'models' } catch {}
  if (typeof spTab === 'function') spTab(['models','settings'].includes(_spTab) ? _spTab : 'models')
  if (typeof renderUpdateSettings === 'function') renderUpdateSettings()
}

// Switch the Settings panel tab (Model / Embed / Settings); remembers last choice.
function spTab(name){
  document.querySelectorAll('#sp .sp-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === name))
  document.querySelectorAll('#sp .sp-pane').forEach(p => p.classList.toggle('on', p.dataset.pane === name))
  try { localStorage.setItem('lcl_sp_tab', name) } catch {}
}

// Skills manager (independent of Settings; accessible without connection)
async function openSkillsManager() {
  // Refresh from disk every time so the list is current — also makes this work
  // before a connect() has populated skillsCache.
  await loadSkillsList()
  renderSpSkillsList()
  renderSkillPicker()
  document.getElementById('skills-mgr').classList.remove('hidden')
}

function closeSkillsManager() {
  cancelNewSkill()
  document.getElementById('skills-mgr').classList.add('hidden')
}
function closeSP() { document.getElementById('sp').classList.add('hidden') }

function renderSpSkillsList() {
  const root = document.getElementById('sp-skills-list')
  if (!root) return
  if (!skillsCache.length) {
    root.innerHTML = '<div style="font-size:11px;color:var(--tx3);padding:6px">No skills yet. Upload a .md file or drop one into LCL/skills.</div>'
    return
  }
  root.innerHTML = skillsCache.map(s => `
    <div style="display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:4px;background:var(--bg3)">
      <div style="flex:1;min-width:0;font-size:12px">
        <div style="font-weight:500;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.title)}</div>
        <div style="font-family:var(--mono);font-size:10px;color:var(--tx3)">${esc(s.id)}.md &middot; ${s.bytes} B</div>
      </div>
      <button class="tb-btn" onclick="editSkill('${esc(s.id)}')">Edit</button>
      <button class="tb-btn" onclick="renameSkill('${esc(s.id)}')">Rename</button>
      <button class="tb-btn" onclick="deleteSkillUI('${esc(s.id)}')" style="color:var(--red)">Delete</button>
    </div>
  `).join('')
}

async function reloadSkillsFromUI() {
  try {
    const r = await httpPost('/skills/reload')
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const data = await r.json()
    skillsCache = Array.isArray(data.skills) ? data.skills : []
    renderSpSkillsList()
    renderSkillPicker()
    toast('Skills reloaded', 'ok')
  } catch (e) {
    toast('Reload failed: ' + e.message, 'err')
  }
}

async function uploadSkillFile(fileList) {
  if (!fileList || !fileList.length) return
  const file = fileList[0]
  if (!file.name.toLowerCase().endsWith('.md')) {
    toast('Only .md files are supported', 'err')
    return
  }
  if (file.size > 256 * 1024) {
    toast('File exceeds 256 KB cap', 'err')
    return
  }
  const baseName = file.name.replace(/\.md$/i, '')
  const slug = baseName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)
  if (!slug) {
    toast('Could not derive a valid name from filename', 'err')
    return
  }
  if (skillsCache.some(s => s.id === slug)) {
    if (!confirm('Skill "' + slug + '" already exists. Overwrite?')) return
  }
  const body = await file.text()
  try {
    const r = await httpPut('/skills/' + encodeURIComponent(slug), { body })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      throw new Error(err.error || ('HTTP ' + r.status))
    }
    await loadSkillsList()
    renderSpSkillsList()
    renderSkillPicker()
    toast('Uploaded as "' + slug + '"', 'ok')
  } catch (e) {
    toast('Upload failed: ' + e.message, 'err')
  }
  document.getElementById('sp-skill-upload').value = ''
}

let _editingSkillId = null

function newSkill() {
  const list = document.getElementById('sp-skills-list')
  if (!list) return
  // Already showing? focus it.
  const existing = document.getElementById('sp-skill-new-input')
  if (existing) { existing.focus(); return }

  const row = document.createElement('div')
  row.id = 'sp-skill-new-row'
  row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px;border-radius:4px;background:var(--acbg);border:1px solid rgba(232,97,10,.3)'
  row.innerHTML = `
    <input id="sp-skill-new-input" type="text" placeholder="skill-name"
      autocomplete="off" spellcheck="false"
      style="flex:1;background:none;border:none;outline:none;color:var(--ac);font-family:var(--mono);font-size:12px;padding:4px"
      onkeydown="handleNewSkillKey(event)" oninput="this.style.color='var(--ac)'">
    <button class="tb-btn" onclick="confirmNewSkill()" style="font-size:11px">OK</button>
    <button class="tb-btn" onclick="cancelNewSkill()" style="font-size:11px">Cancel</button>
  `
  list.insertBefore(row, list.firstChild)
  setTimeout(() => document.getElementById('sp-skill-new-input')?.focus(), 30)
}

function cancelNewSkill() {
  document.getElementById('sp-skill-new-row')?.remove()
}

function confirmNewSkill() {
  handleNewSkillKey({ key: 'Enter', preventDefault: () => {} })
}


// Esc closes the topmost open overlay (settings / skills / update dialog) so the
// user doesn't have to scroll to the footer buttons. Tag: lcl-esc-overlays
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return
  const open = id => { const el = document.getElementById(id); return el && !el.classList.contains('hidden') ? el : null }
  if (open('skill-edit-bd')) { closeSkillEdit(); return }
  if (document.getElementById('update-bd')) { closeUpdateDialog(); return }
  if (open('skills-mgr')) { closeSkillsManager(); return }
  if (open('sp')) { closeSP(); return }
})

// ---------------------------------------------------------------------------
// merged from 82-ui-skills.js
// ---------------------------------------------------------------------------

function handleNewSkillKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); cancelNewSkill(); return }
  if (e.key !== 'Enter') return
  e.preventDefault()
  const inp = document.getElementById('sp-skill-new-input')
  if (!inp) return
  const slug = inp.value.trim().toLowerCase()
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) {
    inp.style.color = 'var(--red)'
    toast('Invalid name — use lowercase letters, digits, dashes (max 64)', 'err')
    return
  }
  if (skillsCache.some(s => s.id === slug)) {
    inp.style.color = 'var(--red)'
    toast('Skill "' + slug + '" already exists', 'err')
    return
  }
  cancelNewSkill()
  // Title-case the slug for the H1 stub.
  const title = slug.split('-').map(w => w ? w[0].toUpperCase() + w.slice(1) : '').join(' ')
  _editingSkillId = slug
  document.getElementById('skill-edit-id').textContent = slug
  document.getElementById('skill-edit-body').value = '# ' + title + '\n\n'
  document.getElementById('skill-edit-bd').classList.remove('hidden')
  setTimeout(() => {
    const ta = document.getElementById('skill-edit-body')
    if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length }
  }, 30)
}

async function editSkill(id) {
  if (typeof demoOn === 'function' && demoOn()) {
    const sk = skillsCache.find(s => s.id === id) || {}
    _editingSkillId = id
    document.getElementById('skill-edit-id').textContent = id
    document.getElementById('skill-edit-body').value = sk.body || ''
    document.getElementById('skill-edit-bd').classList.remove('hidden')
    return
  }
  try {
    const r = await httpGet('/skills/' + encodeURIComponent(id))
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const data = await r.json()
    _editingSkillId = id
    document.getElementById('skill-edit-id').textContent = id
    document.getElementById('skill-edit-body').value = data.body || ''
    document.getElementById('skill-edit-bd').classList.remove('hidden')
  } catch (e) {
    toast('Failed to load skill: ' + e.message, 'err')
  }
}

function closeSkillEdit() {
  document.getElementById('skill-edit-bd').classList.add('hidden')
  _editingSkillId = null
}

async function saveSkillEdit() {
  if (!_editingSkillId) return
  const body = document.getElementById('skill-edit-body').value
  if (typeof demoOn === 'function' && demoOn()) {
    const ex = skillsCache.find(s => s.id === _editingSkillId)
    if (ex) { ex.body = body; ex.bytes = body.length; ex.title = demoSkillTitle(body, _editingSkillId); ex.mtime = Date.now() }
    else { skillsCache.push({ id: _editingSkillId, title: demoSkillTitle(body, _editingSkillId), bytes: body.length, mtime: Date.now(), body }) }
    renderSpSkillsList(); renderSkillPicker(); closeSkillEdit(); toast('Saved', 'ok')
    return
  }
  try {
    const r = await httpPut('/skills/' + encodeURIComponent(_editingSkillId), { body })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      throw new Error(err.error || ('HTTP ' + r.status))
    }
    await loadSkillsList()
    renderSpSkillsList()
    renderSkillPicker()
    closeSkillEdit()
    toast('Saved', 'ok')
  } catch (e) {
    toast('Save failed: ' + e.message, 'err')
  }
}

async function renameSkill(oldId) {
  const newId = prompt('Rename "' + oldId + '" to (lowercase letters, digits, dashes, max 64):', oldId)
  if (newId == null) return
  const slug = newId.trim()
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) { toast('Invalid name', 'err'); return }
  if (slug === oldId) return
  if (skillsCache.some(s => s.id === slug)) {
    toast('A skill named "' + slug + '" already exists', 'err')
    return
  }
  if (typeof demoOn === 'function' && demoOn()) {
    const sk = skillsCache.find(s => s.id === oldId); if (sk) sk.id = slug
    let touched = 0
    for (const cid of Object.keys(D.chats)) { if (D.chats[cid].skillId === oldId) { D.chats[cid].skillId = slug; touched++ } }
    renderSpSkillsList(); renderSkillPicker(); renderSkillChip()
    toast('Renamed (' + touched + ' chat' + (touched === 1 ? '' : 's') + ' updated)', 'ok')
    return
  }
  try {
    let r = await httpGet('/skills/' + encodeURIComponent(oldId))
    if (!r.ok) throw new Error('Read old: HTTP ' + r.status)
    const data = await r.json()
    r = await httpPut('/skills/' + encodeURIComponent(slug), { body: data.body })
    if (!r.ok) throw new Error('Write new: HTTP ' + r.status)
    r = await httpDelete('/skills/' + encodeURIComponent(oldId))
    if (!r.ok) throw new Error('Delete old: HTTP ' + r.status)
    let touched = 0
    for (const cid of Object.keys(D.chats)) {
      if (D.chats[cid].skillId === oldId) { D.chats[cid].skillId = slug; touched++ }
    }
    if (touched) await persist()
    await loadSkillsList()
    renderSpSkillsList()
    renderSkillPicker()
    renderSkillChip()
    toast('Renamed (' + touched + ' chat' + (touched === 1 ? '' : 's') + ' updated)', 'ok')
  } catch (e) {
    toast('Rename failed: ' + e.message, 'err')
  }
}

async function deleteSkillUI(id) {
  const referencing = Object.values(D.chats).filter(c => c.skillId === id)
  const msg = referencing.length
    ? 'Delete skill "' + id + '"?\n\n' + referencing.length + ' chat(s) currently use it and will be reset to "None".'
    : 'Delete skill "' + id + '"?'
  if (!confirm(msg)) return
  if (typeof demoOn === 'function' && demoOn()) {
    const i = skillsCache.findIndex(s => s.id === id); if (i > -1) skillsCache.splice(i, 1)
    let touched = 0
    for (const cid of Object.keys(D.chats)) { if (D.chats[cid].skillId === id) { D.chats[cid].skillId = null; touched++ } }
    renderSpSkillsList(); renderSkillPicker(); renderSkillChip()
    toast('Deleted ' + id, 'ok')
    return
  }
  try {
    const r = await httpDelete('/skills/' + encodeURIComponent(id))
    if (!r.ok && r.status !== 404) {
      const err = await r.json().catch(() => ({}))
      throw new Error(err.error || ('HTTP ' + r.status))
    }
    let touched = 0
    for (const cid of Object.keys(D.chats)) {
      if (D.chats[cid].skillId === id) { D.chats[cid].skillId = null; touched++ }
    }
    if (touched) await persist()
    await loadSkillsList()
    renderSpSkillsList()
    renderSkillPicker()
    renderSkillChip()
    toast('Deleted "' + id + '"' + (touched ? ' (' + touched + ' chat' + (touched === 1 ? '' : 's') + ' reset)' : ''), 'ok')
  } catch (e) {
    toast('Delete failed: ' + e.message, 'err')
  }
}
// Promise-based themed confirm dialog. Resolves true on confirm, false on cancel/Esc.
function confirmDialog(opts) {
  opts = opts || {}
  return new Promise(resolve => {
    let done = false
    const onKey = e => { if (e.key === 'Escape') finish(false); else if (e.key === 'Enter') finish(true) }
    function finish(v) { if (done) return; done = true; document.removeEventListener('keydown', onKey); try { ov.remove() } catch {} ; resolve(v) }
    const ok = mkEl('button', { class: 'btn-p cd-ok', onclick: () => finish(true) }, opts.okText || 'Confirm')
    const cancel = mkEl('button', { class: 'cd-cancel', onclick: () => finish(false) }, opts.cancelText || 'Cancel')
    const box = mkEl('div', { class: 'cd-box', role: 'dialog' }, [
      mkEl('div', { class: 'cd-title' }, opts.title || 'Confirm'),
      mkEl('div', { class: 'cd-msg' }, opts.message || ''),
      mkEl('div', { class: 'cd-acts' }, [cancel, ok])
    ])
    const ov = mkEl('div', { class: 'cd-overlay', onclick: e => { if (e.target === ov) finish(false) } }, [box])
    document.body.appendChild(ov)
    document.addEventListener('keydown', onKey)
    setTimeout(() => { try { ok.focus() } catch {} }, 0)
  })
}

function saveSP() {
  const prevEmbedKey = creds.embedApiKey || ''
  creds.apiKey       = document.getElementById('s-key').value.trim()||creds.apiKey
  creds.model        = document.getElementById('s-mdl').value.trim()||creds.model
  creds.systemPrompt = document.getElementById('s-sys').value.trim()
  const tokInput = parseInt(document.getElementById('s-tok-v-input').value)
  creds.maxTokens    = isNaN(tokInput) ? 8192 : Math.max(64, Math.min(CFG.MAX_TOKENS_CAP, tokInput))
  creds.chunkSize    = parseInt(document.getElementById('s-chunk').value)
  creds.topK         = parseInt(document.getElementById('s-topk').value)
  creds.embedApiKey  = document.getElementById('s-embk').value.trim() || creds.embedApiKey
  creds.embedModelId = document.getElementById('s-embm').value.trim() || creds.embedModelId
  const _wv = (document.getElementById('s-embwarn').value || '').trim()
  const _mv = (document.getElementById('s-embmax').value || '').trim()
  creds.embedWarnTokens = (!_wv || /^auto$/i.test(_wv)) ? 'auto' : Math.max(0, parseInt(_wv) || 0)
  creds.embedMaxTokens  = (!_mv || /^auto$/i.test(_mv)) ? 'auto' : Math.max(0, parseInt(_mv) || 0)
  creds.classification = ((typeof _clsState!=='undefined' && _clsState.sp) || creds.classification || inferTier(creds.model) || 'cce')
  // Mirror into D.settings so persist() also carries these to disk
  D.settings = credsToSettings(creds)
  saveSettings(D.settings)
  persist()
  closeSP(); toast('Settings saved','ok')
  // Validate a new/changed embedding key NOW (one tiny embed call) so a wrong or
  // truncated key is caught with a clear message instead of silently 401'ing on
  // the first RAG embed. Non-blocking: settings are already saved.
  if (creds.embedApiKey && creds.embedModelId && creds.embedApiKey !== prevEmbedKey) checkEmbedKey()
}

// One-shot embedding-key check used after a Settings save. Skips #demo (DEMOKEY).
async function checkEmbedKey() {
  if (typeof demoOn === 'function' && demoOn()) return
  if (!creds || !creds.embedApiKey || !creds.embedModelId) return
  try {
    const r = await httpPost('/api/embed', { apiKey: creds.embedApiKey, modelId: creds.embedModelId, input: 'lcl key check' })
    if (r.ok) { toast('Embedding key connected', 'ok'); return }
    let msg = 'HTTP ' + r.status
    try { const d = await r.json(); msg = (d && d.error && (d.error.message || d.error)) || msg } catch {}
    toast('Embedding key failed: ' + msg, 'err')
  } catch (e) {
    toast('Embedding key error: ' + e.message, 'err')
  }
}

// =============================================================================
// Theme
// =============================================================================
function toggleTheme() {
  const curr = document.documentElement.getAttribute('data-theme') || 'light'
  const next  = curr === 'dark' ? 'light' : 'dark'
  document.documentElement.setAttribute('data-theme', next)
  localStorage.setItem('lcl_theme', next)
  document.getElementById('icon-moon').style.display = next === 'dark' ? '' : 'none'
  document.getElementById('icon-sun').style.display  = next === 'light' ? '' : 'none'
}

// ---------------------------------------------------------------------------
// merged from 83-ui-theme.js
// ---------------------------------------------------------------------------

function initTheme() {
  const saved = localStorage.getItem('lcl_theme') || 'light'
  document.documentElement.setAttribute('data-theme', saved)
  const moonEl = document.getElementById('icon-moon')
  const sunEl  = document.getElementById('icon-sun')
  if (moonEl) moonEl.style.display = saved === 'dark' ? '' : 'none'
  if (sunEl)  sunEl.style.display  = saved === 'light' ? '' : 'none'

  // Inject comet logo into sidebar header
  const COMET = '<svg width="28" height="28" viewBox="0 0 22 22" fill="none" xmlns=\"http://www.w3.org/2000/svg\"><line x1=\"10\" y1=\"10\" x2=\"2\" y2=\"18\" stroke=\"white\" stroke-width=\"1.5\" stroke-linecap=\"round\" opacity=\"0.7\"/><line x1=\"11.5\" y1=\"10\" x2=\"4\" y2=\"18\" stroke=\"white\" stroke-width=\"1\" stroke-linecap=\"round\" opacity=\"0.45\"/><line x1=\"10\" y1=\"11.5\" x2=\"2\" y2=\"20\" stroke=\"white\" stroke-width=\"0.6\" stroke-linecap=\"round\" opacity=\"0.28\"/><rect x=\"9\" y=\"1\" width=\"11\" height=\"11\" rx=\"1.5\" fill=\"white\" opacity=\"0.95\"/><rect x=\"11\" y=\"3\" width=\"7\" height=\"7\" rx=\"0.5\" fill=\"#e8610a\"/><line x1=\"13.3\" y1=\"3\" x2=\"13.3\" y2=\"10\" stroke=\"white\" stroke-width=\"0.5\" opacity=\"0.6\"/><line x1=\"15.7\" y1=\"3\" x2=\"15.7\" y2=\"10\" stroke=\"white\" stroke-width=\"0.5\" opacity=\"0.6\"/><line x1=\"11\" y1=\"5.3\" x2=\"18\" y2=\"5.3\" stroke=\"white\" stroke-width=\"0.5\" opacity=\"0.6\"/><line x1=\"11\" y1=\"7.7\" x2=\"18\" y2=\"7.7\" stroke=\"white\" stroke-width=\"0.5\" opacity=\"0.6\"/><line x1=\"12.5\" y1=\"1\" x2=\"12.5\" y2=\"0\" stroke=\"white\" stroke-width=\"1\" stroke-linecap=\"round\" opacity=\"0.8\"/><line x1=\"15\" y1=\"1\" x2=\"15\" y2=\"0\" stroke=\"white\" stroke-width=\"1\" stroke-linecap=\"round\" opacity=\"0.8\"/><line x1=\"17.5\" y1=\"1\" x2=\"17.5\" y2=\"0\" stroke=\"white\" stroke-width=\"1\" stroke-linecap=\"round\" opacity=\"0.8\"/><line x1=\"12.5\" y1=\"12\" x2=\"12.5\" y2=\"13.5\" stroke=\"white\" stroke-width=\"1\" stroke-linecap=\"round\" opacity=\"0.8\"/><line x1=\"15\" y1=\"12\" x2=\"15\" y2=\"13.5\" stroke=\"white\" stroke-width=\"1\" stroke-linecap=\"round\" opacity=\"0.8\"/><line x1=\"17.5\" y1=\"12\" x2=\"17.5\" y2=\"13.5\" stroke=\"white\" stroke-width=\"1\" stroke-linecap=\"round\" opacity=\"0.8\"/><line x1=\"20\" y1=\"3.5\" x2=\"21.5\" y2=\"3.5\" stroke=\"white\" stroke-width=\"1\" stroke-linecap=\"round\" opacity=\"0.8\"/><line x1=\"20\" y1=\"6.5\" x2=\"21.5\" y2=\"6.5\" stroke=\"white\" stroke-width=\"1\" stroke-linecap=\"round\" opacity=\"0.8\"/><line x1=\"20\" y1=\"9.5\" x2=\"21.5\" y2=\"9.5\" stroke=\"white\" stroke-width=\"1\" stroke-linecap=\"round\" opacity=\"0.8\"/><line x1=\"9\" y1=\"3.5\" x2=\"7.5\" y2=\"3.5\" stroke=\"white\" stroke-width=\"1\" stroke-linecap=\"round\" opacity=\"0.8\"/><line x1=\"9\" y1=\"6.5\" x2=\"7.5\" y2=\"6.5\" stroke=\"white\" stroke-width=\"1\" stroke-linecap=\"round\" opacity=\"0.8\"/><line x1=\"9\" y1=\"9.5\" x2=\"7.5\" y2=\"9.5\" stroke=\"white\" stroke-width=\"1\" stroke-linecap=\"round\" opacity=\"0.8\"/></svg>'
  const iconEl = document.getElementById('tb-brand-icon')
  if (iconEl) iconEl.innerHTML = COMET
}

// Sidebar minimise / expand (state persisted in localStorage)
function toggleSidebar() {
  const collapsed = document.body.classList.toggle('sb-collapsed')
  localStorage.setItem('lcl_sb_collapsed', collapsed ? '1' : '0')
  updateSidebarToggle(collapsed)
}

function updateSidebarToggle(collapsed) {
  const btn = document.getElementById('sb-toggle')
  if (btn) btn.setAttribute('data-tip-bottom', collapsed ? 'Expand sidebar' : 'Collapse sidebar')
}

function initSidebar() {
  const collapsed = localStorage.getItem('lcl_sb_collapsed') === '1'
  document.body.classList.toggle('sb-collapsed', collapsed)
  updateSidebarToggle(collapsed)
}

// Click 'RAG' in the embed panel to open a small info box (how RAG works + the
// Search mode options). Toggles; closes on outside click, Escape, or re-click.
function toggleRagInfo(e) {
  if (e) {
    e.stopPropagation()
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return
    if (e.type === 'keydown') e.preventDefault()
  }
  const box = document.getElementById('rag-info')
  if (!box) return
  if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return }
  box.classList.remove('hidden')
  const onDoc = ev => {
    if (ev.type === 'keydown' && ev.key !== 'Escape') return
    if (ev.type !== 'keydown' && (box.contains(ev.target) || (ev.target.closest && ev.target.closest('.rag-term')))) return
    box.classList.add('hidden')
    document.removeEventListener('mousedown', onDoc, true)
    document.removeEventListener('keydown', onDoc, true)
  }
  setTimeout(() => {
    document.addEventListener('mousedown', onDoc, true)
    document.addEventListener('keydown', onDoc, true)
  }, 0)
}
