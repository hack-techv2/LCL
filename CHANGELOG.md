# LCL Changelog — v0.67d

All notable changes to Local Comet LLM. Everything below is part of the v0.67d
release.

## 8 Jul 2026 — OCR that actually works: reachable engine, image OCR, status chip (alpha)

CL's scanned PDFs never OCR'd. Root cause: tesseract.js defaults its language data to `tessdata.projectnaptha.com`, which the gov proxy blocks (worker + core already default to jsDelivr, so they were fine). Also OCR only ran on scanned PDF *pages*, not image uploads, and there was no way to see or manage the engine.

- **Reachable engine:** `createWorker` now overrides only `langPath` -> `https://cdn.jsdelivr.net/gh/naptha/tessdata@gh-pages/4.0.0` (the SAME language data, mirrored on the already-working jsDelivr CDN). A single PERSISTENT worker is created and reused (was create + terminate per file), with `cacheMethod:'none'` so it never touches IndexedDB — gov Edge "tracking prevention" blocks storage access for the CDN worker (surfaces as an opaque `Script error. 0:0` that broke OCR mid-run), so the language data loads into memory once per session instead of caching. Also: the worker is created and then explicitly `loadLanguage('eng')` + `initialize('eng',1)` — this Tesseract build's one-shot `createWorker('eng',…)` form does NOT initialise the core, so recognize threw `Cannot read properties of null (reading 'SetImageFile')` and OCR never actually ran. Verified end-to-end in-browser (recognises real text now). Follow-up: `langPath` must be passed in createWorker's FIRST-arg options object (`createWorker({ langPath, cacheMethod:'none' })`) - passing it as a later arg was ignored, so it fell back to the default tessdata host which the gov proxy serves without CORS (`No 'Access-Control-Allow-Origin'`); confirmed the traineddata now loads from jsDelivr.

## 9 Jul 2026 - OCR clarity: client-side note, drop redundant status, honest health pill (alpha)

Three small OCR-UX fixes. (1) The OCR popover now states everything runs **locally in your browser** - nothing is uploaded to extract the text - **and you can keep using LCL while OCR runs**. (2) When the engine toggle is green (On), the redundant "Ready" status line is gone; the green "On" already says it (kept for idle/downloading/blocked). (3) The health pill only shows **"+ OCR"** when the engine is actually on - previously it always advertised OCR even when the toggle was off. The pill now refreshes the moment OCR is toggled (only while idle-connected, so it never clobbers a Reading/Embedding status). Test **C39** guards all three. Build 5/5, client-logic 37/37.

## 9 Jul 2026 - Same OCR prompt for upload and embed (alpha)

Upload (attach) and embed now show the **identical** scanned-file dialog. Previously the attach preview showed a scanned PDF as just `=== Page 1 ===` markers with no OCR affordance - OCR only fired on "Confirm & attach", so users saw an empty preview and removed the file (thinking it was broken) before ever reaching the prompt (confirmed from a field log: `attach_files` -> `attach_preview_remove`, no confirm in between). Now, the moment a scanned file finishes extracting in the attach preview, the **same** 3-way dialog embed uses appears - **Run OCR + attach / Attach without OCR / Cancel** - so the choice is up-front, not hidden behind Confirm. Choosing Run OCR fills the preview text in place; the confirm-time prompt is gone. Test **C38** guards that embed and attach share the modal with no banner. Suites 40/40 + 36/36, build 5/5. Verified live (normal mode, real 6.4 MB scanned PDF): dialog appears on extraction, Run OCR fills the text (116 -> 1925 chars).

## 9 Jul 2026 - OCR fixes: image OCR in attach/embed + green/grey toggle switch (alpha)

- **Image OCR now triggers** in both attach and embed. The preview-record builders dropped `ocrFile` (only `pdfDoc` was carried onto records), so scanned images never matched the `scanWarning && (pdfDoc || ocrFile)` check - scanned PDFs OCR'd, images silently didn't. Now `ocrFile` rides onto the record (destructure + progressive `Object.assign` + docs `push`). Verified live: attaching an image now shows the "Scanned files detected" dialog.
- **OCR engine toggle is now a green/grey switch** (On / Off, no "Ready" wording) in the chip popover, replacing the Enable/Disable text button; same `toggleOcrEngine()`. Verified live: Off/grey at idle, On/green once loaded.
- Test **C36** also asserts `ocrFile` is carried through all three record sites. Suites 40/40 + 36/36, build 5/5.

## 9 Jul 2026 - OCR UX: attach-flow OCR, 3-way dialog, one-button toggle, chip progress (alpha)

