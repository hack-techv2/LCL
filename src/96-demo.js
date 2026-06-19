// =============================================================================
// Demo mode (#demo) — renders the UI with seeded sample content WITHOUT
// connecting or calling the API. Exercises every output + interaction path so
// the app can be eyeballed and dynamically tested via Claude in Chrome.
// Open  http://localhost:3000/#demo  (a full reload, not just adding the hash).
//
// TEST / USE CASES COVERED
//   Chat list .... Pinned section, Today / Yesterday / Older date grouping,
//                  active-chat highlight, message counts, switching chats.
//   User msgs .... plain, multi-paragraph, with-attachment (expandable chip).
//   AI markdown .. headings, bold/italic/strike, inline code, links, blockquote,
//                  ordered/unordered/nested lists, table, hr, fenced code blocks.
//   AI extras .... RAG source tags; classification suffix in the welcome line.
//   Transient .... loading dots, 5xx retry box, 429 rate-limit box.
//   Terminal ..... non-retryable error as a plain assistant message (how the
//                  app actually persists it).
//   Composer ..... plain "Message LCL…" placeholder in an existing chat.
//   Settings ..... data-classification picker (light/dark contrast), Updates.
//
// Safe: persist() is a no-op while #demo is active, so nothing is written to
// lcl_data.json. STRIP src/96-demo.js + the maybeDemo() guard in init() before
// promoting alpha -> stable.
// =============================================================================
function demoOn() {
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
  'Here are the same idea in three languages:',
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

// Build a seeded chat. ts is the created/updated time and drives date grouping.
function demoChat(id, title, ts, pinned, messages) {
  messages.forEach((m, i) => { if (m.ts == null) m.ts = ts - (messages.length - i) * 60000 })
  return { id, title, pinned: !!pinned, createdAt: ts, updatedAt: ts, docs: [], messages }
}

// Called at the top of init(); returns true if it took over the boot so init()
// skips all network work.
function maybeDemo() {
  if (!demoOn()) return false

  creds = { apiKey: 'demo', model: 'cce.claude-opus-4-6', maxTokens: 8192,
            systemPrompt: '', chunkSize: 800, topK: 5,
            embedApiKey: '', embedModelId: '', classification: 'cce' }
  setHealth('ok', 'Demo')
  try { document.body.classList.remove('not-connected') } catch {}
  try { document.getElementById('connect-banner')?.classList.add('hidden') } catch {}

  const now = Date.now(), hr = 3600000, day = 86400000
  const mid = new Date(); mid.setHours(0, 0, 0, 0); const m0 = mid.getTime()

  D.chats = {}
  // Active (today) — the rich output showcase.
  D.chats['demo_active'] = demoChat('demo_active', 'Demo - all output cases', now - 5 * 60000, false, [
    { role: 'user', content: 'hello how are you' },
    { role: 'assistant', content: DEMO_AI_MARKDOWN },
    { role: 'user', content: 'Please summarise the attached report.\n<file name="quarterly-report.pdf">Q2 revenue rose 12% QoQ driven by cloud. Headcount flat. Two risks flagged: supply chain and FX exposure.</file>', fileNames: ['quarterly-report.pdf'] },
    { role: 'assistant', content: 'Based on the attached document, Q2 revenue grew **12% quarter-on-quarter**, led by cloud. Headcount was flat, and two risks were flagged: supply chain and FX exposure.', sources: ['quarterly-report.pdf #3', 'quarterly-report.pdf #7', 'notes.md #1'] },
    { role: 'user', content: 'Can you walk me through the trade-offs?\n\nI care about latency, cost, and data classification. We are on Comet, behind Zscaler, and most of our traffic is Sensitive Normal with the occasional Confidential Cloud Eligible workload. Keep it concise.' },
    { role: 'assistant', content: DEMO_AI_CODE }
  ])
  // Pinned — appears in the Pinned section regardless of date.
  D.chats['demo_pinned'] = demoChat('demo_pinned', 'Overlord TTP - payload notes', m0 - 2 * day + 14 * hr, true, [
    { role: 'user', content: 'Draft a short note on staged vs stageless payloads.' },
    { role: 'assistant', content: 'Staged payloads fetch the bulk of their code at runtime (smaller initial footprint, needs callback); stageless bundle everything up front (larger, but self-contained and more reliable on egress-restricted hosts).' }
  ])
  // Yesterday.
  D.chats['demo_yest'] = demoChat('demo_yest', 'EMC firmware analysis', m0 - 12 * hr, false, [
    { role: 'user', content: 'What should I look for in an MQTT broker config review?' },
    { role: 'assistant', content: 'Check for anonymous access, TLS enforcement, ACL scoping per topic, and whether credentials are reused across devices.' }
  ])
  // Older (≈12 days ago).
  D.chats['demo_old'] = demoChat('demo_old', 'PUB pentest scoping call', m0 - 12 * day - 12 * hr, false, [
    { role: 'user', content: 'Summarise the scoping call action items.' },
    { role: 'assistant', content: 'Three action items: confirm in-scope IP ranges, get a test window sign-off, and set up a shared evidence folder before kickoff.' }
  ])

  chatId = 'demo_active'
  if (typeof renderAll === 'function') renderAll()

  // --- Transient UI states (DOM-only, on the active chat view) --------------
  const inner = document.querySelector('#messages .msgs-inner')
  if (!inner) return true
  const hdr = '<div class="msg-hdr"><div class="msg-av ai">LCL</div><div class="msg-role">cce.claude-opus-4-6</div><div class="msg-time">now</div></div>'
  const grp = (bodyHtml) => { const d = document.createElement('div'); d.className = 'msg-group'; d.innerHTML = hdr + '<div class="msg-body">' + bodyHtml + '</div>'; inner.appendChild(d) }

  // (a) loading / typing indicator
  grp('<div class="typing"><span></span><span></span><span></span></div>')

  // (b) 5xx auto-retry box (shared statusBox helper)
  grp(statusBox('err', 'Error 502: Bad gateway',
    '<div style="margin-bottom:4px">The PlatformAI gateway returned a temporary error.</div>'
    + '<div>Retrying in: <strong style="color:var(--ac);font-family:var(--mono);font-size:13px">10s</strong>&nbsp;<span style="font-size:11px;opacity:.7">(attempt 1 of 3)</span></div>',
    { icon: 'err', cancel: 'void 0' }))

  // (c) 429 rate-limit box
  grp(statusBox('warn', 'Error 429: Rate limit reached',
    '<div>Resets at:&nbsp; <strong style="color:var(--tx);font-family:var(--mono)">02:45 AM</strong></div>'
    + '<div>Retrying in: <strong style="color:var(--ac);font-family:var(--mono);font-size:13px">0:42</strong></div>',
    { icon: 'clock', cancel: 'void 0' }))

  // (d) terminal (non-retryable) error — a plain assistant message, exactly how
  // the real flow persists it (not a box).
  grp('Error 500: Server error — the model service is temporarily unreachable. Please try again in a moment.')

  return true
}
