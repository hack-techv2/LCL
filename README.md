# Local Comet LLM (LCL)

A single-page chat app + lightweight Node.js proxy that lets Singapore
Government Comet machine users talk to GovTech PlatformAI through a local
browser interface at `http://localhost:3000`.

- **Audience:** non-technical Comet users (CSA / ASG). Install once, use daily.
- **Footprint:** two files — `index.html` (the whole app) and `server.txt`
  (the proxy). No build tools or dependencies required to *run*.
- **Current version:** v0.67d — see [CHANGELOG.md](CHANGELOG.md) for version history.

---

## How it works

```
Browser (index.html)  ──>  Node proxy (server.txt)  ──>  GovTech PlatformAI
   chat UI, RAG,            adds auth header, streams        chat + embeddings
   markdown, file work      responses, caches embeddings     (api.ai.tech.gov.sg)
```

- `index.html` is a self-contained SPA — HTML + CSS + JS in one file. It is
  **generated** from the modules in `src/` by `build.js`; do not edit it directly.
- `server.txt` is a zero-dependency Node script (run directly, not built). It
  proxies requests so the browser never holds the upstream connection, streams
  responses token-by-token, paces embedding against the API rate limit, and
  caches embedding vectors locally.

---

## Repository layout

| Path | What it is |
|---|---|
| `index.html` | The shipped app (generated — do not hand-edit). |
| `server.txt` | The Node proxy. Run this. |
| `src/` | Source modules (`head.html`, JS modules, `tail.html`) assembled by `build.js`. |
| `build.js` | Concatenates `src/` into `index.html` and runs verification checks. |
| `PROJECT_BRIEF.md` | Context brief for picking the project back up. |
| `UPGRADE_PLAN_file-editing.md` | Design notes for the experimental file-editing feature (not yet built). |
| `CHANGELOG.md` | Version history. |
| `LCL_Setup_Guide.html` | End-user setup guide. |

Not committed (see `.gitignore`): `lcl_data.json` and `embed_cache.bin`
(runtime data/caches), `LCL.zip`, backups, and `llms.txt` (internal docs).

---

## Build

```bash
node build.js
```

This regenerates `index.html` from `src/` and runs verification (null-byte
scan, per-module + bundle syntax checks, undefined-function scan). It can also
optionally package changed files into a password-protected `LCL.zip`.

## Run

1. Place `index.html` and `server.txt` in a folder named `LCL`.
2. Start the proxy with Node:

   ```js
   require('./server.txt')
   ```

   (The setup guide documents the exact one-line startup command used on Comet
   machines, which resolves the LCL folder under the user's profile.)
3. Open `http://localhost:3000` in the browser.

## Configure

- **API key & model** are entered in the app UI (Connect), not stored in the
  repo. They persist locally in `lcl_data.json` (git-ignored).
- **Upstream host** is set in `server.txt` (`API_HOST`) and auth uses the
  `x-api-key` header, per PlatformAI guidance.

---

## Security notes

- No credentials are committed. API keys are supplied at runtime and saved only
  to the local, git-ignored `lcl_data.json`.
- Embedding vectors are cached locally in `embed_cache.bin` (git-ignored).
- The optional `LCL.zip` uses ZipCrypto — weak, for casual gating only, not for
  protecting secrets.

## Credits

Local Comet LLM (LCL) — CSA / ASG. Contributors: Melvin Yung, Ko Zheng Teng.

> Internal tool for Singapore Government use. Review for sensitive content
> before making any repository public.