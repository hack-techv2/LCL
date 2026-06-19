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
    const r = await fetch('/skills/' + encodeURIComponent(id))
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
    const r = await fetch('/skills/' + encodeURIComponent(_editingSkillId), {
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
    let r = await fetch('/skills/' + encodeURIComponent(oldId))
    if (!r.ok) throw new Error('Read old: HTTP ' + r.status)
    const data = await r.json()
    r = await fetch('/skills/' + encodeURIComponent(slug), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: data.body })
    })
    if (!r.ok) throw new Error('Write new: HTTP ' + r.status)
    r = await fetch('/skills/' + encodeURIComponent(oldId), { method: 'DELETE' })
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
    const r = await fetch('/skills/' + encodeURIComponent(id), { method: 'DELETE' })
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
function saveSP() {
  creds.apiKey       = document.getElementById('s-key').value.trim()||creds.apiKey
  creds.model        = document.getElementById('s-mdl').value.trim()||creds.model
  creds.systemPrompt = document.getElementById('s-sys').value.trim()
  const tokInput = parseInt(document.getElementById('s-tok-v-input').value)
  creds.maxTokens    = isNaN(tokInput) ? parseInt(document.getElementById('s-tok').value) : Math.max(64, Math.min(131072, tokInput))
  creds.chunkSize    = parseInt(document.getElementById('s-chunk').value)
  creds.topK         = parseInt(document.getElementById('s-topk').value)
  creds.embedApiKey  = document.getElementById('s-embk').value.trim() || creds.embedApiKey
  creds.embedModelId = document.getElementById('s-embm').value.trim() || creds.embedModelId
  creds.classification = ((typeof _clsState!=='undefined' && _clsState.sp) || creds.classification || inferTier(creds.model) || 'cce')
  // Mirror into D.settings so persist() also carries these to disk
  D.settings = { apiKey: creds.apiKey, modelId: creds.model, maxTokens: creds.maxTokens, systemPrompt: creds.systemPrompt, chunkSize: creds.chunkSize, topK: creds.topK, embedApiKey: creds.embedApiKey||'', embedModelId: creds.embedModelId||'', classification: creds.classification }
  try {
    fetch('/api/config', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(D.settings) })
  } catch {}
  persist()
  closeSP(); toast('Settings saved','ok')
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
