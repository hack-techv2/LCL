# LCL Demo-API — Test Cases

Server-side regression cases for the `#demo` (DEMOKEY) responder in `server.txt`.
Run with `node test/demo-api.test.js [groups...]` — see `CLAUDE.md` for when to
run which group. All cases are deterministic (the demo responder returns canned,
seeded output), so a failure is a real regression, never flakiness.

Harness boots the real `../server.txt` on port **3990** in-process (only the port
is changed) and drives it over HTTP. Every demo request carries the gate header
`x-lcl-demo: 1` and key `DEMOKEY` unless the case is testing the gate.

## Groups

| Group | Covers | Run when you touched… |
|-------|--------|------------------------|
| `chat` | streaming SSE, buffered/auto-title, code render, every-5 | `demoChatStream` / `demoChatJson` / `demoServeChat`, chat payload, transport |
| `embed` | single + batch embeddings, determinism, streamed batch progress + `[[embedfail]]` | `demoEmbed` / `demoVector` / `demoServeEmbedBatch`, `handleEmbed*` demo branches |
| `rag` | lookup, evict, gc (cache guards) | `handleEmbedLookup/Evict/Gc` demo branches |
| `errors` | `[[401]]` / `[[429]]` / `[[filter]]` markers | `demoErrorFor`, marker handling |
| `retry` | every-5 auto-429 + `[[429]]` resend | rate-limit / reset-stamp logic |
| `gate` | header + key restriction | `demoGate` / `isDemoReq` / `_demoHdr` (transport) |
| `slow` | `[[slow]]` token cadence (**opt-in**, ~25s) | slow-stream path; excluded from the default run |

## Cases

