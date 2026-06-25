# LCL Changelog — v0.67d

All notable changes to Local Comet LLM. Everything below is part of the v0.67d
release.

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