- **OCR on file upload (attach), not just embed:** the attach preview's Confirm now offers OCR for scanned files, same as the embed flow (previously attach never OCR'd, so an attached scan carried no text).
- **3-way OCR dialog** (new themed `confirmDialog3`): **Run OCR + embed/attach** / **Embed (Attach) without OCR** / **Cancel** (a real abort) - replaces the native OK/Cancel where "Cancel" ambiguously meant "embed without OCR".
- **One OCR toggle** in the chip popover - `Enable OCR` / `Disable OCR` / `Enabling…` (state-aware `toggleOcrEngine()`) - replacing the separate Enable + Clear buttons.
- **Live OCR progress on the chip:** while OCR runs, the dot pulses amber and the chip reads `OCR 3/19` (in addition to the health pill), clearing when done.
- Tests **C37** (toggle) + **C38** (3-way dialog + progress + attach wiring). Suites 40/40 + 36/36, build 5/5. Verified live in #demo.

## 9 Jul 2026 - Streamlined upload / OCR / embed messages (alpha)

Cut the toast noise in the file flow: dropped the per-OCR-page toast (a 19-page scan spammed 19 toasts) and the per-file embed start/done toasts in favour of the health-pill progress plus one summary each (`OCR done - read N file(s)`, `Embedded N file(s), M chunks`). Standardised the extraction verb to "Reading", simplified + de-staled the OCR prompt, and reworded the empty-scan case to `<file> embedded - no text found`. Per-file doc-panel status rows are unchanged. A 19-page scan now shows ~4 messages instead of ~40. Suites 40/40 + 35/35, build 5/5.
- **Image OCR:** png/jpg/jpeg/webp/bmp/gif/tif/tiff now extract via the same OCR path (`imageExtractor` hands the file to `ocrQueueItem`, which runs `worker.recognize(file)`); the embed OCR confirm now covers scanned PDFs AND images.
- **OCR status chip** beside Embed in the top bar, with a state dot: idle / downloading / ready (green) / blocked (red). Clicking it opens a popover with the current state, **Enable engine** (forces the download so a block surfaces up front) and **Clear engine** (terminates the worker + drops the cached engine/language data so it re-downloads fresh). Driven by `ocrState()` / `renderOcrChip()` / `toggleOcrInfo()`. The connected health pill now reads "Chat + OCR + embed" (OCR is always available; embed appears when an embedding key is set).
- Tests **C35** (langPath off projectnaptha + persistent worker), **C36** (image extractors + filter + recognize), **C37** (chip + popover wired). Suites **40/40 (demo-api) + 35/35 (client-logic)**, build 5/5. Verified live in Chrome (`#demo`): chip renders beside Embed, Test engine downloaded from jsDelivr and went "ready", Clear engine reset to idle. Client-only change (index.html); **server.txt unchanged**.

## 8 Jul 2026 — Clearer embed error when the gateway/proxy returns a 503 HTML page (alpha)

From CL's field log: a scanned-PDF embed failed with 14× HTTP 503 from the corporate proxy (Squid/Zscaler, *"The requested URL could not be retrieved"*), surfaced to the user as the cryptic `embed_fail … Non-JSON response: <!DOCTYPE HTML…`. The 503 was a transient gateway outage — a later retry embedded fine and chat worked throughout — but the message was unreadable.

- `server.txt` now maps a non-JSON / 5xx / proxy-HTML response from the embeddings endpoint to a plain message via a new `gatewayErrorMessage()` helper used across the three `callStandardBatchEmbed` throws (empty body / non-JSON / 4xx+): *"The embeddings endpoint is temporarily unavailable (HTTP 503) - the network proxy could not reach it. This is usually transient - please try again in a moment."* Genuine JSON API errors (e.g. a 4xx with a JSON body) are unchanged — the helper returns null and the caller keeps its own message.
- Test **C34** (extracts `gatewayErrorMessage` from server.txt, runs it in a vm): a 503 Squid HTML page → friendly message with no raw HTML; a JSON 400 → null. Suites **40/40 (demo-api) + 32/32 (client-logic)**, build 5/5. **server.txt CHANGED — restart node to pick it up.**

## 7 Jul 2026 — Fix: Connect fails when index.html is opened as a local file (alpha)

When LCL is opened directly (double-clicked `file://`) instead of via the proxy at localhost:3000, **Connect** errored even though chat messages worked. Cause: the Connect validation ping used `fetchWithRetry('/api/chat', …)` with a RAW relative path, which resolves to `file:///api/chat` and fails — chat messages already route through `httpPost` → `proxyUrl`, but this one call didn't. Fixed by wrapping the ping in `proxyUrl('/api/chat')` so it hits the proxy origin (`http://127.0.0.1:3000`) like every other call.

