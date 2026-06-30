# LCL Changelog — v0.67d

All notable changes to Local Comet LLM. Everything below is part of the v0.67d
release.

## 30 Jun 2026

- **Alpha file logging (`debug_logs.txt`).** When the update channel is `alpha`,
  all server console output is mirrored to `LCL/debug_logs.txt` (console output
  unchanged; stable writes nothing). Implemented as a tee over `console.log` /
  `console.warn` / `console.error`, gated dynamically on `readChannel()` so
  toggling the channel starts/stops file logging without a restart, with ~5 MB
  rotation to a single `debug_logs.1.txt` backup and ANSI codes stripped.
  Request/response payloads are redacted in the file to a byte count + short
  `sha256` (via `logSensitive`); the full preview still prints to the in-memory
  console only, so prompt/response content is never persisted to disk. Other
  lines inherit the existing `maskSecret` masking.
- **Token-meter diagnostics.** Both upstream paths now log which `x-ratelimit-*`
  headers a response actually carried (or `NONE`), tagged `[stream]` /
  `[api chat|embed]`, plus an explicit "rate-limit ABSENT" line — to pin down why
  the meter refreshes on embeds but not on streamed chats. `setLastRateLimit`
  logs each snapshot write; `GET /api/ratelimit` logs which key prefixes it
  queried and whether a snapshot was found.
- **Rate-limit snapshot key fallback fixed.** `GET /api/ratelimit` fell back on
  the key *string* (`apiKey || embedApiKey`), so an embed-only snapshot was
  invisible whenever a chat key was set. It now falls back on the lookup *result*
  (`getLastRateLimit(apiKey) || getLastRateLimit(embedApiKey)`).
- **Sidebar token meter removed.** The upstream gateway omits the `x-ratelimit-*`
  headers on streamed chats (confirmed in the logs), so the meter could only ever
  move on embeds and was blind to chat burn — misleading, and it drove a constant
  10s `/api/ratelimit` poll. The widget, `renderBudget`/`startBudgetMeter`, and the
  poll are gone. The rate-limit **snapshot and `/api/ratelimit` stay** (still used
  by the embed gate, the server hard cap, and embed pacing); it's now fetched
  on-demand via `refreshBudget()` before an embed and refreshed after one.
- **Embed budget gate reworked — warn only when it won't fit.** The old gate warned
  at a fixed ~10% of the per-minute limit (~20k tokens), so normal documents tripped
  it. It now warns only when the estimate (plus recent embeds in the last 60s) won't
  fit in the tokens left this minute, exceeds the hard cap, or an explicit Settings
  "warn above" override. The hard cap (client + server `resolveEmbedHardCap`) is
  raised from 50% → ~90% of the limit (180k fallback).
- **Canceling an embed no longer leaves a stuck file.** Declining the budget warning
  for a freshly-added file now removes it from the chat instead of stranding it as a
  permanent "pending" card. (A file with chunks from a previous embed is kept.)
- **Footer settings control redesigned.** With the meter gone the settings row was
  a lone floating cog; it's now a full-width **Settings** button (gear + label) that
  mirrors the skill dropdown above it, so the two footer rows read as paired
  controls. Collapses to a centered gear icon when the sidebar is collapsed. Dead
  `.budget-meter` / `.bm-*` CSS removed.
- **Removing a file is now instant.** Clicking ✕ on a doc dropped the card only
  after two server round-trips (`persist` + cache GC) finished, so it lagged. The
  card now disappears immediately (optimistic UI) and the persistence + vector
  prune run in the background.
- **Copy no longer pastes a coloured highlight.** Native Ctrl+C / right-click Copy
  of chat text used to bleed a red/orange background into Teams, Outlook, and Word,
  because the browser inlined the dark theme's colours and the `::selection` wash
  into the clipboard HTML. A `copy` listener scoped to `#messages` now rebuilds the
  clipboard from the selection's own DOM and strips inline background/colour, so
  paste keeps bold/italics/links/lists/tables but no background. Copying from
  inputs and the Copy / Copy-for-Word buttons is unaffected.

