// =============================================================================
// Model catalogue — drives the Settings / Connect dropdowns.
// Source: GovTech PlatformAI Models page. A "Custom…" option always remains so
// any model not listed here can still be entered by hand.
// =============================================================================
const MODEL_GROUPS = [
  { label: 'Claude (Anthropic)', ids: [
    'cce.claude-opus-4-6','cce.claude-sonnet-4-6','cce.claude-opus-4-5','cce.claude-sonnet-4-5','cce.claude-3-5-sonnet',
    'rsn.claude-opus-4-8','rsn.claude-opus-4-7','rsn.claude-opus-4-6','rsn.claude-opus-4-5','rsn.claude-opus-4-1',
    'rsn.claude-sonnet-4-6','rsn.claude-sonnet-4-5','rsn.claude-sonnet-4-0','rsn.claude-haiku-4-5',
    'rsn.vertex_ai.claude-opus-4-6','rsn.vertex_ai.claude-opus-4-5','rsn.vertex_ai.claude-sonnet-4-6','rsn.vertex_ai.claude-sonnet-4-5',
    'azure.claude-opus-4-8','azure.claude-opus-4-7','azure.claude-opus-4-6','azure.claude-opus-4-5',
    'azure.claude-sonnet-4-6','azure.claude-sonnet-4-5','azure.claude-haiku-4-5',
    'bedrock.claude-opus-4-8','bedrock.claude-opus-4-7','bedrock.claude-opus-4-6','bedrock.claude-opus-4-5',
    'bedrock.claude-sonnet-4-6','bedrock.claude-sonnet-4-5','bedrock.claude-sonnet-4-0','bedrock.claude-haiku-4-5','bedrock.claude-3-5-sonnet',
    'vertex_ai.claude-opus-4-8','vertex_ai.claude-opus-4-7','vertex_ai.claude-opus-4-6','vertex_ai.claude-opus-4-5','vertex_ai.claude-opus-4-1',
    'vertex_ai.claude-sonnet-4-6','vertex_ai.claude-sonnet-4-5','vertex_ai.claude-haiku-4-5'
  ] },
  { label: 'OpenAI', ids: [
    'gpt-5.5','gpt-5.4-pro','gpt-5.4','gpt-5.3-codex','gpt-5.2-chat','gpt-5.2','gpt-5.1','gpt-5','gpt-5-mini','gpt-5-nano',
    'gpt-4.1','gpt-4.1-mini','gpt-4.1-nano','gpt-4o','gpt-4o-pt','gpt-4o-mini','o3','o3-mini','o4-mini'
  ] },
  { label: 'Google Gemini', ids: [
    'gemini-3.5-flash','gemini-3.1-pro-preview','gemini-3.1-flash-lite','gemini-3.1-flash-lite-preview','gemini-3-flash-preview',
    'gemini-2.5-pro','gemini-2.5-flash','gemini-2.5-flash-pt','gemini-2.5-flash-lite'
  ] },
]

const EMBED_GROUPS = [
  { label: 'Embedding models', ids: [
    'cohere.embed-english-v3','cohere.embed-multilingual-v3','cohere.embed-v4:0',
    'text-embedding-3-large','text-embedding-3-small','text-embedding-ada-002',
    'gemini-embedding-001'
  ] },
]

// Populate a <select> from grouped model ids; selects `current` if present.
// Always appends a "Custom…" option. Returns true if current matched a listed id.
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

// Wire a model <select id="<inputId>-sel"> to its hidden text <input id="<inputId>">.
// The input still holds the value (so existing save/connect logic is unchanged);
// the select writes into it, and "Custom…" reveals the input for free-text entry.
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