- Audited **all** network call sites: connect was the ONLY unrouted one. The other seven (`httpGet`/`httpPost`/`httpPut`/`httpDelete` in transport, `loadEndpointInfo`, and the two `clientlog` fetches) already route through `proxyUrl`; no `EventSource`/`XMLHttpRequest`/`sendBeacon`/`WebSocket`/`location.origin` URL building anywhere.
- Test **C33** guards it (source-level: connect uses `proxyUrl('/api/chat')`, no raw `fetchWithRetry('/api/chat'`); C19 already covers the proxyUrl shim mapping. Client-only change (`src/20-auth.js`); **server.txt unchanged**. Suites **40/40 (demo-api) + 31/31 (client-logic)**, build 5/5.

## 7 Jul 2026 — Removed the Developer endpoint section; kept the gateway picker (alpha)

Per CL: bundling the Developer + Connection endpoint config together didn't work out with the latest build, so the Developer endpoint feature is removed and LCL keeps just the gateway picker (the initial mode). Version stays v0.67d.

- **Removed** Settings → System → Developer entirely: the nav item, the API-endpoint selector, the Custom endpoint fields (Name / Model URL / Embeddings URL / Model), and the per-endpoint API/Embed key fields. Client functions `renderEndpointSection` / `endpointSelChanged` / `endpointSummaryHtml` / `devSectionVisible` / `refreshDevSection` / `saveEndpointFromSP` and the `devVault` key store are gone; `keyStoreFor()` now always resolves to the single per-gateway `gwVault`. Dead `#s-ep-*` CSS removed.
- **Kept** the gateway picker (Settings → Connection + the Connect modal): PlatformAI | NC3 (Dev), per-gateway keys in `gwVault`, the Embedding source banner, and the `endpointBadge()` health-pill suffix. `lclEndpoint` / `loadEndpointInfo` stay — opening Settings now reloads them just to refresh the gateway segment.
- **Server unchanged**: `/api/endpoint` + the two presets and the `*.gov.sg` https-only allowlist remain (the gateway picker rides them), so no node restart is needed for this change.
- **Tests**: removed client-logic **C30** (developer endpoint UI) and **C32** (`devVault` key pairs); gateway coverage **C31** stays. Server `/api/endpoint` tests **T36–T40** unchanged. Suites **40/40 (demo-api) + 30/30 (client-logic)**; build 5/5 + checksums refreshed.

## 7 Jul 2026 — Gateway picker: PlatformAI / Kepler with per-gateway keys (alpha)

Per CL: users will be assigned keys on Kepler (prod: nc3.gov.sg) and need a first-class way to point LCL at it — not a Developer-only toggle. Version stays v0.67d.

