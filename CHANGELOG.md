# LCL Changelog — v0.67d

All notable changes to Local Comet LLM. Everything below is part of the v0.67d
release.

## 2 Jul 2026 — Log Mammoth DOCX warning details (alpha)

The docx extractor only reported a COUNT ("parsed with N Mammoth warning(s)") and discarded the messages. Now the full list goes to the browser console and the first 3 to the server log via a `docx_warnings` crumb (doc, count, messages) — typically unrecognised styles or skipped elements (text boxes, TOC fields, footnotes). Version stays v0.67d.

## 2 Jul 2026 — Fix: deleted chat's run leaked into the next chat (alpha)

Reported by CL: delete a chat while its docs are embedding / its split-summary is running, and the run keeps going — new summary bubbles append into whichever chat becomes active, and the deleted chat's docs keep embedding (spending shared budget). `deleteChat` now aborts the in-flight run when it belongs to the deleted chat (crumb `delete_chat abortedRun=true`) and sets `_cancelled` on its docs unless another chat still references them; `runSplitSummaries` also stops if its chat vanishes mid-run. Version stays v0.67d.

## 2 Jul 2026 — Pacing v2 review: truncation guard + usage-based inflation learning (alpha)

Self-review of pacing v2 found two gaps; both closed. Version stays v0.67d.

- **Mid-stream death no longer silently truncates**: if the upstream dies after streaming starts, the proxy's `{"error":…}` SSE frame (now also emitted on the raw socket-error path, not just inactivity timeout) is detected by `streamChatOnce` and returned as a transient failure → retried, instead of accepting a partial part-summary as complete and feeding it to the combine.
- **`infl` learns from real usage, both directions**: the ratchet problem — 429s only ever teach the ratio UP, so an HTML doc (~2.6x) would permanently slow later prose docs (~1.5x). The stream's terminal `usage` chunk is the true token count for every successful request; it now EMAs into `infl` (clamped 1.2–3.0), so pacing converges per doc type without needing a 429.

## 2 Jul 2026 — Pacing v2 from the 21:42 log: adaptive inflation, too-big fix, transient retry, persistent part-summaries (alpha)

The 21:42–21:54 capture showed pacing v1 working but inconsistent. Four fixes, all log-driven. Version stays v0.67d.

- **"Too big → split" misclassification fixed**: the test compared the gateway's `Remaining` to the RAW estimate, so a part rejected by a partially-drained window (est 53k vs Remaining 59k, real ~95k) was wrongly split to depth 2 — the "(part 1/5) (part 2/2)" mess. Too-big now only triggers when a **near-full** window (≥95% of limit) still rejects; anything else waits for the reset and retries.
- **Adaptive est→real inflation** (`_rlPace.infl`, starts 1.8, clamped 1.4–3.0): the fixed ×1.55 undershot badly on HTML docs (measured ~1.8–2.6× in this log), letting parts through the pace gate to a guaranteed 429. Every 429 body now re-teaches the ratio (window `used ÷ our est`), rejected requests are un-counted, and `perRequestTokenCap` uses the learned ratio so later parts are sized to fit a fresh window instead of probe-429ing.
- **Transient upstream failures retried during summaries**: the 21:47:29 request stalled 60s → inactivity 502 → the whole doc died with parts 3–5 never attempted. `summariseInto` now retries 5xx after a 4s pause (bounded by the attempt cap), with an "upstream hiccup, retrying…" note and a `summary_transient_retry` crumb. Also: after any countdown ends, the box switches to "resuming…" instead of freezing at 00:00.
- **Part summaries stay visible**: finished part-summaries used to be wiped by the next part's placeholder. `summariseText` now renders finished parts in a persistent area while the current part streams below; the final combine replaces the lot.
- **#3 note**: this log shows the event loop kept running during the perceived hang (timeout fired on time; the `undefined >` lines were Enter presses echoing in the REPL). Weakens the QuickEdit theory — the "hang" may just be a stalled upstream with a frozen-looking countdown, which the two fixes above now cover.

## 2 Jul 2026 — Rate-limit pacing: embed 429 survival, proactive part waits, embed-vs-summary gate (alpha)