## 25 Jun 2026

- **Embedding listener leak fixed (`MaxListenersExceededWarning`).** The buffered
  upstream call (`callGccJsonOnce`) re-attached `secureConnect`/`error` listeners
  to pooled keep-alive sockets on every request, so embedding many files at once
  piled up >10 error listeners on a reused `TLSSocket`. Listeners are now wired
  exactly once per socket (`socket._lclWired` guard); `secureConnect` doesn't
  re-fire on a reused socket, so nothing is missed.
- **Fewer `ECONNRESET` retries behind Zscaler.** `upstreamAgent.keepAliveMsecs`
  lowered 30s -> 10s so idle sockets are retired before the gateway/Zscaler
  silently closes them, cutting the "reuse a dead socket" resets. (The 503s and
  resets were already transparently retried; the `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`
  log line is expected behind Zscaler, not a failure.)
- **Clearer TLS log.** The boot/secureConnect log now reads `TLS connected
  (Zscaler-intercepted, trusted)` (or `chain trusted`) instead of a bare
  `authorized = false`, so a normal intercepted handshake no longer looks like an
  error in the console.
- **Embed token-budget guardrails (Phase 2).** Before embedding, the client estimates
  the cost (~4 chars/token over the cache-miss chunks) plus recent embeds in the last
  60s, and if it crosses the soft cap shows a confirm dialog (chunk/token estimate +
  remaining-this-minute) — Cancel aborts with nothing sent. Caps adapt to the live
  per-minute limit (soft ~10%, hard ~50%) or use Settings overrides ("Warn above" /
  "Block above" tokens, blank = auto). Server backstop: `handleEmbedBatch` refuses an
  embed estimated over the hard cap with HTTP 413 (`resolveEmbedHardCap`). New tests
  T23/T24; gate verified live in #demo.
- **Skills footer polish.** Row renamed **Skills**; books (library) icon on the left,
  selector on the right (mirrors the settings row); empty option is now "None"; the
  Settings cog is a clean outline gear; a thin divider separates Skills from LCL settings.
- **Sidebar footer restructured.** The scrolling Skills list and the two big
  Settings/Skills buttons are replaced by a compact two-row footer under a divider:
  row 1 **Skill** — a single-select dropdown (per-chat `chat.skillId`, orange-tinted
  when active, "No skill" clears it) + a manage-skills icon button; row 2 **LCL
  settings · token usage /min** — a Settings gear icon + the token meter. Skill
  model unchanged (one per chat); `renderSkillPicker` now fills the `<select>` and
  `onSkillSelect` sets the active skill. Collapsed sidebar stacks the two icon buttons.
- **Token budget meter (sidebar, Phase 1).** A "Token budget /min" meter sits below
  Skills / above Settings showing the overall PlatformAI token budget for the active
  key (chat + embed share it), from a new `GET /api/ratelimit` (live rate-limit
  snapshot in real mode; a demo burn-down in #demo so it visibly moves). Bar uses the
  brand ramp — orange >50%, amber >20%, red <20% (synced with the embed bar / accent,
  no green) — de-carded soft surface, left-anchored tooltip. Shared `estTokens`
  (~4 chars/token) added server-side; new test T23. Degrades to "no data yet" on a
  server without the endpoint.
- **Demo mode updated for the new embed UI.** `#demo`'s `/api/embed-batch`
  (`demoServeEmbedBatch`) now streams simulated per-batch `progress` (+ one
  `pacing` tick) for multi-batch inputs so the new progress bar actually advances
  offline; small batches still answer instantly (JSON). A `[[embedfail]]` marker
  in a doc's text makes the demo embed fail once then succeed on retry (mirrors the
  chat `[[401]]/[[429]]/[[500]]` markers), so the error-pill + Retry path is
  demo-drivable. The seeded `policy-handbook.docx` / `scanned-invoice.pdf` docs got
  real content (+ an error message) so Retry resumes to `ready` with chunks. New
  regression cases T21 (streamed progress) + T22 (`[[embedfail]]` retry); 22/22 green.
