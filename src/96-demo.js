// =============================================================================
// Demo mode (#demo) — renders the chat UI with seeded sample content WITHOUT
// connecting or calling the API. Exercises every output path: user messages
// (plain, multi-paragraph, with attachments), AI markdown (headings, lists,
// tables, code, blockquote, links, hr), RAG source tags, and the transient
// states (loading dots, 5xx retry box, 429 rate-limit box, generic error).
// Purely for visual / layout debugging. STRIP this module + the maybeDemo()
// guard in init() before promoting alpha -> stable.
// =============================================================================
function demoOn() {
  // Hash-only trigger: the #demo fragment is never sent to the server, so it
  // sidesteps the static-route query-string 404. Open http://localhost:3000/#demo
  try { return (location.hash || '').toLowerCase() === '#demo' } catch { return false }
}

const DEMO_AI_MARKDOWN = [
  '# Heading 1',
  '## Heading 2',
  '### Heading 3',
  '',
  'This reply demonstrates **bold**, *italic*, ~~strikethrough~~, and `inline code`, plus a [link](https://platform.ai.tech.gov.sg).',
  '',
  '> A blockquote, for when the model wants to emphasise something.',
  '',
  'Unordered list:',
  '- First item',
  '- Second item',
  '  - Nested item A',
  '  - Nested item B',
  '',
  'Ordered list:',
  '1. Step one',
  '2. Step two',
  '3. Step three',
  '',
  '| Model | Tier | Notes |',
  '|---|---|---|',
  '| cce.claude-opus-4-6 | CCE/SN | default |',
  '| gpt-5.5 | R/SN | OpenAI |',
  '| gemini-2.5-pro | R/SN | Google |',
  '',
  '---',
  '',
  'A fenced code block:',
  '',
  '```js',
  'function greet(name) {',
  '  return `hello, ${name}`',
  '}',
  '```'
].join('\n')

const DEMO_AI_CODE = [
  "Here are the same idea in three languages:",
  '',
  '```python',
  'def greet(name):',
  '    return f"hello, {name}"',
  '```',
  '',
  '```bash',
  'echo "hello, $1"',
  '```',
  '',
  'And a longer paragraph to check wrapping and line-height across multiple lines of prose so the spacing between the body text and the action row can be eyeballed at a realistic length.'
].join('\n')

