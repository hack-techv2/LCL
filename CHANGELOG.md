LCL CHANGELOG  —  v0.67d
========================

Released: 17 Jun 2026


Additional v0.67d updates (19 Jun 2026, release batch)
---------------------------------------------------------

Embedding cache cleanup
- Removing an embedded document now garbage-collects its vectors from
  embed_cache.bin. A server-side GC (/api/embed-gc) keeps only vectors
  still referenced by a chunk in some saved doc, and never drops a
  vector another doc still shares. A startup sweep also prunes orphans
  left behind by older builds. Replaces the previous per-hash eviction,
  which left removed docs' vectors stranded on disk.

Settings / models
- Chat model and embedding model are now dropdowns, grouped by provider
  (Claude / OpenAI / Gemini), each with a "Custom..." fallback for manual
  entry. Wired consistently across the Connect modal, Settings, and the
  embed-key banner.
- Embedding batch limits corrected: gemini-embedding-001 raised from 1 to
  96 texts/request (the API supports batching).
- Settings button uses a proper gear icon. The Settings panel gains an X
  close button (top-right) and Esc-to-close (closes the topmost open
  overlay), so no more scrolling to the bottom to dismiss it.
- AI reply header and the typing indicator now show the full prefixed
  model id (e.g. cce.claude-opus-4-6) instead of the stripped short name.

Sidebar
- Long chat names scroll (marquee) on hover instead of staying truncated.

Auto-update (new)
- LCL can check GitHub releases for a newer version and update on user
  consent. Front end: a footer version badge (shows "up to date" or a
  "new version" prompt) and an Updates section in Settings (check / view
  notes / download & apply).
- The apply flow downloads index.html and server.txt to temp files and
  verifies each against checksums.txt (SHA-256) before atomically swapping
  them in. server.txt changes require a Node restart to take effect.
- server.txt: /api/update/check and /api/update/apply endpoints; cmpVer
  version comparison (numbers + trailing letter, so 0.67e > 0.67d). The
  startup log now narrates the check (checking / up to date / available /
  failed).
- build.js writes checksums.txt for the shipped files (index.html,
  server.txt) on every build.
- LCL_DIR resolution adds an environment-variable override plus
  OneDrive/home Desktop fallbacks.


Additional v0.67d updates (18 Jun 2026, later batch)
---------------------------------------------------------

Document handling / RAG
- Documents that fit the model's context window are now sent to the
  model IN FULL instead of as a handful of retrieved chunks. Previously
  topK (~10) chunks were injected, so large PDFs (e.g. the 64-page CII
  Code of Practice, 193 chunks) surfaced only ~5% of the content and the
  model reported it "could only see a few excerpts". Small PDFs already
  worked because topK happened to cover most of them.
- Threshold is creds.docFullTextLimit (default 200000 chars, ~50K
  tokens). Files over the budget still fall back to chunk-retrieval (RAG).
- No re-embedding or re-upload needed; full text is read from the stored
  document content.

OCR
- Scan-detection trigger tightened. OCR is now offered only when a PDF
  has BOTH >=2 empty-text pages AND >=15% of its pages empty, so a single
  blank/divider page in a normal text PDF no longer prompts OCR.
- OCR retained for genuinely scanned (image-only) PDFs; still lazy-loaded
  (Tesseract.js ~3 MB) only when a scanned doc is detected.

Rate-limit pacing (embedding)
- server.txt: embed batches are now paced against the per-minute
  rate-limit window (~20 requests / 200K tokens). Before each batch, if
  the latest rate-limit snapshot shows the key is near its cap, the server
  waits out the window instead of bursting into a 429 that the short retry
  could not outlast (the cause of embedding occasionally stopping midway).
