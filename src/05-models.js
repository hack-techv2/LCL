// =============================================================================
// Model catalogue — organised by GovTech PlatformAI data-classification tier.
// The user picks a classification first; the Model / Embed dropdowns then show
// only models cleared for that tier. A "Custom…" option always remains so any
// model not listed here can still be entered by hand.
//   cce = CCE/SN  (Confidential Cloud Eligible & Sensitive Normal)
//   rsn = R/SN    (Restricted & Sensitive Normal and below)
// =============================================================================
const CLS = {
  cce: { short: 'CCE/SN', full: 'Confidential Cloud Eligible (Sensitive Normal)' },
  rsn: { short: 'R/SN',  full: 'Restricted (Sensitive Normal)' },
}
// Default tier + the set of valid tiers both come from CLS, so adding a tier is a
// CLS/MODEL_TIERS/EMBED_TIERS entry (+ a .seg-btn.on-<tier> CSS rule) - no logic edits.
const CLS_DEFAULT = Object.keys(CLS)[0]

const MODEL_TIERS = {
  cce: [
    { label: 'Claude (Anthropic)', ids: [
      'cce.claude-opus-4-6','cce.claude-sonnet-4-6','cce.claude-opus-4-5','cce.claude-sonnet-4-5','cce.claude-3-5-sonnet',
      'vertex_ai.claude-opus-4-6','vertex_ai.claude-opus-4-5','vertex_ai.claude-sonnet-4-6','vertex_ai.claude-sonnet-4-5',
      'bedrock.claude-3-5-sonnet'
    ] },
    { label: 'OpenAI', ids: ['gpt-4o-pt'] },
    { label: 'Google Gemini', ids: ['gemini-2.5-flash-pt'] },
  ],
  rsn: [
    { label: 'Claude (Anthropic)', ids: [
      'azure.claude-opus-4-8','azure.claude-opus-4-7','azure.claude-opus-4-6','azure.claude-opus-4-5','azure.claude-sonnet-4-6','azure.claude-sonnet-4-5','azure.claude-haiku-4-5',
      'rsn.claude-opus-4-8','rsn.claude-opus-4-7','rsn.claude-opus-4-6','rsn.claude-opus-4-5','rsn.claude-opus-4-1','rsn.claude-sonnet-4-6','rsn.claude-sonnet-4-5','rsn.claude-sonnet-4-0','rsn.claude-haiku-4-5',
      'rsn.vertex_ai.claude-opus-4-6','rsn.vertex_ai.claude-opus-4-5','rsn.vertex_ai.claude-sonnet-4-6','rsn.vertex_ai.claude-sonnet-4-5',
      'bedrock.claude-opus-4-8','bedrock.claude-opus-4-7','bedrock.claude-opus-4-6','bedrock.claude-opus-4-5','bedrock.claude-sonnet-4-6','bedrock.claude-sonnet-4-5','bedrock.claude-sonnet-4-0','bedrock.claude-haiku-4-5',
      'vertex_ai.claude-opus-4-8','vertex_ai.claude-opus-4-7','vertex_ai.claude-opus-4-1','vertex_ai.claude-haiku-4-5'
    ] },
    { label: 'OpenAI', ids: [
      'gpt-5.5','gpt-5.4-pro','gpt-5.4','gpt-5.3-codex','gpt-5.2-chat','gpt-5.2','gpt-5.1','gpt-5','gpt-5-mini','gpt-5-nano',
      'gpt-4.1','gpt-4.1-mini','gpt-4.1-nano','gpt-4o','gpt-4o-mini','o3','o3-mini','o4-mini'
    ] },
    { label: 'Google Gemini', ids: [
      'gemini-3.5-flash','gemini-3.1-pro-preview','gemini-3.1-flash-lite','gemini-3.1-flash-lite-preview','gemini-3-flash-preview',
      'gemini-2.5-pro','gemini-2.5-flash','gemini-2.5-flash-lite'
    ] },
  ],
}

