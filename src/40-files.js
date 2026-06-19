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
  try { fetch('/api/config', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(settingsBody) }) } catch {}
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
    const resp = await fetch('/api/embed', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ apiKey: keyVal, modelId: modelVal, input: 'test' })
    })
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
const SUPPORTED_EXTS = new Set([
  'pdf','docx','xlsx','xls',
  'txt','md','csv','log',
  'json','js','py','ps1','sh','xml','yaml','yml'
])

function getExt(name) { return (name.split('.').pop()||'').toLowerCase() }

function isSupported(file) {
  return SUPPORTED_EXTS.has(getExt(file.name))
}