// Called at the top of init(); returns true if it took over the boot so init()
// skips all network work (no /api/config, /api/data, /api/skills calls).
function maybeDemo() {
  if (!demoOn()) return false

  // Fake a connection so rendering treats us as connected; nothing hits network.
  creds = { apiKey: 'demo', model: 'cce.claude-opus-4-6', maxTokens: 8192,
            systemPrompt: '', chunkSize: 800, topK: 5,
            embedApiKey: '', embedModelId: '', classification: 'cce' }
  setHealth('ok', 'Demo')
  try { document.body.classList.remove('not-connected') } catch {}
  try { document.getElementById('connect-banner')?.classList.add('hidden') } catch {}

  const now = Date.now()
  const id = 'demo_chat'
  D.chats = {}
  D.chats[id] = {
    id, title: 'Demo - all output cases', pinned: false,
    createdAt: now, updatedAt: now, docs: [],
    messages: [
      // 1) plain user message
      { role: 'user', content: 'hello how are you', ts: now - 600000 },
      // 2) rich AI markdown (headings, lists, table, code, blockquote, hr, link)
      { role: 'assistant', content: DEMO_AI_MARKDOWN, ts: now - 590000 },
      // 3) user message WITH an attachment (expandable file chip)
      { role: 'user',
        content: 'Please summarise the attached report.\n<file name="quarterly-report.pdf">Q2 revenue rose 12% QoQ driven by cloud. Headcount flat. Two risks flagged: supply chain and FX exposure.</file>',
        fileNames: ['quarterly-report.pdf'], ts: now - 580000 },
      // 4) AI reply WITH RAG source tags
      { role: 'assistant',
        content: 'Based on the attached document, Q2 revenue grew **12% quarter-on-quarter**, led by cloud. Headcount was flat, and two risks were flagged: supply chain and FX exposure.',
        sources: ['quarterly-report.pdf #3', 'quarterly-report.pdf #7', 'notes.md #1'],
        ts: now - 570000 },
      // 5) long multi-paragraph user message
      { role: 'user',
        content: 'Can you walk me through the trade-offs?\n\nI care about latency, cost, and data classification. We are on Comet, behind Zscaler, and most of our traffic is Sensitive Normal with the occasional Confidential Cloud Eligible workload. Keep it concise.',
        ts: now - 560000 },
      // 6) AI reply with multiple code blocks + long prose
      { role: 'assistant', content: DEMO_AI_CODE, ts: now - 550000 }
    ]
  }
  chatId = id
  if (typeof renderAll === 'function') renderAll()

  // --- Transient UI states (not part of message history) -------------------
  const inner = document.querySelector('#messages .msgs-inner')
  if (!inner) return true
  const hdr = '<div class="msg-hdr"><div class="msg-av ai">LCL</div><div class="msg-role">cce.claude-opus-4-6</div><div class="msg-time">now</div></div>'
  const grp = (bodyHtml) => { const d = document.createElement('div'); d.className = 'msg-group'; d.innerHTML = hdr + '<div class="msg-body">' + bodyHtml + '</div>'; inner.appendChild(d) }

  // (a) loading / typing indicator
  grp('<div class="typing"><span></span><span></span><span></span></div>')

  // (b) 5xx error + auto-retry box
  grp(
    '<div style="background:rgba(220,60,60,.08);border:1px solid rgba(220,60,60,.3);border-radius:10px;padding:14px 16px;margin-top:14px;">'
    + '<div style="display:flex;align-items:center;gap:8px;font-weight:600;color:#e05050;margin-bottom:8px;font-size:13px">'
    + '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 1a6 6 0 110 12A6 6 0 018 2zm-.75 3.75a.75.75 0 011.5 0v3.5a.75.75 0 01-1.5 0v-3.5zm.75 6a.75.75 0 110-1.5.75.75 0 010 1.5z"/></svg>'
    + 'Error 502: Bad gateway</div>'
    + '<div style="font-size:12px;color:var(--tx2);line-height:1.7"><div style="margin-bottom:4px">The PlatformAI gateway returned a temporary error.</div>'
    + '<div>Retrying in: <strong style="color:var(--ac);font-family:var(--mono);font-size:13px">10s</strong>&nbsp;<span style="font-size:11px;opacity:.7">(attempt 1 of 3)</span></div></div>'
    + '<div style="margin-top:10px"><button class="btn-s" style="font-size:11px;padding:4px 12px">Cancel retry</button></div></div>'
  )

  // (c) 429 rate-limit box
  grp(
    '<div style="background:var(--pinbg);border:1px solid rgba(240,165,0,.35);border-radius:10px;padding:14px 16px;margin-top:14px;">'
    + '<div style="display:flex;align-items:center;gap:8px;font-weight:600;color:var(--pin);margin-bottom:8px;font-size:13px">'
    + '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3.5a.5.5 0 01.5.5v4.5l3 1.5a.5.5 0 01-.4.9l-3.3-1.65A.5.5 0 017.5 8.5V4a.5.5 0 01.5-.5z"/><path d="M8 16A8 8 0 108 0a8 8 0 000 16zM1 8a7 7 0 1114 0A7 7 0 011 8z"/></svg>'
    + 'Rate limit reached</div>'
    + '<div style="font-size:12px;color:var(--tx2);line-height:1.7"><div>Resets at:&nbsp; <strong style="color:var(--tx);font-family:var(--mono)">02:45 AM</strong></div>'
    + '<div>Retrying in: <strong style="color:var(--ac);font-family:var(--mono);font-size:13px">0:42</strong></div></div>'
    + '<div style="margin-top:10px"><button class="btn-s" style="font-size:11px;padding:4px 12px">Cancel retry</button></div></div>'
  )

  // (d) generic terminal error (no retry)
  grp(
    '<div style="background:rgba(220,60,60,.08);border:1px solid rgba(220,60,60,.3);border-radius:10px;padding:14px 16px;margin-top:14px;">'
    + '<div style="display:flex;align-items:center;gap:8px;font-weight:600;color:#e05050;margin-bottom:8px;font-size:13px">'
    + '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 1a6 6 0 110 12A6 6 0 018 2zm-.75 3.75a.75.75 0 011.5 0v3.5a.75.75 0 01-1.5 0v-3.5zm.75 6a.75.75 0 110-1.5.75.75 0 010 1.5z"/></svg>'
    + 'Request failed</div>'
    + '<div style="font-size:12px;color:var(--tx2);line-height:1.7">Upstream returned HTTP 500 after 3 attempts. Please try again.</div></div>'
  )

  return true
}