- **Gateway segment** (same pattern as the classification picker) at the top of **Settings → Connection** AND in the **Connect modal**: **PlatformAI** (api.ai.tech.gov.sg) | **NC3 (Dev)** (dev-nc3.csa.gov.sg, `/kepler/v1/chat/completion` + `/kepler/v1/embeddings`) — the DEV box for now, per CL, so stable users can test kepler once v0.67e ships; the second gateway swaps to prod Kepler (nc3.gov.sg) when it goes live. Gateway names/URLs are data-driven from the server preset list (first two presets = the user gateways), so that swap is a one-line server change. The API-key label follows the pick ("GovTech Models API Key" ↔ "NC3 (Dev) API Key").
- **Keys are stored PER GATEWAY** (`D.settings.gwVault`, chat + embed keys): switching stashes the current gateway's keys and restores the target's — paste each key once, flip freely forever. First switch to a gateway with no saved key toasts "enter your <gateway> API key". Applies immediately (not on Save), rides the same `/api/endpoint` mechanism, and validation always runs against the ACTIVE gateway so a wrong-gateway key fails at connect/save with a clear message.
- **Embedding section shows the source as a banner** (per CL's mockup pick): a read-only status box under the caption — status dot + "Embedding via **Kepler**" + the full embeddings URL. Orange tint on Kepler, neutral on PlatformAI, amber for a custom Developer override (incl. "none — file embedding & RAG disabled" when it has no embeddings URL). Purely reflects the Connection pick — no action on it.
- **Developer custom Model field defaults to the model in use** (was blank) — pick Custom and the current model id is prefilled, editable as before.
- **Server**: Kepler added to `ENDPOINT_PRESETS` (now PlatformAI / Kepler / NC3 Dev). Developer section unchanged — custom URLs and dev boxes still override the gateway pick, and the segment then shows "A custom Developer endpoint is active" with neither tab lit. Health pill: "Chat + embed · Kepler" while off PlatformAI. Demo blocks switches with a toast.
- Fixed a latent bug the vault exposed: `D.settings = credsToSettings(creds)` (saveSP/connect/endpoint-save) overwrote the whole settings object, which would have dropped `gwVault` — now merges.
- **Per-endpoint key PAIRS + separate Developer key store** (per CL: kepler issues its own key pair): the Developer section gains **API Key** and **Embed API Key** fields shown for every selection — picking an endpoint in the selector loads its stored pair; Save stores the pair with that endpoint and applies it. Keys live in two stores: `gwVault` (PlatformAI/Kepler — the same entries the Connection gateway segment uses, one source of truth, defaults captured automatically) and `devVault` (NC3 Dev + customs — deliberately separate so testing keys never touch the real gateway pair). Switching endpoints ANY way stashes the outgoing endpoint's pair into its own store and restores the target's; "enter its API key" toast when the target has none. Tests **C32** (stash/restore across stores, field loading, gwVault untouched by dev keys); suites **40/40 + 32/32**.
- **CRITICAL FIX — persist() wiped the endpoint override** (found via the new url logging in CL's field run: Kepler set at :14, the very next stream at :19 went to PlatformAI). `/api/data` replaces `appData` with the client's copy, and the client's settings never carry `endpoint` (it's server-owned, set via `/api/endpoint`) — so any debounced `persist()` after a switch silently reverted the gateway. `handleSaveData` now re-attaches the server-held `endpoint` when the incoming settings lack it. Test **T40** replays the exact sequence; suites now **40/40 + 31/31**.
- **Debug logs show the real endpoint** (from CL's kepler run): the streaming path logged `[stream] path = /platform/models/chat/completions` — the legacy constant the handlers pass around — never the URL actually hit, and no host at all. Both outbound log blocks now print `url = <effective URL>` via `targetUrlStr()` (kepler, custom ports, everything).
- Tests **C31** (vault stash/restore both directions, endpoint POST, gateway detection) + **T36** updated for 3 presets; suites **39/39 + 31/31**. Crumb `gateway_set`. Needs a node restart (server preset list changed).

## 7 Jul 2026 — Developer settings: switchable API endpoint (alpha)

Per CL: point LCL at a different gateway (e.g. kepler on NC3 dev) without touching code. Reworked same-day from host-only to FULL URLS after CL supplied the real kepler URL (different path); https-only per CL. Version stays v0.67d.

- **Settings → System → Developer** (below Account): endpoint selector prefilled with **PlatformAI** and **NC3 Dev** (kepler: `https://dev-nc3.csa.gov.sg/kepler/v1/chat/completion` + `…/kepler/v1/embeddings`), plus **Custom…** — Name, Model URL, Embeddings URL (optional), Model id (optional; kepler proxies PlatformAI so the same model ids work and presets leave it blank). Picking a preset shows a read-only summary of exactly where model/embed traffic goes; picking PlatformAI clears the override. Applies on Save.
- **Server-persisted**: `GET/POST /api/endpoint` — `{name, modelUrl, embedUrl, model}` in `appData.settings.endpoint`; both upstream call sites parse the URL (host/port/path) via `upstreamTarget(kind)`. First-cut `{host}` overrides auto-migrate. Startup log shows the active endpoint.
- **No embeddings URL = RAG honestly off** (custom endpoints with a blank Embeddings URL): `/api/embed` + `/api/embed-batch` refuse with "This endpoint has no embeddings URL - switch back to PlatformAI to embed files." (400) instead of silently misrouting; the summary shows "none — file embedding & RAG disabled" in amber.
- **Allowlist (public repo!)**: URL hostnames must be `*.gov.sg`, scheme **https only**, no credentials — the local proxy can never be steered to an arbitrary internet host. Spoof shapes (`gov.sg.attacker.io`, `api.ai.tech.gov.sg.evil.com`, schemeless, ftp, http, user:pass) all 400, embed URL validated too.
- **Endpoint-pinned model**: a custom endpoint may pin a model id — applied on switch, with your previous model stashed and restored when you return to the default endpoint.
- **Visibility**: Developer nav item shows on the alpha channel, in `#demo`, or when an override is active (never hidden then); health pill gains "· <name>" off-default; endpoint changes blocked (toast) in demo.
- Tests **T36–T39** (URL presets, kepler set/persist/reset, allowlist refusals incl. bad embed URL, embeds refused without an embeddings URL) + **C30** (render, preset summary, custom toggle, save POST body, badge); suites **39/39 + 30/30**. Crumb `endpoint_set`. NOTE: needs a node restart to pick up the new server routes.

## 7 Jul 2026 — Split runs answer the QUESTION, not just summarise (alpha)

From CL's first field run of pacing v2 (which held up): he asked a whole-docs run to "search the presenter's name" and got summaries back. Cause: the user's text reached the top level, but the map-reduce SPLIT path hardcoded 'Summarise this part…' / 'Combine these part-summaries…', so any doc big enough to split dropped the question entirely. Version stays v0.67d.

- **Instruction threading**: non-summary asks now ride through both levels — map = "extract everything relevant to the request below… If nothing is relevant, reply exactly: Nothing relevant in this part." + the ask verbatim; reduce = "Using ONLY these extracts, answer the original request…". Cheaper AND correct for needle-in-haystack asks (irrelevant parts return one line, not a paragraph of summary).
- **`isSummariseAsk()` gate**: empty or summarise-style asks (summary/overview/tl;dr/key points) keep the original generic prompts — pure "summarise each" behaviour is unchanged.
- **Honest wording**: system line becomes "processing a document to answer the user's request" for non-summary asks; UI says "Processing i/N", "**doc** - response (i of N)", "processing part x of y", "Combining N part-extracts" instead of summary-speak; embed-wait line neutralised.
- Test **C29** (part + combine prompts carry the ask, system line switches, generic path preserved — real fetch bodies captured); C10 guards the generic path. Suites **35/35 + 29/29**. Verified live in #demo: 2-doc split run renders "response (1 of 2)" end-to-end.

## 7 Jul 2026 — Attachment tray: height cap + collapse to a summary line (alpha)

Per CL: a big working set shouldn't eat the chat. Version stays v0.67d.

- **30vh cap**: the chips area (`.at-chips`) is capped at 30% of the viewport and scrolls internally — the tray can never push the composer around.
- **Collapse chevron** (▾/▸) in the tray header — the header label ("Attached files — …" / "N files attached") is clickable too: collapsed = one "N files attached" summary line. The token meter and, when over budget, the amber "too large to send" label + **Embed all for RAG** action stay visible collapsed — warnings can't be hidden. remove-all and chips return on expand. State is a global preference (`lcl_tray_min`, localStorage) so it sticks across chats and reloads; `attach_tray_min` crumb on toggle.
- **Demo seed**: new "GovTech maia - working files" chat ships a 7-file working set so the tray, cap, and collapse are exercisable in `#demo` (drives U26 and future client cases). The floating demo buttons (Reset demo / + Many chats) moved from bottom-right to top-right under the Embed pill so they never cover the tray.
- Tests **C27** (collapse render/persist/over-state) + **C28** (settings `spNav` routing/persistence/`spTab` alias — companion to the settings revamp below); suites now 35/35 + 28/28. U26 added to UI checks. Verified live in #demo: collapse ↔ expand, reload persistence, meter intact.

## 7 Jul 2026 — Settings revamp: grouped left-nav + readable type scale (alpha)

Per CL's mockup rounds (nav groups, captions, then option-A labels + sizing). Version stays v0.67d.

- **Two-pane settings**: the tabbed modal becomes a 980×700 two-column layout — left nav grouped under MODEL (Connection / Embedding / RAG & files / Defaults) and SYSTEM (Updates / Account), chosen section remembered across opens (`lcl_sp_sec`). Appearance and Skills dropped from the nav per CL (reachable from the toolbar); legacy `spTab()` aliases to `spNav()`.
- **Captions replace ⓘ tooltips**: every section gets a one-line purpose caption (`.sp-cap`) and fields get always-visible hints (`.sf-cap`) — no more hover-to-discover.
- **Type scale + contrast (option A)**: nav group labels 11.5px uppercase with a divider underline and `cursor:default` (headings, not buttons); nav items 13.5px full text colour; section headers 13px; captions 13/12.5px promoted tx3→tx2; inputs/selects 13px mono; value pills (`.sf-num`) 14px in a taller 30px pill; slider ticks 12px; Disconnect 13.5px; sections sit on bg2 with the stronger border to match sidebar cards; title 19px.
- Contributors footer: "Contributors · LCL · Melvin Yung · Ko Zheng Teng" at 12px.
- U25 added to UI checks. Suites 35/35 + 26/26; verified live in #demo across all six sections.

## 6 Jul 2026 — File colour semantics: orange = embedded, blue = uploaded (alpha)

Per CL: the two file populations now read at a glance. EMBEDDED files (permanent chat knowledge) take the orange TINT family — panel cards, type tags, count pill, and the source tags under replies (they cite embedded docs). UPLOADED working files (tray, preview rows, message chips) stay blue. Tints, not saturated orange, so buttons keep their action pop. Verified in both themes. Version stays v0.67d.

## 6 Jul 2026 — UI consistency pass + honest embedding states (alpha)

Two batches, both demo-verified live before push. Version stays v0.67d.

- **Sidebar-language sections in the embed panel**: SEARCH MODE / FILES as uppercase section labels (like PINNED / TODAY), box-in-box and the awkward divider removed; "+ other chats" toggle inline on the label row (Option A), caption appends "Includes other chats' files." when on; file rows restyled as chat-item-style cards (same border/radius/bg/hover as the sidebar). Fixed a light-theme override that was silently defeating doc-row styling; unified section-label metrics (`.sp-lbl`) and status-badge radii (8px → full round); preview header weight aligned.
- **Honest embedding states** (from CL's "looks usable before it loads" report): the docs path hands off "Extracting n/N" → "Preparing to embed…" → "Embedding…" without flashing green; sending while docs are `pending`/`embedding` toasts "N files are still embedding — this answer won't use them yet" (`send_during_embed` crumb) since `buildPayload` only uses `ready` docs; the pending badge reads "waiting to embed…".

## 6 Jul 2026 — Embed panel streamlined + remove all (alpha)

Per CL's mockup approval. Version stays v0.67d.

- **One-line header**: title + count pill (hover = files · total size) + **remove all** (confirm → clears this chat's docs, cancels in-flight embeds, GCs orphaned vectors — shared docs keep theirs) + compact "+" upload. The intro paragraph and the big upload button are gone; a one-line footer hint ("Drop files anywhere… · about RAG") keeps the RAG explainer popover reachable.
- **Search-mode caption**: an always-visible line under Auto/Specific/Whole describing the ACTIVE mode, updating on click — more discoverable than the removed intro text; hover tooltips keep the long form.
- **Blue file rows**: doc cards became compact zebra rows — blue name + type tag (consistent with tray/preview/source chips), green `ready`, red `error`+Retry, embedding shows a percent label.
- Crumb `docs_remove_all`; test C26 (clear + embed-cancel + declined-confirm). Suites 35/35 + 26/26. Verified live in #demo incl. the remove-all dialog flow.

## 6 Jul 2026 — Tray "remove all" + progressive extraction preview (alpha)

Two follow-ups from CL. Version stays v0.67d.

- **"remove all"** link in the tray header (shows with 2+ files): confirm dialog, then clears the chat's working set (`attach_tray_clear` crumb).
- **No more frozen gap on multi-file upload**: `queueFilesForPreview` extracted every file BEFORE showing anything — an 8-PDF/21MB batch meant seconds of blank UI after the toast faded (21:23 log). The attach preview now opens IMMEDIATELY with placeholder rows ("extracting…") that fill in per file; health pill shows "Extracting n/N"; failed files drop their row with a toast; Confirm/Embed are blocked until extraction finishes; cancelling mid-extraction aborts the in-flight work (generation counter).
- Test C25 (remove-all incl. declined-confirm path); suites 35/35 + 25/25. Verified live in #demo: 3×700KB batch panel appears instantly; remove-all → confirm → tray cleared. (Log note: the squid 503 HTML + inactivity timeouts at the end of CL's log are Zscaler/network flakiness — the transient auto-retry handled them as designed.)

## 6 Jul 2026 — Attachment tray: attachments become a per-chat WORKING SET (alpha)

CL's design: attached files should live visibly at the bottom, removable and swappable — "old data that is viewed, then discarded". Replaces the bake-into-history model whose accumulation permanently bloated chats (39k→386k est climb in the 6 Jul log). Version stays v0.67d.

- **Tray above the composer** (`chat.attachedFiles`, persisted): blue chips with per-file ~token tags and ✕, "+ add files", and a live total meter (~est / budget). The CURRENT set is injected once per request into the system context (`trayContextBlock`); history stores only the typed text + provenance name-tags. Removing a file immediately shrinks every future send.
- **Oversize handling built in**: tray turns amber with "Embed all for RAG"; the send is gated client-side (`attach_oversize_blocked` crumb) so doomed requests never fire. Preview's "Attach anyway" is hidden when the batch exceeds the absolute ceiling (it could never send); reappears reactively as files are removed.
- **Unwinnable 429 fixed in the MAIN chat path**: near-full-window rejections (`Remaining ≥ 95% of limit` — the 6 Jul infinite retry loop at est 198k) stop auto-retrying; with tray files present the embed-conversion offer shows instead. Offer's second button is now "Dismiss".
- **Option-2 blue file theme**: preview rows (zebra + blue active), editor label strip + charcount pill, 1.75 line-height; tray chips blue — files are blue everywhere, orange stays for actions.
- Crumbs: `attach_tray_remove`, `attach_oversize_blocked/offered/converted (where=tray)`. Tests C22–C24 (tray block, unwinnable-429 offer, tray mutations); suites 35/35 + 24/24. Verified live in #demo: attach → tray → send (history stays clean, tray persists) → ✕ remove → oversize amber → hopeless Attach-anyway hidden → reactive recovery.

## 6 Jul 2026 — Attachment overhaul: row preview + per-file remove, expandable chips, oversize→embed flow (alpha)

Three fixes from CL's multi-file attach reports (6 Jul logs). Version stays v0.67d.

- **Preview shows every file** — the horizontally-scrolling tabs hid all but the first long filename ("only shows text for first file"). Now ONE ROW PER FILE (full name, char/token meta), click to view/edit, ✕ removes a single file (`attach_preview_remove` crumb). List scrolls only past ~8 files.
- **Sent chips expand again** — `buildContent` emitted `--- name ---` content-block arrays, but the renderer's expandable-chip parser expects `<file name="...">` blocks (only demo seeds matched). Now a single string in the renderer's format: every sent chip click-expands to its file text.
- **Oversize attachments get a real exit** — attachments bypass RAG budgeting and previously dead-ended at "switch Search mode" advice (est 238k/278k/386k blocks in the log). Now: (a) the preview warns when the batch can't fit inline and offers **Embed for RAG instead** (reuses extracted text; Confirm becomes "Attach anyway"); (b) the send guard restores the composer + chips and offers the same conversion (`attach_oversize_offered/converted` crumbs). The check is **history-aware**: earlier batches ride along in every payload (log: est climbed 39k→386k across batches), so batch N is warned about batches 1..N-1 too.
- Tests C20 (chip format incl. quote-sanitised names) + C21 (budget math incl. history stacking); suites 35/35 + 21/21. Verified live in #demo end-to-end: rows → remove → attach → expandable chips, and 240k-token file → oversize note → Embed for RAG instead → budget dialog → 1,500 chunks ready.

## 6 Jul 2026 — Proxy-origin shim: index.html works from file:// (alpha)

From the v0.67e review (colleague's stable-based build): people double-click `index.html` and it fails on CORS because relative `/api/...` paths resolve against `file://`. Ported the upload's shim + server deltas. Version stays v0.67d.

- **Client** (`12-transport.js`): `/api` and `/skills` paths are rewritten to `http://127.0.0.1:3000` whenever the page isn't served by the proxy (file:// or another local origin); override via `window.LCL_API_BASE` / localStorage `lcl_api_base`. All transport helpers + the clientlog fetches route through it.
- **Server** (CORS block): `Origin: null` (what file:// sends) is now reflected; `x-lcl-demo` added to Allow-Headers; Chrome Private-Network-Access preflight answered. Still no wildcard — internet origins get no grant (verified by T35) — behind the existing localhost host-guard and 127.0.0.1 bind.
- Tests: C19 (shim mapping), T34 (null-origin preflight), T35 (foreign origin refused). Suites now 35/35 + 19/19.
- Review outcome recorded here: all nine v0.67e changelog items verified present in alpha (some deliberately adapted: window-scaled full-text budget "2a", re-embed instead of doc migration, shared confirm dialog); alpha is already on pdf.js 5.7.284 so the upload's "upgrade pdfjs 3.11" note is closed; version bump to v0.67e deferred to the stable promotion.

## 3 Jul 2026 — Bubble spacing polish (alpha)

Per CL, applied consistently: the truncation/Continue box gets a 14px bottom margin, and the RAG source-chip row (`.rag-row`) gets 10px above / 14px below / 6px chip gaps — both were sitting flush against the Copy/Regenerate action row, worst with many long chips (11-file EES case). Verified live in #demo. Version stays v0.67d.

## 3 Jul 2026 — Continue button for token-capped replies (alpha)

From CL's 23:52 log: a reply hit `finish length` (max_tokens cap), the truncation warning was a cramped italic line that vanished on re-render, and Regenerate just re-truncated (137s wasted). Version stays v0.67d.

- **Continue reply**: truncated replies get the standard amber status box ("Reply hit the token limit — showing the first ~8,192 tokens…") with a **Continue reply** button. It rebuilds the same doc/system context (buildPayload on the original question), appends the partial turn + a payload-only continue instruction, and streams the continuation INTO THE SAME message. Capped again → box returns with the continuation count. 429/transient handling matches the summary path (countdown in the note area, not over the reply). Crumb: `continue_truncated {n}`.
- **Flags now persist**: truncation/filter notes render from `msg.truncated`/`msg.filtered` in `renderMessages` (shared `attachMsgFlags`), so they survive reloads and chat switches — previously live-bubble-only.
- `streamChatOnce` now reports `finish` (needed to know if the continuation was capped again); demo marker `[[truncate]]` simulates a token-cap cut-off; tests: T33 (server), C17 finish capture + C18 note/count rendering (client) — 33/33 + 18/18.
- Verified live in Chrome: flag → box → Continue → appended in place, `continues:1`, box cleared. Regenerate stays alongside Continue.

## 2 Jul 2026 — Busy-send feedback, main-chat truncation guard, toast position, Replying pill (alpha)

From CL's "multiple excels attach failed" report (23:01 log) + the Chrome pass. Version stays v0.67d.

- **Busy send is no longer a silent no-op**: the 23:00 send streamed for 110s (`finish length`); sends during it did NOTHING — no toast, no crumb — so the excel attach looked broken. Now: "Still replying — wait for it to finish or press Stop" toast + `send_blocked_busy` crumb. (The attach path itself was verified fine via live browser repro.)
- **Main-chat mid-reply stream death no longer silently truncates**: `runStream` captured the error frame but ignored it once tokens had arrived — a partial reply was accepted as complete (`[[streamdie]]` repro). Now the partial is discarded (`stream_died_midreply` crumb) and the standard transient auto-retry runs.
- **Toast moved above the composer** (bottom 20px → 132px) so it never covers the message box.
- **Health pill: "Replying — Stop to interrupt"** once tokens flow (consistent with "Summarising i/N").
- Client-logic suite → 16 cases (C14–C16) with a per-case watchdog + synchronous output; UI_CHECKS updated.

## 2 Jul 2026 — Demo + test suite upgraded for the pacing batch (alpha)

Everything shipped today is now regression-tested, with fixtures taken verbatim from the day's debug logs. Version stays v0.67d.

- **Demo realism**: `[[429]]` and the auto-every-5th 429 now return the FULL gateway body (`Limit type / Current limit / Remaining: 0 / Limit resets at`); new markers `[[429partial]]` (Remaining: 58944, the 21:45:46 fixture), `[[streamdie]]` (mid-stream death: error frame, no [DONE]), `[[embed429]]` (server-internal embed window-wait: pacing→done in one request); demo chat streams now end with a realistic terminal `usage` chunk (est ×1.8) so inflation-learning works in #demo.
- **Server suite 26→32** (`demo-api.test.js` T27–T32): embed 429 window-wait contract, full 429 body fields, partial-window body, mid-stream error frame shape, usage chunk, `[[toobig]]` Remaining ≥95% alignment.
- **NEW client-logic suite** (`test/client-logic.test.js`, 13 cases): runs the real `src/` modules in a vm sandbox (stubbed fetch/DOM, timing-only patches) — automates what previously needed a manual Chrome pass: 429-body parsing, too-big vs wait classification (both directions), truncation guard, transient retry, infl EMA learning, proactive pace gate, doneEl part persistence, embedsActive, deleteChat run-abort, toast durations.
- `UI_CHECKS.md` trimmed to visual-only items; `TEST_CASES.md` documents the new cases.

## 2 Jul 2026 — Toast duration: type floor + length scaling (alpha)

Toasts were a flat 2.8s regardless of content. Now: errors ≥6s, ok ≥4s, info ≥2.8s, scaled by message length (45ms/char), capped at 8s — "Saved" stays snappy, "Embed failed: …" lingers long enough to read. Replace-on-arrival behaviour unchanged. Version stays v0.67d.

## 2 Jul 2026 — Mammoth warnings: log-only, no toast (alpha)

Per CL: Mammoth conversion warnings are cosmetic (unrecognised styles, skipped text boxes/TOC fields) — they no longer toast or annotate the preview; they go to the browser console (full) and the server log via the `docx_warnings` crumb (first 3). Toasts remain for real extraction failures. Version stays v0.67d.

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
