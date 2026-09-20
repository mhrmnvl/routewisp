# routewisp — VPS setup

Second pass: no Next.js, no dashboard. Just `open-sse/` (the routing/translation
engine, untouched) behind a ~150-line router on Bun's native HTTP server, plus
a CLI for setup instead of curl. Providers wired for this build: **antigravity**
(Google OAuth) and **commandcode** (API key).

## Why Bun, not Node

- `node_modules`: **5.5MB** (was 381MB on Node w/ Next.js, production-only install).
- No `sql.js`/`better-sqlite3` dependency at all — Bun's built-in `bun:sqlite`
  is what `src/lib/db/driver.js` already prefers first; the fallback chain to
  those two only exists for plain Node, which this build doesn't need.
- `@/*` and `open-sse` import aliases (used all over `src/` and `open-sse/`)
  resolve natively from `jsconfig.json`'s `paths` — no bundler, no loader hook.
- Route handlers kept their exact Next.js App Router shape
  (`export async function GET(request, { params })` returning a `Response`) —
  a `NextResponse`/`NextRequest` shim (`src/lib/nextCompat.js`) is enough, so
  none of the 58 `route.js` files needed their internals touched.

## 1. Install & run

```bash
curl -fsSL https://bun.sh/install | bash   # one static binary, if not already on the VPS
bun install
ADMIN_TOKEN=$(openssl rand -hex 32) \
API_KEY_SECRET=$(openssl rand -hex 32) \
MACHINE_ID_SALT=$(openssl rand -hex 16) \
PORT=20128 HOSTNAME=0.0.0.0 \
  bun server.js
```

Put this behind systemd/pm2 to survive reboots. `Dockerfile` (oven/bun base
image) also works if you prefer that — not test-built in this sandbox (no
docker daemon here), so build it once yourself before trusting it blind.

**`ADMIN_TOKEN` matters on a public VPS**: everything under `/api/*` except
`/api/health`, `/v1/*`, `/v1beta/*`, and the OAuth `authorize`/`exchange`/`poll`
actions now requires `Authorization: Bearer <ADMIN_TOKEN>` — this replaces the
dashboard-session gate that got deleted along with the dashboard (that gate
used to cover exactly this route set; without it `/api/keys` etc. would've
been wide open to the internet). If you don't set it, one is generated per
restart and printed to stdout — fine for a quick test, not for anything you
walk away from.

## 2. Set up with the CLI (from your own laptop, not the VPS)

```bash
node bin/routewisp.mjs config set --api-url http://YOUR_VPS_IP:20128 --token YOUR_ADMIN_TOKEN
node bin/routewisp.mjs keys create opencode        # → sk_... : the Bearer key for OpenCode/Claude Code/etc.
node bin/routewisp.mjs providers add commandcode --api-key user_...   # from ~/.commandcode/auth.json or commandcode.ai/studio
node bin/routewisp.mjs providers login antigravity # opens your browser, no SSH tunnel needed (see below)
node bin/routewisp.mjs models                      # sanity check
node bin/routewisp.mjs combos add default ag/gemini-3.8-flash,commandcode/deepseek/deepseek-v4-flash
```

`providers login` works from any machine with a browser and network access to
the VPS's API — it opens a local port on *your* machine to catch Google's
redirect (Google only allows redirecting to `localhost`, but that's your
laptop's localhost, not the VPS's), then forwards the code to the VPS over the
network. No SSH tunnel, unlike the curl-based flow from the first pass.

Needs `bun install` (or `npm install open` — the CLI's only real dependency)
once for the `open` package if running the CLI standalone outside this repo.

### Manual fallback (no CLI, e.g. from a browser only)

```
GET http://YOUR_VPS_IP:20128/api/oauth/antigravity/authorize?redirect_uri=http://localhost:8765/callback?provider=antigravity
```
→ open the returned `authUrl`, log in, you'll land on `/callback` which
exchanges the code itself and shows "Connected". This only works if your
browser can resolve `localhost:8765` back to something listening — the CLI
path above is simpler because it runs that listener for you.

## 3. Use it

```
Base URL: http://YOUR_VPS_IP:20128/v1   (or /v1beta for Gemini-native)
API Key:  the sk_... from `routewisp keys create`
Models:   ag/<model>          → Antigravity  (see `routewisp models`)
          commandcode/<model> (alias cmc/…)  → CommandCode
```

⚠️ Antigravity is flagged `deprecated`/`RISK_NOTICE` in the upstream provider
registry (unofficial use of the Antigravity IDE's internal API) — works, but
could change or get an account flagged without notice.

---

## What's in this build vs. the first pass

Same cuts as before (dashboard, MITM, tunnel, media endpoints, cli-tools,
usage dashboard, SAML/OIDC, the `cli/` tray launcher — see git history for the
full list), plus this pass:

- **Next.js, React, react-dom — gone.** Replaced by `server.js` (Bun.serve) +
  `src/router.js` (a small file-based router that walks `src/app/api/**/route.js`
  the same way Next did, static-beats-dynamic-beats-catch-all, same as Next's
  own precedence) + `src/lib/nextCompat.js` (the `NextResponse`/`NextRequest` shim).
- `/callback` and `/` are now plain `Response`-returning modules
  (`src/routes/callback.js`, `src/routes/home.js`), no JSX.
- `express`/`http-proxy-middleware` dropped from `package.json` — inherited
  from upstream, already unused by anything this build kept.
- Re-added: the `ADMIN_TOKEN` gate (see above) — the dashboard-session check
  that used to protect `/api/keys`, `/api/providers`, `/api/combos`,
  `/api/oauth/*` (minus authorize/exchange/poll) was deleted with the
  dashboard in the first pass and nothing replaced it until now.
- New: `bin/routewisp.mjs` — plain-Node CLI (works without Bun) wrapping the same
  admin REST endpoints, plus a local OAuth-redirect catcher so `providers
  login` doesn't need an SSH tunnel.

## Known gap

`src/mitm/config.js`'s `extractModel()` (URL-pattern-based model detection for
intercepted IDE traffic) is gone along with `src/mitm/`, so
`tests/unit/gemini-3.{6,7,8}-integration.test.js` fail to import — they test
that MITM-only helper, not the actual request path. The 49 tests that exercise
the real translator/chat flow (including the ones covering antigravity) still
pass; see the $ref fix note below for what was verified.

## Bug fix carried over from the first pass

`open-sse/translator/request/openai-to-gemini.js`: tool_result content with
`$`-prefixed JSON-Schema keys (`$ref`/`$defs`/`$schema`) surviving into a
Gemini `functionResponse` got treated as a schema ref and rejected the whole
request. Fixed with `sanitizeFunctionResponseValue()`; test in
`tests/translator/bugs-gemini-cursor-commandcode.test.js`.