- **Embed progress bar + retry.** The document panel now shows a live per-file
  progress bar (batch x/y, chunks done/total) driven by the existing embed SSE
  events instead of transient toasts, with a distinct amber rate-limit "resuming
  in Ns" state. A failed embed shows an error pill plus a **Retry** button
  (`retryEmbed`) that resumes from where it stopped (already-embedded chunks are
  skipped).

## 24 Jun 2026

- **Re-uploading the same filename to a chat's documents no longer hangs.** The
  document upload `<input>` had no `id`, and after an upload the code cleared the
  *attach* input (`file-in`) instead. The docs input's value was never reset, so
  selecting the **same filename** again (e.g. after removing and re-adding it) did
  not fire a `change` event and the upload silently did nothing. The docs input is
  now `id="doc-file-in"` and is the one cleared after each upload.

## 23 Jun 2026

- **Rename syncs the top title.** Renaming a chat in the sidebar now also updates
  the title shown under the top header (`finishRename` re-renders the topbar, not
  just the chat list).
- **HTML and other text files are selectable again.** The file pickers no longer
  carry an `accept` allowlist that greyed out `.html` and similar files. The
  extractor has no allowlist: PDF/DOCX/PPTX/XLSX use dedicated extractors and
  every other file is read as UTF-8 text, rejected only if it sniffs as binary.
- **build.js** no longer packages a `LCL.zip` (the `checksums.txt` writer is
  kept); README cleaned up accordingly.
- **Setup guide** refreshed: author/contributors, a new "Updating LCL" section,
  and screenshots for the Embedding and Skills features.

## 22 Jun 2026

- **PowerPoint support.** A `.pptx` extractor (slide text + speaker notes) was
  added. The upload allowlist was replaced with a permissive policy: any
  text-based file (code, config, logs, `.env`, no-extension files) is read as
  text; only genuinely binary files are skipped, with a clear message.
- **Embedding-key validation.** Saving a new or changed embedding key runs an
  immediate check and reports success or the exact failure, instead of silently
  failing on the first embed.
- **Source consolidation.** `src/` consolidated to 17 JS modules; the built
  `index.html` is behaviour-identical.
- **Internal refactors.** Message actions (Copy / Copy-for-Word / Edit /
  Regenerate) run through one delegated listener; a single transport seam owns
  the chat POST and error classification (rate-limit / transient / terminal); the
  persistence layer is a serialized write queue with a `mutate()` helper and a
  schema-version stamp.
- **Tests.** A server regression suite (`test/demo-api.test.js`) plus a browser
  checklist (`test/UI_CHECKS.md`).

## 20–21 Jun 2026

- **Automatic updates.** A footer version badge and a **Settings → Updates** card.
  LCL checks GitHub releases for a newer version and applies on consent: each file
  is downloaded to a temp copy and verified against `checksums.txt` (SHA-256)
  before an atomic swap. An `index.html` change reloads the page; a `server.txt`
  change restarts Node automatically where the machine allows it, otherwise the
  Node window shows a clear, boxed notice with the exact restart steps.