- Rate-limit snapshots are timestamped to estimate window reset.
- Front-end clarity: during a pause the server streams a 'pacing' SSE
  countdown the client surfaces as a toast ("API rate limit reached —
  resuming embedding in ~Ns") and in the health pill. Normal progress now
  also updates the health pill ("Embedding X/Y") so it never looks frozen.

UI / spacing
- Tightened chat message spacing: line-height 1.78 -> 1.55, per-message
  padding 18px -> 11px, paragraph margins 10px -> 7px.
- Chat list no longer shows a stray horizontal scrollbar ("grey bar"
  above Skills): chat-list overflow-x clipped and the pin/rename/delete
  action tooltips left-anchored so they no longer spill past the edge.


UI / sidebar
- Sidebar collapses to a slim icon rail (toggle in topbar). Rail shows
  New chat, each chat as an initial box (hover = full name, click = open,
  pinned = gold border), Settings and the logo. Collapsed state persists.
- Chats render as distinct boxes in the list; hover shows the full name.
- Removed the sidebar/main vertical divider and aligned the sidebar
  header border with the topbar for a cleaner top.
- Footer logo: the "LCL" text swatch replaced with the comet icon.

Settings / embeddings
- Embed API Key + Embed Model fields added to Settings (changeable any
  time, not only on first run).
- Per-model embedding limits hardcoded (texts/request + per-text cap):
  Cohere Embed v3 = 96 / ~2000 chars; OpenAI text-embedding-3 = 2048 /
  ~30000 chars; unknown models fall back to the safe Cohere caps. Fixes
  "Invalid parameter combination" 400s on docs with >96 chunks (the old
  flat batch of 100 exceeded Cohere's 96-text limit).
- Auth header standardised to x-api-key (per PlatformAI llms.txt).

Formatting
- Copy for Word / Outlook: tables keep visible grid lines (borders
  inlined per cell; Word/Outlook ignore <style> blocks).

Theme
- Dark mode "Neutral slate" palette: crisper borders and brighter
  secondary/tertiary text for stronger contrast.

Dev / build
- build.js hardened into a real gate: numbered verbose checklist —
  per-module + full-bundle node --check, undefined-function scan,
  size/banner floors. Deterministic output (no build timestamp).
- Optional post-build packaging into a password-protected, DEFLATE-
  compressed LCL.zip, with hash-based change detection (only changed
  files; baseline auto-updates in build.js).
- src/ heavy modules split into <8 KB files to reduce silent-truncation
  risk during edits.

Welcome screen & composer
- New-chat welcome shows a dynamic description by state: the connected
  model name; embedding status + embed model when configured; and, in
  italics, the "copy any reply into Word/Outlook" capability. Covers four
  states (not connected / model / model+embed / embed-set-only).
- Suggestion buttons replaced with icon cards (document, shield, bulb);
  clicking one drops a starter prompt into the composer and focuses it.
- Subtle typewriter placeholder cycles example prompts while the input is
  empty; pauses the instant you focus or type.

Chats
- New chats are now transient: a blank chat (no messages and no docs) no
  longer shows in the sidebar or lingers as a phantom "New chat". New chat
  reuses an existing blank and prunes extras; deleting the open chat lands
  on the most-recent remaining chat, or a clean welcome state.
- Each chat row (and collapsed rail box) has a tooltip with its full name.

Fixes
- Hovering a chat's delete button no longer pops a stray native tooltip
  (the full-name title moved off the whole row onto the name/box only).
- Attach-file tooltip right-anchored so it isn't clipped at the edge;
  rail tooltips repositioned to clear the topbar toggle and avoid clipping.
- PDF.js verbosity lowered to errors-only — suppresses the harmless
  "TT: undefined function" TrueType font warnings some PDFs emit.
- Removed the redundant "Embed these files?" confirmation popup; uploading
  to the Embed panel now embeds immediately.
- RAG retrieval fixed: embedded docs returned no context to the model
  because embedDoc stored the embedding vector in embHash instead of the
  hash, so the vector lookup always missed. embed-batch now returns the
  per-chunk hashes; embHash stores the real hash. Back-compat: chunks whose
  embHash is a vector (older builds) are used directly, so existing embeds
  work without re-embedding.


Fixes, reliability & polish (v0.67d patch — 17 Jun 2026)
---------------------------------------------------------

- GPT model connection fix — the connect ping previously used
  max_tokens:1 which some providers (e.g. GPT) reject with 400/422.
  The ping now escalates: 1 → 16 → 32 until the model accepts it.
  Claude models still use max_tokens:1 (cheapest ping). No model-
  string matching — the escalation auto-discovers the minimum.

- Connect retry hardened — the connection ping now retries 3 times
  with exponential backoff (1s → 2s → 4s) before reporting failure,
  up from 2 attempts with no configurable interval.

- 502 / 503 / 504 auto-retry in chat — instead of a static error
  bubble, gateway errors now show a live countdown and auto-retry
  up to 3 times (5s → 10s → 20s backoff). A Cancel button stops
  the retry. 504 additionally shows "try splitting your request
  into smaller parts". After 3 failed retries the raw error is shown.

- SSL / Zscaler error messaging — SSL handshake failures (the
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY class of errors) previously
  surfaced as an opaque raw error string in both the connect modal
  and chat. They now show: "SSL certificate error — Please try
  restarting your Zscaler connection, then reconnect / retry."

- Copy as HTML table borders fixed — pasting into Word or Outlook
  showed white/invisible table borders because CSS custom properties
  (var(--bdr2) etc.) were copied verbatim and not understood by
  Office. resolveCssVars() now substitutes all var(--x) references
  with their computed colour values before the HTML is written to
  the clipboard, so table borders, header backgrounds, and text
  colours all render correctly in Office applications.

- Light mode palette refresh — the light theme was dull due to
  borders matching background colours and washed-out secondary text.
  Replaced with a higher-contrast slate palette: deeper layer
  separation (bg #edf0f7 → panels #f8f9fc → inputs #dde1ee),
  clearly visible borders (bdr #b8c0d4, bdr2 #8e9ab4), and deeper
  text (tx2 #293050, tx3 #4e5a72). The orange accent now pops
  visibly against the slate background. Dark mode is unchanged.

- Copy for Word / Outlook — font set to Aptos (Outlook default),
  with Calibri → Arial → sans-serif fallback. Font size and
  line-height are left unset so the paste inherits the surrounding
  paragraph style rather than overriding it.

- Copy / Regenerate / Copy for Word tooltips — all three message
  action buttons now have descriptive title tooltips on hover.

- CSS variable resolution for clipboard HTML — resolveCssVars()
  substitutes all var(--x) references with computed values before
  writing to the clipboard, so table borders, backgrounds, and text
  colours render correctly in Word and Outlook (which don't
  understand CSS custom properties).

- Build validation (dev) — build.js now runs three checks after
  every build: (1) null-byte scan on the concatenated output —
  catches the file-corruption issue seen previously; (2) section
  banner presence check — confirms every src/ module is included;
  (3) JS syntax check via node --check on the extracted <script>
  block, with error messages mapped back to the source file name.
  Build exits with code 1 and prints which check failed.

- src/ file truncation repair — six src/ files were found silently
  truncated mid-statement by prior Edit/Write tool operations:
  10-state.js (fetchWithRetry tail), 20-auth.js (disconnect + helper
  functions connectedLabel/updateConnectedUI), 30-chatlist.js
  (finishRename body), 40-files.js (embedDoc completion), 50-chatprocessing.js
  (regenerateLast tail), 80-ui.js (initTheme/COMET SVG + injection).
  All were reconstructed from context (head.html SVGs, surrounding
  function patterns, connect() mirror). The build.js validator has a
  known blind spot: it checks the first <script> block (always an
  empty CDN stub), not the main block. Mitigation: run the full check
  manually — see PROJECT_BRIEF.md.


UI & features
-------------

- Copy for Word / Outlook button — AI message bubbles now show a second
  copy button alongside the existing "Copy" (markdown). "Copy for Word /
  Outlook" writes a text/html + text/plain ClipboardItem so that pasting
  into Word or Outlook preserves headings, bold, tables and bullet points
  natively. Falls back to plain text on browsers that don't support
  ClipboardItem (Firefox). User messages are not affected — they don't
  have rendered markdown to copy.

- Binary embed cache — embedding vectors are now persisted to
  embed_cache.bin in Float16 format (halving storage vs Float32).
  Each chunk stores only a 16-char SHA-1 hash (embHash) on the
  client; the actual vector lives server-side. On restart the server
  loads the binary cache from disk, so previously embedded documents
  require no re-embedding. Cache is keyed by SHA1(modelId + ':' + text)
  for correctness across model changes.

- Hash-based embedding pipeline — the client no longer stores raw
  float vectors in lcl_data.json. embedBatch() sends texts to the new
  /api/embed-batch endpoint (SSE for partial cache misses, plain JSON
  for full cache hits). retrieveChunks() fetches vectors on demand via
  /api/embed-lookup using the stored hashes. Removing a document evicts
  its hashes from the server cache via /api/embed-evict. handleSaveData
  strips any residual embedding arrays before writing lcl_data.json,
  keeping the data file lean.

- ragStickyChunks — 30% of RAG topK slots are reserved for chunks that
  were relevant in the previous turn. This improves multi-turn coherence
  when a conversation follows up on a specific section of a document.
  The sticky set is cleared when the user switches to a different chat
  or starts a new one.

- Path normalization hardened — serveStatic now checks that the resolved
  file path starts with LCL_DIR using path.resolve + path.sep, returning
  403 Forbidden on any directory traversal attempt. The old regex strip
  was a defence-in-depth measure; the prefix check is the correct fix.



- Removed Report a bug button — the sidebar button, browser error
  capture, and downloadCrashLog() function have been removed. The
  server-side /api/logs endpoint and in-memory ring buffer have also
  been removed from server.txt. Users can still inspect Node.js
  output directly in the terminal window where server.txt is running.

- Scanned PDF detection + on-demand OCR — when a PDF is uploaded,
  LCL counts how many pages returned no extractable text. If any
  pages on a multi-page PDF are blank (image-only / scanned):

    Embed flow: a pre-confirm dialog offers to run OCR on the scanned
    pages before embedding. Tesseract.js (v4, English fast model) is
    loaded on demand from jsDelivr CDN (~3 MB, one-time download,
    cached by the browser after first use). Each scanned page is
    rendered to canvas at 2× scale for accuracy, OCR'd, and the
    recovered text is merged back in before chunking. If OCR is
    declined, a residual ⚠️ warning remains in the embed confirm
    so the user knows context will be partial.

    Attach flow: the warning appears inline in the file preview hint
    bar so the user can see it before sending to chat.

  If Tesseract fails to load (network issue, blocked CDN), an error
  toast is shown and the file can still be embedded as-is.


- Streaming chat (major) — responses now render token-by-token in real
  time. Client sets payload.stream = true and reads SSE frames via
  response.body.getReader(); server proxies upstream SSE bytes straight
  through. Eliminates the long-message "upstream inactivity timeout"
  symptom. Stop button still works — abort closes the connection and
  the server kills the upstream so tokens stop burning.

- Markdown rendering — full GitHub-flavoured markdown via marked.js
  (12.0.2) + DOMPurify (3.0.9) loaded from cdnjs. Headings (h1-h4),
  blockquotes, tables, numbered lists, strikethrough, links, nested
  emphasis all render correctly. Copy button puts the raw markdown on
  the clipboard (read from data-raw on the bubble), so paste into
  Obsidian / Notion / VS Code preserves formatting. No regex fallback
  — LCL already requires network for PlatformAI.

- Custom-styled sliders (Max Tokens, Chunk Size, Top-K) — replaced the
  native accent-color rendering with an explicit gradient-fill track
  driven by a --fill CSS custom property. Left of the thumb is orange
  (filled), right is grey (unfilled), the thumb is a 14px circle that
  sits flush at both ends of the track. No more "still some space at
  max" gap. refreshSliderFill() updates --fill on every input event
  and when Settings opens.

- Embed vs attach UX split — the file preview panel is now used only
  when attaching a file's text to a chat message (paperclip in input
  bar). Header reads "Review text before sending in chat", button
  reads "Confirm & attach". Uploading a file to the Embed panel for
  RAG skips the preview entirely and shows a one-shot confirmation
  dialog with file name + size — users embedding a file want the
  whole thing chunked, not an editable preview.

- Max Tokens input widened — 56px → 84px, text right-aligned, fits the
  6-digit max value (131072) without clipping.

- Settings panel scroll affordance — orange 8px scrollbar (was 3px and
  effectively invisible), soft fade at the bottom edge of the modal so
  users see content continues below the fold. Works in both Chromium
  and Firefox.

- Rate-limit countdown + auto-retry — when the upstream returns 429
  with a "Limit resets at: ... UTC" timestamp, the client parses it,
  converts to the user's local timezone, and shows a live countdown
  bubble. Auto-retries 2 seconds past the reset time using the same
  payload. Cancel button bails out of the retry. The wait bubble is
  not pushed into chat.messages, so a successful retry simply renders
  the assistant response in its place. New messages or clicking Stop
  also cancel any pending retry.


Developer / build infrastructure (v0.67d, dev-side only)
--------------------------------------------------------

- index.html is now built from modular source files in src/. The
  shipped file is unchanged behaviourally — this is purely a
  maintenance refactor so future fixes can target one focused module
  instead of scrolling through a 3000-line monolith.

  Source layout (in LCL/src/):
    head.html      HTML head, CSS, body markup, opening <script>
    10-state.js    state vars, fetchWithRetry, setHealth, sleep
    15-rag.js      RAG engine — cosine, chunkText, hashText,
                   embedBatch, retrieveChunks, evictDocFromCache
    20-auth.js     init / persist / connect / disconnect
    30-chatlist.js       chat list (sort, new, switch, pin, delete,
                         rename) — the sidebar items
    40-files.js          embed panel, file parsing, OCR, preview,
                         embedDoc, attachments
    50-chatprocessing.js skills picker, send, runStream, auto-title,
                         rate-limit handler, regenerate, edit —
                         everything that happens inside an active chat
    60-search.js   search across chats
    70-render.js   render*, appendMsg, buildMsgEl
    80-ui.js       fmt, copyMsg, settings, skills manager, theme
    90-extras.js   drag-drop, easter egg
    tail.html      boot calls + closing tags

  Build:
    cd LCL && node build.js
    → regenerates index.html with anti-tamper banners at top and
       before each module section

  Each module section in the built index.html starts with a banner
  telling editors (humans + LLMs) to modify src/<filename>, not the
  generated file. The src/ folder is dev-only and is NOT shipped to
  users — users continue to install just index.html + server.txt.


Server (server.txt) — new in v0.67d
-----------------------------------

- Streaming proxy (callGccStreaming) — when payload.stream === true the
  upstream is opened with Accept: text/event-stream and bytes are
  piped to the client response. Rate-limit headers still captured and
  logged. Non-200 upstream responses are drained and returned as JSON
  so the client can show a clean error.

- Buffered chat path (callGccJson) retained for utility calls that
  explicitly set stream:false (auto-title, embed test, anywhere
  short / one-shot output is expected).

- Upstream timeouts raised — inactivity 30s → 90s, total budget per
  attempt 45s → 120s. Generous enough for Opus on long prompts,
  still short enough that genuinely dead sockets are detected and
  retried.

- Client-disconnect handling on streaming — res.on('close') kills the
  upstream request, so clicking Stop or closing the tab releases the
  upstream connection immediately.


Already in v0.67c (per PDF changelog) — listed here for reference
----------------------------------------------------------------

These shipped as part of the v0.67c patch and are documented on page
3 of the setup guide; do NOT re-list under v0.67d.

  - Embed pipeline fixed (RAG uses configured embed key + model;
    batch endpoint)
  - Test Embed Connection button works
  - Disconnect prompts before clearing saved keys
  - UI refresh (tinted palettes, glassy sidebar, Space Grotesk,
    secondary cyan accent, focus rings, refined radii)
  - Rate-limit awareness in server (header parsing, adaptive pacing)
  - Auto-title chats (first-exchange title)
  - Found a bug? button (sidebar) with crash log
  - Connection status indicator (chat + embed pill + dot)
  - Disconnect moved into Settings (Connection section)
  - Skills system (Ko Zheng Teng)
  - Binary embed cache + SSE progress (Melvin Yung) — server-side
    cache; SSE batch endpoint
  - Auto-connect on load
  - Embed tab (Files tab renamed; embed key + model banner)
  - Truncation warning
  - TLS connection retry
  - Max tokens raised to 8192 default (slider 32,768; input higher)
  - Credits added in footer and Settings panel


Upgrade impact (for the PDF Upgrade Guide step)
-----------------------------------------------

v0.67d changes both index.html and server.txt. Users must:

  1. Stop the Node.js server (Ctrl + C in the Node window)
  2. Replace index.html in the LCL folder
  3. Replace server.txt in the LCL folder
  4. Restart the server with the standard startup command
  5. Hard-refresh the browser tab (Ctrl + Shift + R) so the new
     index.html JavaScript is picked up (a plain refresh may not be
     enough since marked.js + DOMPurify are now required and cached
     pages need to load them)

Existing chat history, settings, embedded files, and skills in
lcl_data.json are not affected.


Files in this release
---------------------

User-facing (what ships):
  index.html   — generated artifact. SSE streaming consumer, markdown
                 renderer (marked + DOMPurify), custom sliders,
                 embed/attach UX split, wider Max Tokens input,
                 scroll affordance, rate-limit countdown + auto-retry
  server.txt   — streaming proxy (callGccStreaming), raised upstream
                 timeouts (90s / 120s), client-disconnect handling
  LCL_Setup_Guide.pdf — needs version banner restamp v0.67c → v0.67d
                 and a new changelog block listing the 7 UI features
                 + 4 server changes above

Dev-only (not shipped to users):
  build.js     — Node concatenator for the modular source
  src/         — 12 source files (head.html, 10 JS modules,
                 tail.html) that build.js assembles into index.html
  changelog.txt — this file
  index_pre_modular.bak — backup of the pre-modular index.html for
                 reference; safe to delete after v0.67d ships
