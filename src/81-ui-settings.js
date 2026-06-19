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
  el.style.setProperty('--fill', pct + '%')
}

// Settings
function openSP() {
  if (!creds) return
  document.getElementById('s-key').value   = creds.apiKey||''
  document.getElementById('s-mdl').value   = creds.model||''
  document.getElementById('s-sys').value   = creds.systemPrompt||''
  document.getElementById('s-tok').value   = Math.min(32768, creds.maxTokens||8192)
  document.getElementById('s-tok-v-input').value = creds.maxTokens||8192
  document.getElementById('s-chunk').value = creds.chunkSize||800
  document.getElementById('s-topk').value  = creds.topK||5
  document.getElementById('s-embk').value  = creds.embedApiKey||''
  document.getElementById('s-embm').value  = creds.embedModelId||''
  document.getElementById('s-tok-v').textContent   = creds.maxTokens||8192
  document.getElementById('s-chunk-v').textContent = creds.chunkSize||800
  document.getElementById('s-topk-v').textContent  = creds.topK||5
  // Paint the slider fills to match initial values
  refreshSliderFill(document.getElementById('s-tok'))
  refreshSliderFill(document.getElementById('s-chunk'))
  refreshSliderFill(document.getElementById('s-topk'))
  if (typeof wireModelField === 'function') { wireModelField('s-mdl', MODEL_GROUPS); wireModelField('s-embm', EMBED_GROUPS) }
  document.getElementById('sp').classList.remove('hidden')
  if (typeof renderUpdateSettings === 'function') renderUpdateSettings()
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
    root.innerHTML = '<div style="font-size:11px;color:var(--tx3);padding:6px">No skills yet. Upload a .md file or drop one into LCL_DIR/skills/.</div>'
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
    const r = await fetch('/skills/reload', { method: 'POST' })
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
    const r = await fetch('/skills/' + encodeURIComponent(slug), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body })
    })
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