Closes the shared-budget pacing item from the 19:41/20:11 log analysis. All 22 429s in that log were `Limit type: tokens` — the 20 req/min cap never fired — so no request-count gate was added (KIV until a `Limit type: requests` 429 is actually observed). Version stays v0.67d.

- **Embeds now survive 429s** (`server.txt` `handleEmbedBatch`): a batch that 429s waits out the window (using the 429 body's `Limit resets at` stamp, clamped 5–90s, max 4 waits) and retries, streaming `pacing` ticks so the doc card shows the countdown — instead of failing the whole doc after three 150ms retries (the 19:41 `embed_fail` on START). 429s are excluded from `callGccJson`'s fast transient retries for this path (`no429Retry`), saving 3 wasted requests per hit.
- **Proactive reset-wait between map-reduce parts** (`50-chatprocessing.js` `_rlPace`): the client tracks its own est-token spend per 62s window (est ×1.55 ≈ real) plus the reliable body fields of any 429 it does hit. A part that cannot fit in what's left of the window now waits for the reset BEFORE firing — the 20:11 run burned a guaranteed 429 + 61s wait on every part→part transition; those requests are no longer sent. New `rl_wait where=pace` crumb.
- **Summaries wait for active embeds** (`embedsActive`/`waitForEmbedsIdle`): a split-summary run pauses while any doc is `embedding`/`pending` (embeddings are the RAG prerequisite and share the budget), with a per-doc "Waiting for document embedding to finish…" note. New `summary_wait_embed` crumb. Stops the mutual starvation from the 19:41 log.
- **Rate-limit waits during summaries read as progress, not errors**: the countdown box during a multi-part run is now titled "Waiting for the rate-limit window" with "Summarising <doc> (part N/M) … resumes automatically" — the plain-chat 429 box is unchanged.
- **KIV: Retry-after-failed-embed REPL hang.** Code inspection found no async gap in `retryEmbed`→`embedDoc`; prime suspect is Windows console QuickEdit (a click in the console starts a selection, console writes block, Node's TTY writes stall the event loop until Enter/Esc). Next repro: check the console title bar for "Select" while hung; if confirmed, disable QuickEdit in the console properties.

## 2 Jul 2026 — Fix map-reduce runaway split (use 429 body Remaining) (alpha)

The adaptive split was cascading: a part that 429'd with `Remaining: 0` (budget just exhausted by the previous part) was misread as 'too big' and split down to 7k tokens before giving up — because it used the STALE client token meter (streams never refresh it) instead of the gateway's real figure. Now the too-big-vs-transient decision uses the **429 body's real-time Remaining** vs the request size: room available yet rejected → too big (split); Remaining ~0 → exhausted → wait for the window and retry. Retry cap raised 3→4. Version stays v0.67d.

## 2 Jul 2026 — Large-doc summaries: adaptive map-reduce + fast-fail (alpha)

Fixes the 7-minute retry loop where a whole-doc summary 429'd on every attempt despite a free budget (the char/4 token estimate undershot, so a >200k-token doc got sent whole). Version stays v0.67d.

- **Conservative split cap** (`perRequestTokenCap` clamped to ~110k est): big docs split into parts up front, leaving margin for estimate error.
- **Meter-based 'too big' detection**: on a 429, if the REAL remaining budget (from embed headers) is near-full yet the request was still rejected, it's the request that's too big — don't retry, split it. If the budget was consumed (embeddings), it's transient — wait + retry as before. (The 429 body's `Remaining` is templated/unreliable, so we use the meter.)
- **Adaptive recursive map-reduce**: a part that's still too big splits again (depth-guarded), so a genuinely large doc now completes as a combined summary instead of 'could not summarise'.
- **Retry cap lowered to 3** so nothing loops for minutes. New `map_reduce` crumb for visibility.

## 2 Jul 2026 — Cancel-embed, responsive Stop, + diagnostic crumbs (alpha)

Confident fixes from the logs, plus logging for the uncertain ones. Version stays v0.67d.

- **✕ now cancels an in-flight embed** (`15-rag.js` `embedBatch` `shouldAbort`, `40-files.js` `removeDoc`): removing a doc mid-embed sets a cancel flag checked between batches, so embedding stops (was: card gone but embedding continued, still spending budget).
- **Stop is responsive during a split**: the 1.2s inter-doc pacing is now an abortable sleep, and on Stop the run ends immediately with a '_Stopped._' note instead of pushing a 'could not summarise' bubble and continuing.
- **Split labelled by run count** via a `split_run docs=N` crumb.
- **Diagnostic crumbs added** (for the still-unconfirmed bugs): `embed_start/embed_done/embed_fail/embed_cancelled`, `retry_embed`, `remove_doc`, `rl_wait (where/secs)`, `split_stopped`, and `stop` now records `{inflight, pendingRetry, busy}`. These make the Retry-hang, Stop efficacy, and budget-wait behaviours visible in the next capture.

## 2 Jul 2026 — Fix: composer hidden for the whole embed (alpha)

Follow-up to the composer fix: `confirmFilePreview` restored the message box only after `await commitDocs()`, which doesn't return until ALL docs finish embedding (minutes for large files) — so a new chat that starts by embedding showed no message box the entire time. Now the composer/messages are restored IMMEDIATELY and embedding runs in the background (docs show as 'pending'), so you can chat while files embed. Version stays v0.67d.

## 2 Jul 2026 — Fix: composer vanishes if embed commit errors (alpha)

`confirmFilePreview` hid the message list + composer, ran `await commitDocs()`, then restored them — so if commit/embedding threw (e.g. during induced errors), the restore never ran and a new chat was left with no message box. Wrapped the commit in try/finally so the composer + messages always come back. Version stays v0.67d.

## 2 Jul 2026 — Local-timezone log timestamps (alpha)

Log line timestamps (console + `debug_logs.txt`) now use the machine's local time as ISO 8601 with the
UTC offset (e.g. `2026-07-02T08:29:36.477+08:00`) instead of UTC `…Z`, via a shared `_logStamp()`. Easier
to correlate with wall-clock. The gateway's own timestamps (`reset_at` in 429 bodies) stay as sent. Version stays v0.67d.

## 2 Jul 2026 — Fix false 'request too large' on shared-budget 429 + log consistency (alpha)

Version stays v0.67d.

- **Bug (from live logs): summaries failed instead of retrying.** The gateway's token 429 reports `Remaining: 200000` (== limit) even when concurrent embeddings have drained the per-minute budget, so a 185k-token request that actually fits was wrongly judged 'unwinnable' and given up on. Now 'too big' is judged by the REQUEST's own estimated tokens vs the stated limit (`limit429`), not the misleading Remaining field — a recoverable 429 waits and retries (both main chat and split-summary paths).
- **Console/file log parity** (`server.txt`): terminal output now carries the same `<iso> [level]` prefix as `debug_logs.txt` (one shared timestamp per call), so console and file read identically.
- **Quieter meter poll**: the once-a-second `[rl] /api/ratelimit read` line is de-duplicated — logged only when the snapshot changes.

## 2 Jul 2026 — Rate-limit retry fixes (alpha)

Two fixes to rate-limit handling during summaries. Version stays v0.67d.

- **Always retry a recoverable 429** (`src/50-chatprocessing.js`): both the main chat path and the split-summary path used to give up when a 429 carried no parseable reset time. They now auto-retry any non-unwinnable 429 with the parsed reset when present, else a default 60s backoff. Fixes a doc failing to summarise straight away when ongoing embeddings were briefly using the shared token budget.
- **Consistent rate-limit UI**: the split flow now shows the standard 'Error 429: Rate limit reached' countdown box (via `countdownWait`) instead of a custom '_Rate-limited - resuming_' line, and shows it during map-reduce parts too. Only a genuinely over-cap request (unwinnable) still stops without retry.

## 2 Jul 2026 — Whole-doc split + map-reduce summaries (alpha)

Turns the over-limit whole-doc summary from a dead-end into a completed job. Version stays v0.67d.

- When a whole-doc turn exceeds the token cap and the chat has ready docs, the guard now OFFERS to split it into one request per document (`offerDocSplit`) instead of only declining. Accepting runs them sequentially (`runSplitSummaries`), paced ~1.2s apart, each summary streamed as its own message; Stop aborts the rest.
- A single document that is itself over-cap is summarised map-reduce style (`summariseDoc`): split into cap-sized parts, summarise each, then combine the part-summaries into one — nothing dropped.
- A partial-budget 429 mid-run is waited out and retried; an unwinnable/terminal error skips just that doc with a note. New helpers `streamChatOnce`/`summariseInto`; `onToken` added to the build.js undefined-fn allowlist (callback param).

## 2 Jul 2026 — Stronger light-mode contrast (alpha)

First contrast pass was too soft in practice. Version stays v0.67d.

- Queued embedding cards no longer dim the whole card via `opacity` in light mode (washed out filename + metadata); the `pending` chip alone signals the queued state.
- Doc-panel metadata (size, chunk count, progress count) darkened to `#33405d` (~8:1).
- `pending` is now a solid amber chip (`#f4e0b6` / `#6f4a00`, ~6:1); pace label `#7a4f00` bold; progress fill `#9a6300` (≥3:1 vs track); slightly darker card border, icon tile, and track.
- Top-bar connection pill (beside Embed): warn/ok/err text darkened for light mode (`#8a5a00` / `#0b6e4f` / `#b3261e`, ~4.8–5.3:1; warn was `#f0a500` at 1.7:1), and the embed status dot darkened.

## 2 Jul 2026 — Fix oversized whole-doc 429 hang (alpha)

Root-caused via the new diagnostics: a whole-doc “summarise each” over 6 files built a ~497k-token
turn — 2.5× the 200k/min token cap — which 429s even with a full budget and then auto-retried
forever. Version stays v0.67d.

- **Chat pre-flight token guard** (`src/50-chatprocessing.js`): estimates the outgoing payload and
  blocks a turn that exceeds the model context window or the per-minute token cap, with an actionable
  message (switch Search mode / fewer docs) instead of firing a doomed request. Emits
  `[crumb] chat_blocked_oversize`.
- **Unwinnable-429 is terminal** (`src/12-transport.js`, `src/50-chatprocessing.js`): a 429 whose body
  reports Remaining ≥ limit (full budget yet rejected) means the request itself is over-cap — waiting
  can’t help. The client now shows a clear terminal error instead of the infinite “retry in 60s” loop.
  A partial-budget 429 (Remaining < limit) still auto-retries as before.
- **Demo simulation + tests** (`server.txt`, `test/demo-api.test.js`): the demo gateway now reproduces
  the real envelope — an over-cap chat (marker `[[toobig]]` or a genuinely >200k-token payload) returns
  a 429 with `retry-after`/`reset_at`/`rate_limit_type` headers and a full-budget body, WITHOUT burning
  the demo budget (matching the live gateway). New harness cases T25 (`[[toobig]]`) and T26 (oversize
  payload). Full suite 26/26.

## 2 Jul 2026 — Rate-limit diagnostics (alpha)

Better visibility into 429s / large whole-doc turns before behaviour fixes. Version stays v0.67d.

- **Non-200 error bodies logged in clear** (`server.txt`): HTTP != 200 responses are API error
  envelopes, not user content, so stream + buffered paths now log the body plainly (truncated via
  new `previewErr`) instead of the redacted byte-count. Surfaces a 429's limit type + any reset /
  Retry-After hint. 200-body redaction is unchanged.
- **Payload token estimate** (`server.txt`): each OUTBOUND/STREAMING log now prints `~N tokens (est)`
  alongside the byte count, so oversized whole-doc turns are obvious at a glance.
- **Client 429 breadcrumb** (`src/50-chatprocessing.js`): every non-200 chat response emits
  `[crumb] chat_error status=… kind=… reset=parsed|none`, showing whether a reset was parseable
  (and thus whether auto-retry fired or the request stalled on the static error box).

## 2 Jul 2026 — Light-mode contrast + batch embed dialog (alpha)

RAG/embeddings panel polish. Version stays v0.67d.

- **Light-mode contrast fixes** (`src/styles.css`): the amber/orange accents were reused from dark mode and failed WCAG AA on the near-white embeddings cards. Added light-scoped text-safe vars (`--ac-tx` #a8410a, `--pin-tx` #8a5a00, `--pin-bar` #b5760a) for the `.doc-st`/`.doc-prog-lbl` text and paced progress fill (pending pill and rate-limit label rise from ~1.7:1 to ~4.8:1). Queued-card dimming eased from `opacity:.55` to `.82` in light mode so the greyed cards stay legible. Dark mode unchanged.
- **Consolidated batch embed dialog** (`src/40-files.js`, `src/80-ui.js`, `src/15-rag.js`): dropping several files now shows ONE confirmation instead of a separate budget warning per file. New `confirmEmbedBatch` modal lists each file with size + estimated time (checkboxes, all selected by default; button reads “Embed all (N)” / “Embed selected (N)”, live total). `planDocEmbed` factors the chunk/estimate step out of `embedDoc` so the batch can be summarised up front; `commitDocs` gates once against the cumulative budget (more accurate than the old per-file check) and embeds selected files with each file’s own prompt suppressed. Time estimates (`embedSecs`/`embedWaitSecs`/`fmtEmbedDur`) derive from the shared per-minute token limit. Single-file retry path keeps the original `confirmEmbedBudget`.

## 2 Jul 2026 — Diagnostic logging upgrade (alpha)

Richer debug_logs.txt so alpha bug reports capture the chat path and the browser side, without ever persisting message content. Version stays v0.67d.

- **Stream response detail** (`server.txt`, `callGccStreaming`): the streaming chat path now logs full response headers (parity with the buffered path), the GovTech `x-models-call-id` correlation id, time-to-first-byte, total duration, SSE byte/event counts, and the terminal `finish_reason` + `usage` (prompt/completion/total tokens) parsed from the final SSE event. Counts only — the message text is never logged. Previously a chat turn logged just status + 'upstream end'.
- **Browser action breadcrumbs** (`src/10-state.js` helper `lclCrumb`, wired in `30-chatlist`, `40-files`, `50-chatprocessing`, `18-store`): key UI actions (send, stop, regenerate, new/switch/delete chat, attach files, save settings) tee to `/api/clientlog` at info level as `[crumb] …` lines — event name + safe metadata (model, char/byte sizes, ids) only, no message content. Local only; no remote telemetry. Complements the existing console.error/warn + uncaught-error capture.
- **Chunk-noise reduction** (`server.txt`, buffered path): per-chunk `chunk bytes = …` lines (dozens per embed batch) are off by default and collapsed into a one-line `response body | N chunks | M bytes` summary. Set `LCL_LOG_CHUNKS=1` to restore per-chunk lines.

## 1 Jul 2026 — v0.67e RAG integration (alpha)

Integration of a contributor's v0.67e RAG rebuild onto alpha, merged module-by-module
(kept all alpha features — compact rail, embed progress/Retry, budget gate, copy
sanitiser). Version stays v0.67d.

- **Hybrid retrieval** (`15-rag.js`, adopted from v0.67e): MiniSearch keyword recall +
  vector recall, RRF fusion, heuristic reranking, neighbour/section expansion, optional
  "retrieve more" round. New CDN dep MiniSearch 7.2.0. Alpha's `ragStickyChunks` kept.
- **Query-aware full-text injection with dynamic scaling** (item 2): budget scales to the
  model's context window (`getModelContext`, new per-model table in `05-models.js`),
  clamped to a 250k-char ceiling / 40k floor, 10k fallback for unknown/custom models.
  No user knob.
- **Shared RAG memory** (item 3): "Search past embeddings" toggle searches prior chats'
  docs (`getRagMemoryDocs`); cross-tier mixing is a documented user-responsibility risk.
- **Evidence-scored sources** (item 4): `displayedSourceNames` on the hybrid path with a
  fallback to all retrieved docs so genuine citations are never hidden.
- **Top-K constrained 3–10** (item 5, default 5, `clampTopK`).
- **Richer chunk/doc metadata** (item 6): sections, heading paths, page ranges, char
  offsets, aliases, section-family expansion. No migration — docs embedded in the old
  format are re-embedded (surface via the existing error path).
- **Structured DOCX/XLSX/PPTX extraction** (item 7) carried into chunking; alpha's
  `_default` binary-sniff + no-allowlist policy preserved.
- **Embed pipeline** (item 8): robust `embedBatch`/`embedDoc` (JSON+SSE, validation,
  request splitting, clearer errors, structured records, hash reuse) merged with alpha's
  progress bar, `retryEmbed`, and budget gate. Chunk size clamped to the embed model's
  max input (`getEmbedMaxTokens`, e.g. Cohere v3 = 512 tokens).
- **Delete-chat pruning** (item 9): confirm dialog (reuses `confirmDialog`) + embed-cache
  GC + "Deleted chat and pruned embeddings" toast.
- **pdf.js 3.11.174 → 5.7.284 (ESM)** via jsDelivr — fixes CVE-2024-4367 (code injection).
  Loader refactored to an ES module exposing `window.pdfjsLib`; worker points at the v5
  `.mjs`. Verified loading on Edge 149.
- **server.txt: full sensitive-payload redaction.** `logSensitive` now redacts on the
  live console too (byte count + short sha256), not just the on-disk log — prompts/
  responses (incl. RESTRICTED material) are never shown on the terminal or persisted.
- **Bug fix:** declared `ragKeywordIndexCache` (`10-state.js`) — it was referenced by the
  merged RAG code but its declaration wasn't ported, silently degrading hybrid retrieval
  to vector-only (keyword recall threw and was swallowed).
- **Cleanup:** removed dead functions (`chunkText`, `countSubstringHits`,
  `evictDocFromCache`, `previewText`); relocated `clampTopK` to `05-models.js`.
- **Tests:** added `test/fixtures/` (PDF/DOCX/PPTX/XLSX + `make_fixtures.py` generator)
  and a real-file extraction checklist (U19–U24) in `test/UI_CHECKS.md`. Build 5/5 +
  24/24 demo-api green; `#demo` UI verified. Model context/pricing catalogue added incl.
  new embed model `gemini-embedding-2`.
- **Follow-up fixes (from alpha real-file testing):**
  - Embed-failed toast no longer double-prefixes "Embed failed:" (`embedBatch` throws
    the raw message; `embedDoc` adds the prefix once).
  - Client embed batching caps each POST at ~600k chars (~150k tokens) so large docs
    stay under the server's 180k-token hard cap and pace across the rate-limit window
    instead of failing with a 413 "token cap" error.
  - Atomic save (`saveData`/`saveEmbedCache`) is now OneDrive/AV-resilient: retries the
    rename on EPERM/EBUSY/EACCES, then falls back to a direct write — fixes silently
    lost saves in OneDrive-synced folders.
  - Client-side debug logging: browser console errors/warnings + uncaught errors POST
    to `/api/clientlog` and tee into `debug_logs.txt` on the alpha channel.
  - Retrieval never returns empty context when docs are embedded: `buildPayload` falls
    back to all ready docs (budget-clamped) when the query matches none lexically, and
    `retrieveRagChunks` falls back to top-scoring candidates when nothing clears the
    relevance bar — fixes a general/paraphrased first question getting no doc grounding.
  - `/api/embed-lookup` calls now batch at <=1000 hashes (was one POST) so vector
    hydration works on large/shared corpora (>1500 chunks) instead of 400-ing.
  - "Search past embeddings" now defaults OFF; multi-file drop shows all files queued
    (greyed) at once; duplicate files (same name+size) are skipped; long filenames
    scroll on hover; "RAG" in the embed panel has a plain-English hover tooltip; the
    drop overlay reads "embed" vs "attach" by context.

## 1 Jul 2026

- **Compact rail footer (UI refresh).** The sidebar footer is reorganised into a
  single compact icon rail under the active-skill picker: **Skills · Search ·
  Theme · Settings** as four 28px buttons (icons fixed at 15px). Search and the
  theme toggle are **removed from the top bar** (which now shows only the
  connection pill and Embed), consolidating the global controls in one place.
- **New glyphs.** Skills uses a wand; Settings uses a filled Material gear; the
  theme toggle uses a defined sun (disc + 8 rays) in light mode and a crescent
  moon in dark mode.
- **Skills button reflects active state.** The wand is highlighted orange only
  when a skill is selected for the chat (mirroring the picker's active state) and
  is neutral grey when the skill is None (`syncSkillRail`).
- Collapsed sidebar stacks the rail vertically; tooltips carry the labels.

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