const EMBED_TIERS = {
  cce: [ { label: 'Embedding models', ids: ['cohere.embed-english-v3','cohere.embed-multilingual-v3','gemini-embedding-001'] } ],
  rsn: [ { label: 'Embedding models', ids: ['text-embedding-3-large','text-embedding-3-small','text-embedding-ada-002','cohere.embed-v4:0','gemini-embedding-2'] } ],
}

// ---------------------------------------------------------------------------
// Model context windows (tokens) — powers query-aware full-document injection
// (dynamic scaling, v0.67e item 2). Source: PlatformAI Models panel
// (see MODEL_CONTEXT_REFERENCE.md). Keyed by prefix-stripped base model+version;
// provider prefixes (azure./bedrock./vertex_ai./rsn./cce./rsn.vertex_ai.) do NOT
// change the window. Unknown / "Custom…" ids fall back to CFG.DOC_FULLTEXT_FLOOR.
// ---------------------------------------------------------------------------
const MODEL_CONTEXT = {
  'claude-3-5-sonnet': 200000, 'claude-haiku-4-5': 200000,
  'claude-opus-4-1': 200000,  'claude-opus-4-5': 200000,
  'claude-opus-4-6': 1000000, 'claude-opus-4-7': 1000000, 'claude-opus-4-8': 1000000,
  'claude-sonnet-4-0': 1000000, 'claude-sonnet-4-5': 1000000, 'claude-sonnet-4-6': 1000000,
  'gpt-4o': 128000, 'gpt-4o-mini': 128000, 'gpt-4o-pt': 128000,
  'gpt-4.1': 1047576, 'gpt-4.1-mini': 1047576, 'gpt-4.1-nano': 1047576,
  'o3': 200000, 'o3-mini': 200000, 'o4-mini': 200000,
  'gpt-5': 272000, 'gpt-5-mini': 272000, 'gpt-5-nano': 272000,
  'gpt-5.1': 272000, 'gpt-5.2': 272000, 'gpt-5.2-chat': 111616, 'gpt-5.3-codex': 272000,
  'gpt-5.4': 1050000, 'gpt-5.4-pro': 1050000, 'gpt-5.5': 1050000,
  'gemini-2.5-flash': 1048576, 'gemini-2.5-flash-pt': 1048576, 'gemini-2.5-flash-lite': 1048576,
  'gemini-2.5-pro': 1048576, 'gemini-3-flash-preview': 1048576,
  'gemini-3.1-flash-lite': 1000000, 'gemini-3.1-flash-lite-preview': 1048576,
  'gemini-3.1-pro-preview': 1048576, 'gemini-3.5-flash': 1000000,
}
// Embed models: max input tokens per request (governs chunk/batch sizing, item 8).
const EMBED_MAX_TOKENS = {
  'cohere.embed-english-v3': 512, 'cohere.embed-multilingual-v3': 512,
  'cohere.embed-v4:0': 128000, 'gemini-embedding-001': 2048, 'gemini-embedding-2': 8192,
  'text-embedding-3-large': 8192, 'text-embedding-3-small': 8192, 'text-embedding-ada-002': 8192,
}
function normalizeModelId(id) {
  return (id || '').trim().replace(/^(rsn\.vertex_ai\.|rsn\.|cce\.|azure\.|bedrock\.|vertex_ai\.)/, '')
}
// Chat-model context window in tokens, or null when unknown (caller uses floor).
function getModelContext(id) { return MODEL_CONTEXT[normalizeModelId(id)] || null }
// Embed-model max input tokens, or null when unknown.
function getEmbedMaxTokens(id) { return EMBED_MAX_TOKENS[(id || '').trim()] || null }
// clampTopK: constrain Top-K to CFG bounds (3-10, default 5) — v0.67e item 5.
function clampTopK(v) {
  const n = parseInt(v, 10)
  const min = CFG.TOP_K_MIN || 3
  const max = CFG.TOP_K_MAX || 10
  const dft = CFG.DEFAULT_TOP_K || 5
  return Math.max(min, Math.min(max, isNaN(n) ? dft : n))
}