- **Works behind Zscaler.** Update fetches and the PlatformAI chat/embed calls now
  trust a Zscaler-intercepted certificate chain (accepted only when the chain is
  Zscaler's and the sole failure is an unknown issuer). Fixes
  `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` for both updates and normal use.
- **Tabbed, card-based Settings.** Models / Settings tabs, a gear icon, an X
  button and Esc-to-close. Max Tokens uses preset chips (1K–32K) plus a custom
  field; the RAG sliders have editable, slider-synced value fields.
- **Data-classification picker.** Choose R/SN or CCE/SN and the chat and embedding
  model lists filter to that tier; the tier is shown after the model name, e.g.
  `cce.claude-opus-4-6 (CCE/SN)`.
- **Models.** Provider-grouped chat/embed dropdowns (Claude / OpenAI / Gemini)
  with a Custom fallback; Gemini embed batch limit corrected; a document's vectors
  are garbage-collected from `embed_cache.bin` when it is removed.
- **Quieter error handling.** Any 5xx now auto-retries with a countdown
  (10s → 20s → 60s); 429 honours the quota reset; raw upstream error pages no
  longer leak into the chat.
- **Server hardening.** `serveStatic` denylist (`lcl_data.json`, `embed_cache.bin`,
  `*.stable`, dotfiles); atomic writes for `lcl_data.json` and `embed_cache.bin`;
  a route table replaces the dispatch if-ladder; a leveled logger gated by
  `LCL_LOG_LEVEL`; REPL-aware Ctrl+C and restart.
- **Internals.** A central `CFG` constants module; data-driven registries for file
  extractors and model tiers; shared helpers for the status/retry panels, DOM
  building, and the request payload; one client↔server transport seam and one
  persistence seam. `index.html` is served `no-store` so an applied update loads
  without a hard refresh.
- **UI polish.** Warm theme refresh; accent-orange scrollbars; tighter message
  spacing with Copy/Edit sitting under each reply; neutral, theme-aware code
  blocks; sidebar with Settings and Manage Skills side by side; first-run example
  hint cards.

## 19 Jun 2026

- **Embedding-cache cleanup.** Removing an embedded document garbage-collects its
  vectors from `embed_cache.bin` (`/api/embed-gc` keeps only vectors still
  referenced by a saved doc and never drops a vector another doc shares); a startup
  sweep prunes orphans left by older builds.

## 18 Jun 2026

- **Full-document RAG.** A document that fits the model's context window is sent in
  full instead of a handful of retrieved chunks (`creds.docFullTextLimit`, default
  200000 chars). Larger files fall back to chunk retrieval. No re-embed needed.
- **Smarter OCR prompt.** OCR is offered only when a PDF has both ≥2 empty-text
  pages and ≥15% of pages empty, so a stray blank page no longer prompts it.
- **Embedding rate-limit pacing.** The server paces embed batches against the
  per-minute window and streams a countdown ("resuming in ~Ns") instead of failing
  partway; the health pill shows progress so embedding never looks frozen.
- **Embedding settings.** Embed API Key + Embed Model are editable any time;
  per-model batch/size caps; auth standardised to the `x-api-key` header.
- **Copy for Word / Outlook** keeps visible table grid lines.
- **UI / sidebar.** Collapsible icon rail (persisted); tighter message spacing; the
  stray chat-list "grey bar" removed.
- **Build.** `build.js` hardened into a real verification gate (per-module and
  full-bundle syntax checks, undefined-function scan, size/banner floors).

## 17 Jun 2026 — v0.67d base

- **Streaming chat** renders token-by-token over SSE; Stop aborts and releases the
  upstream immediately.
- **Markdown rendering** (marked + DOMPurify); a Copy button (raw markdown) and
  **Copy for Word / Outlook** (formatted HTML — headings, tables, bold preserved).
- **Scanned-PDF detection** with optional on-demand OCR (Tesseract.js, lazy-loaded).
- **Hash-based embed pipeline**; a binary Float16 embed cache that persists across
  restarts.
- **Reliability.** Rate-limit countdown + auto-retry; 5xx auto-retry; raised
  upstream timeouts; client-disconnect handling on streaming.
- **Path-traversal fix** in `serveStatic` (prefix check, 403 on traversal).
- **Dev infrastructure.** Modular `src/` assembled by `build.js`, which writes
  `checksums.txt` for the shipped files on every build.
- Also: custom sliders, wider Max Tokens input, embed/attach UX split, Settings
  scroll affordance, auto-connect on load.

## Upgrading

v0.67d ships both `index.html` and `server.txt`. To update manually: stop Node
(Ctrl+C), replace both files in the LCL folder, restart Node with the usual
startup command, then hard-refresh the browser (Ctrl+Shift+R). Existing chat
history, settings, embedded files and skills in `lcl_data.json` are not affected.

## Files in this release

- **index.html** — the whole app (HTML + CSS + JS), generated from `src/` by
  `build.js`.
- **server.txt** — the zero-dependency Node proxy.
- **checksums.txt** — SHA-256 of the shipped files, used by the in-app updater to
  verify a download before applying it.