| ID | Group(s) | Endpoint / input | Expected |
|----|----------|------------------|----------|
| T0 | chat, retry | 6× plain streamed `/api/chat` | 5th = `429` with `Limit resets at:` stamp; 6th = `200` |
| T1 | chat | streamed `/api/chat` | `200`, SSE has `delta.content`, `[DONE]`, `finish_reason:"stop"` |
| T2 | chat | buffered `/api/chat` w/ "title" system prompt | `200`, short title (`Demo conversation`) |
| T3 | chat | buffered `/api/chat` "code snippet" | `200`, reply contains a ``` ``` ``` fence |
| T4 | embed | `/api/embed` single | `200`, `data[0].embedding.length === 1024` |
| T5 | embed | `/api/embed-batch` (3 inputs) | `200`, 3 embeddings + 3 hashes, dim 1024 |
| T6 | embed | same input embedded twice | identical vector (deterministic) |
| T7 | errors | `[[401]]` prompt | `401` |
| T8 | errors, retry | `[[429]]` prompt twice | `429` then `200` (retry succeeds) |
| T9 | errors | `[[filter]]` prompt | `200`, SSE has `content_filter` finish_reason |
| T10 | gate | DEMOKEY **without** `x-lcl-demo` header | `401` ("only works in #demo") |
| T11 | gate | header present but key ≠ DEMOKEY | `401` ("requires the demo key") |
| T12 | rag | `/api/embed-lookup` (3 hashes) | `200`, 3 non-null vectors, dim 1024 |
| T13 | rag | `/api/embed-evict` | `200`, `removed: 0` (real cache untouched) |
| T14 | rag | `/api/embed-gc` | `200`, `removed: 0` |
| T15 | errors | `[[500]]` prompt | `500` + demo error body |
| T16 | embed, rag | single + batch + lookup dims | all `1024` (RAG cosine invariant) |
| T17 | retry | `[[429]]` reset timestamp | parses to a time in the future |
| T18 | rag | batch embed, then evict + gc | both `removed: 0` (guard holds under load) |
| T19 | embed | `/api/embed` empty input | `200`, still a 1024-d vector |
| T20 | slow | `[[slow]]` vs normal stream timing | `200` and slow run > 2× the normal run |
| T21 | embed | `/api/embed-batch` (20 inputs, demo) | SSE streams `progress` + one `pacing` event, then `done` with 20 embeddings (dim 1024) |
| T22 | embed, retry | `/api/embed-batch` w/ `[[embedfail]]` twice | 1st streams a `type:error` event; 2nd (retry) `200` with the embedding (fail-once-then-succeed) |
| T23 | embed, rag | `GET /api/ratelimit`, then a demo embed | tokLimit 200000; tokRemaining decreases after the embed (cumulative burn-down) |
| T24 | embed | `/api/embed-batch` with ~120k-token inputs | `413` + "exceeds the token cap" (Phase 2 server hard-cap backstop) |

> T0 must run before any other plain streamed chat (the every-5 counter is
> server-global and resets on boot). It is first in the list, so any group that
> includes it runs it first.

## Browser / client E2E

Not covered by this server-side harness — see **`UI_CHECKS.md`** for the
Claude-in-Chrome checklist (render-in-DOM, skill+RAG source tags, the rate-limit
countdown UI, Stop mid-stream, the DEMOKEY key-field hint, disconnect→reconnect).

## Still to iterate (server)

- RAG ranking depth / cosine behaviour (we assert non-null + consistent dims, not
  retrieval quality — demo vectors are non-semantic by design).
- Normal-mode (non-demo) real-key path is intentionally not exercised here.

## 2 Jul 2026 additions — rate-limit pacing / truncation contracts

Server suite (`demo-api.test.js`, now 32 cases):

| ID | groups | What it does | Expects |
|----|--------|--------------|---------|
| T27 | embed, retry | `[[embed429]]` embed-batch | ONE request: pacing ticks then done, no error frame (server-internal 429 window-wait) |
| T28 | errors, retry | `[[429]]` body | full gateway format: `Limit type: tokens`, `Current limit: 200000`, `Remaining: 0`, parseable reset stamp |
| T29 | errors, retry | `[[429partial]]` | `Remaining: 58944` (21:45:46 log fixture), then 200 on retry |
| T30 | chat, errors | `[[streamdie]]` | deltas, then `{"error":…}` frame, NO finish/[DONE] |
| T31 | chat | `[[usage]]` stream | terminal usage chunk with numeric prompt/total tokens |
| T32 | errors | `[[toobig]]` | Remaining ≥ 95% of limit (aligns with the client too-big rule) |

Client-logic suite (`client-logic.test.js`, 13 cases, run: `node test/client-logic.test.js`):
loads the REAL `src/12-transport.js` / `50-chatprocessing.js` / `30-chatlist.js` /
`toast()` in a vm sandbox (stubbed fetch/DOM; `_RL_WINDOW_MS` 62000→1500 and the
transient-retry sleep 4000→200 are the only patches, timing-only). Fixtures are
verbatim 2 Jul 2026 log bodies. C1–C2 postClassified parsing/kinds; C3 truncation
guard (mid-stream error → transient); C4 usage capture; C5 near-full 429 → tooBig;
C6 partial 429 (58944) → wait not split; C7 transient retry; C8 infl EMA learning;
C9 proactive pace gate; C10 map-reduce doneEl/liveEl + single-level split;
C11 embedsActive; C12 deleteChat abort + unshared-doc cancel; C13 toast durations.

### C14–C16 (busy-send / stream-death / toast position)

C14 busy `send()` → toast "Still replying…" + `send_blocked_busy` crumb (was a silent
no-op — the 2 Jul "excel attach failed" report); C15 mid-reply stream death →
partial discarded, `stream_died_midreply` crumb, standard transient auto-retry
(was silently accepted as a complete answer); C16 `#toast` sits ≥100px up,
above the composer. Harness has a per-case 20s watchdog + synchronous output.

### T33 / C17 / C18 (3 Jul — Continue for token-capped replies)

T33: `[[truncate]]` demo marker → stream ends `finish_reason:"length"` + usage.
C17: `streamChatOnce` surfaces `finish` ('length' vs 'stop'). C18: `attachMsgFlags`
renders the Continue box from persisted flags, with the continuation-count variant.
