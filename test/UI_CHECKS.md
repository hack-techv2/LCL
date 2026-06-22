# LCL Demo — Browser E2E checklist (Claude-in-Chrome)

The `node` harness (`demo-api.test.js`) covers the **server** side. This checklist
covers the **client/browser** side, which can't be a plain node test. It's driven
manually via Claude-in-Chrome on `http://localhost:3000/#demo` — run it on request
before a release-worthy push (esp. before promoting to `main`).

## Prerequisites
- LCL server running the build under test (`node server.txt`).
- After an `index.html` change → **hard-reload** the browser.
- After a `server.txt` change → **restart node** (then reload).
- Open `localhost:3000/#demo` (the `#demo` hash seeds the demo + sets DEMOKEY).

## Driving notes (environment quirks)
- Automated keystrokes don't reliably land in the composer textarea → trigger a
  send via the page: set `#msg-in` value then call `send()`.
- The rate-limit reset is ~5s, which auto-retries fast — to *capture* the
  countdown box, trigger it with the `[[429]]` marker and screenshot within ~1s.
- The every-5 auto-retry counter is server-global; for a deterministic single
  hit use the `[[429]]` marker instead of counting messages.

## Checklist

| # | Steps | Expected |
|---|-------|----------|
| U1 | Disconnect (Settings → Account), then Connect with the prefilled DEMOKEY | "Connected (demo)"; real `POST /api/chat` validation returns 200; demo seed (chats/docs/skills) survives |
| U2 | Send a plain message | Live token-by-token stream; renders **bold**, *italic*, `code`, link, and a bulleted list in the DOM (`<strong>/<em>/<code>/<a>/<li>`) |
| U3 | Send "…code snippet…" | Reply renders a fenced code block (`<pre><code>`) |
| U4 | In the seeded **Pentest** skill chat, send a message | Streams a reply, NO "Skill … not found" error (skill resolves from `skillsCache`) |
| U5 | Upload a file in Embeddings panel → wait for "ready" → ask a question | Chunks embed via `/api/embed-batch`; reply shows a **source-tag chip** (RAG retrieve ran) |
| U6 | Send `[[429]] …` | "Error 429: Rate limit reached" box with local-time reset + live "Retrying in" countdown + Cancel; after ~5s auto-retries and streams the reply; health pill cycles Rate-limited → Chat+embed |
| U7 | Send `[[slow]] …`, then click Stop mid-stream | Stream halts; "(stopped)" appended; composer usable again |
| U8 | Open Connect modal and Settings → Models | Both key fields show "Demo key prefilled — DEMOKEY" (demo-only; absent in normal mode) |
| U9 | Send `[[401]]` and `[[500]]` | Each renders an error bubble ("Error 401…" / "Error 500…") and the health pill reflects the error |
| U10 | Click "Reset demo"; click "+ Many chats" | Re-seeds the demo cleanly; long chat list groups by date |
| U11 | Upload a `.pptx` to Embeddings → wait → ask about it | Slide text + speaker notes extracted (`=== Slide N ===` / `[Notes]`), chunks embed, doc goes "ready", retrieval works. (Needs cdnjs JSZip reachable.) |
| U12 | Upload a code/config or no-ext file (`.ts`, `.sql`, `Dockerfile`) and a binary (`.png`) | Text-like files extract + embed (no allowlist); the binary is skipped with "Could not read … unsupported file type (not readable as text)" |

## Status log
Record date + build (index.html / server.txt sha) + which items passed when run,
so we have a trail.
- 22 Jun 2026 (file policy): **U12 verified** — gate made permissive: office
  types use extractors; any other file is read as UTF-8 text and rejected only if
  it sniffs binary (NUL / high U+FFFD ratio). `extractText()` accepted a `.ts`
  (incl. spaces) and rejected a binary blob ("not readable as text"). Build 5/5
  incl. null-byte scan.
- 22 Jun 2026 (pptx): **U11 verified** — synthetic `.pptx` built in-page and run
  through the real `extractText()` (slide order, `<a:t>`, `&amp;` decode, speaker
  notes resolved via slide rels) then `embedDoc()` → "ready" + chunk embedded;
  `JSZip` loads from cdnjs on the gov network. (Real-file upload not yet driven —
  the native file dialog isn't automatable; do it manually when convenient.)
- 22 Jun 2026 (alpha build): **U1–U10 all verified live** — incl. U7 (Stop mid
  `[[slow]]` → "(stopped)") and U10 (Reset demo re-seeds; "+ Many chats" adds 18,
  date-grouped). U6 countdown captured via the `[[429]]` marker.
