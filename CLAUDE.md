# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## What this is

routewisp — a minimal AI routing gateway, forked from
[9router](https://github.com/decolua/9router) (MIT). It exposes one
OpenAI/Claude/Gemini-compatible endpoint (`/v1/*`, `/v1beta/*`) and routes to
**antigravity** (Google OAuth) and **commandcode** (API key) with format
translation and fallback. No dashboard, no Next.js, no React — a Bun-native
server (`server.js`) plus a CLI (`bin/routewisp.mjs`) for setup. See
`SETUP.md` for the full story of what was cut from upstream and why.

The code lives in `src/` (server, router, kept API routes, glue) and
`open-sse/` (the provider-agnostic routing/translation engine, vendored
essentially unmodified from upstream — see its own `AGENTS.md`).

## Commands

```bash
bun install
bun server.js                 # or: bun --watch server.js (dev)
node bin/routewisp.mjs ...   # CLI — keys/providers/combos/login (see SETUP.md)
```

Tests (vitest, in `tests/`, an **independent** package):
```bash
cd tests && npm install
npx vitest run unit/gemini-3.7-antigravity.test.js   # single file
```
Inherited from upstream, not audited file-by-file after the fork: expect some
red beyond what upstream's own `tests/__baseline__/known-fails.txt` catalogues.
Known additional red here: `unit/gemini-3.{6,7,8}-integration.test.js` (they
exercise `src/mitm/config.js`'s `extractModel()`, which no longer exists —
MITM was removed). The translator/chat-flow tests that matter for
antigravity/commandcode pass; that's what's been verified.

## Architecture

### Request flow
`src/app/api/v1/*` (a `route.js` exporting `GET`/`POST` etc., same shape Next's
App Router used) → matched by `src/router.js` (file-based, walks
`src/app/api/**/route.js` at boot, static-beats-dynamic-beats-catch-all) →
`src/sse/handlers/chat.js` (combo expansion, account-selection loop) →
`open-sse/handlers/chatCore.js` (translate, dispatch, retry/refresh, stream) →
`open-sse/executors/*` → `open-sse/translator/*` → SSE back to client.

`server.js` is the only entry point (`Bun.serve`) — no Next, no
`custom-server.js` wrapper. `src/lib/nextCompat.js` shims `NextResponse`/
`NextRequest` so the ~55 kept `route.js` files didn't need their internals
touched when Next.js was removed.

### `/api/*` auth
Everything under `/api/*` requires `Authorization: Bearer <ADMIN_TOKEN>`
**except** `/api/health`, `/v1/*`, `/v1beta/*` (their own `requireApiKey` gate
applies instead), and `/api/oauth/:provider/{authorize,exchange,poll}` (a bare
browser mid-OAuth-redirect can't carry a token). This gate lives in
`server.js`, not per-route — it replaces the dashboard-session check upstream
used to enforce the same boundary.

### Translator engine (`open-sse/translator/`) — vendored, unmodified except one fix
- Pivots through **OpenAI as the intermediate format**. A translator registered
  on an exact `source:target` pair runs as a **direct route**, skipping the
  lossy double-hop.
- Translators **self-register** via `register(from, to, reqFn, resFn)` as an
  import side effect — must be imported in `open-sse/translator/index.js`.
- One fix applied on top: `request/openai-to-gemini.js` sanitizes `$`-prefixed
  keys (`$ref`/`$defs`/`$schema`) in `functionResponse` content before sending
  to Gemini — see the test in `tests/translator/bugs-gemini-cursor-commandcode.test.js`.

### Provider registry (`open-sse/providers/registry/*`)
One file per provider, still lists all 40+ from upstream (only antigravity and
commandcode have credentials configured here) — untouched, auto-generated
index, don't hand-edit.

### Persistence
SQLite via `src/lib/db/driver.js`'s adapter chain: `bun:sqlite` (this build's
actual path — always available under Bun, no extra dependency) → others as
fallback if ever run under plain Node. DB path: `DATA_DIR` env, else
`~/.routewisp/` (`src/lib/dataDir.js`).

### RTK token saver (`open-sse/rtk/`)
Pre-translate hooks that compress `tool_result` content. Fail-open: any error
returns null and leaves the body untouched.

## Conventions & gotchas

- Plain JavaScript (ESM), no TypeScript. `@/*` → `src/*`, `open-sse` → `open-sse/`
  — both resolve at runtime from `jsconfig.json`'s `paths`, which Bun reads
  natively (confirmed; this is why no bundler/loader was needed post-Next).
- Everything under `src/mitm/`, `src/lib/tunnel/`, the dashboard, SAML/OIDC,
  and the `cli/` tray launcher was deleted — don't re-introduce imports to
  those paths. `src/lib/headroom/` and `src/lib/pxpipe/` were kept because
  `src/sse/handlers/chat.js` imports them directly (optional, fail-open,
  off unless configured).
- Security-sensitive env: `ADMIN_TOKEN` (gates `/api/*`, see above),
  `API_KEY_SECRET`, `MACHINE_ID_SALT`. Full contract in `.env.example`.
- Binary/protobuf upstreams (kiro EventStream, cursor protobuf, commandcode
  NDJSON) don't round-trip through OpenAI — handled in their own executor.