function tierGroups(kind, tier) {
  const src = (kind === 'embed') ? EMBED_TIERS : MODEL_TIERS
  return src[tier] || src[CLS_DEFAULT]
}
function clsLabel(tier) { return (CLS[tier] || {}).short || '' }

function inferTier(modelId) {
  const id = (modelId || '').trim()
  if (!id) return null
  for (const t of Object.keys(CLS)) {
    if (MODEL_TIERS[t].some(g => g.ids.includes(id)) || EMBED_TIERS[t].some(g => g.ids.includes(id))) return t
  }
  return null
}

function clsSuffix(c) {
  const t = (c && c.classification) || inferTier(c && c.model)
  const l = clsLabel(t)
  return l ? ' <span style="color:var(--tx3)">(' + l + ')</span>' : ''
}

function fillModelSelect(sel, groups, current) {
  sel.innerHTML = ''
  let found = false
  for (const g of groups) {
    const og = document.createElement('optgroup'); og.label = g.label
    for (const id of g.ids) {
      const o = document.createElement('option'); o.value = id; o.textContent = id
      if (id === current) { o.selected = true; found = true }
      og.appendChild(o)
    }
    sel.appendChild(og)
  }
  const c = document.createElement('option')
  c.value = '__custom__'
  c.textContent = (!found && current) ? ('Custom: ' + current) : 'Custom…'
  if (!found) c.selected = true
  sel.appendChild(c)
  return found
}

function wireModelField(inputId, groups) {
  const input = document.getElementById(inputId)
  const sel = document.getElementById(inputId + '-sel')
  if (!input || !sel) return
  const found = fillModelSelect(sel, groups, (input.value || '').trim())
  input.style.display = found ? 'none' : ''
  sel.onchange = () => {
    if (sel.value === '__custom__') { input.style.display = ''; input.focus() }
    else { input.value = sel.value; input.style.display = 'none' }
  }
}

// ---------------------------------------------------------------------------
// Classification control (shared): pick a tier, then the model + embed lists
// filter to it. scope 'sp' = Settings panel, 'cfg' = Connect modal.
// ---------------------------------------------------------------------------
let _clsState = { sp: 'cce', cfg: 'cce' }

function ensureTierModel(inputId, groups) {
  const input = document.getElementById(inputId)
  if (!input) return
  const ids = groups.flatMap(g => g.ids)
  if (!ids.includes((input.value || '').trim())) input.value = ids[0] || ''
}

function applyClsUI(scope, tier) {
  const seg = document.getElementById(scope === 'cfg' ? 'cls-seg-cfg' : 'cls-seg-sp')
  if (seg) seg.querySelectorAll('.seg-btn').forEach(b => {
    const on = b.dataset.cls === tier
    Object.keys(CLS).forEach(k => b.classList.remove('on-' + k))
    if (on) b.classList.add('on-' + tier)
  })
  if (scope === 'cfg') {
    wireModelField('cfg-mdl', tierGroups('model', tier))
  } else {
    wireModelField('s-mdl', tierGroups('model', tier))
    wireModelField('s-embm', tierGroups('embed', tier))
  }
}

function initClassification(scope, tier) {
  tier = CLS[tier] ? tier : CLS_DEFAULT
  _clsState[scope] = tier
  applyClsUI(scope, tier)
}

function setClassification(tier, scope) {
  tier = CLS[tier] ? tier : CLS_DEFAULT
  _clsState[scope] = tier
  if (scope === 'cfg') {
    ensureTierModel('cfg-mdl', tierGroups('model', tier))
  } else {
    ensureTierModel('s-mdl', tierGroups('model', tier))
    ensureTierModel('s-embm', tierGroups('embed', tier))
  }
  applyClsUI(scope, tier)
}
