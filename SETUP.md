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

## 4. Check quota

```bash
node bin/routewisp.mjs quota
```
Per-model remaining % and reset time for every connected account, straight
from each provider's real usage API (`open-sse/services/usage.js` — the same
fetchers upstream's dashboard used, just not behind a dashboard anymore).

## 5. Hardening for a public VPS

**Fastest path**: `./deploy/install-vps.sh` — an interactive wizard that SSHes
into your VPS and does steps below for you (installs Bun, clones this repo,
writes `.env` with generated secrets, smoke-tests, wires systemd, optionally
TLS via Caddy and a daily backup cron). Needs SSH key auth to the VPS already
working; asks before anything it can't undo. Safe to re-run — it remembers
answers in `.vps-wizard.env` (gitignored, holds real secrets, don't commit it).

The manual version of each of its steps:

**Rate limit** — `/v1/*`/`/v1beta/*` are limited per API key (fixed window,
`RATE_LIMIT_PER_MINUTE`, default 60/min, `0` disables). In-memory, so it
resets on restart and doesn't share state across more than one process —
fine for the single-process way this runs.

**Run under systemd, not a background shell** — `deploy/routewisp.service`.
Adjust `User`/`WorkingDirectory`/the bun path to match your VPS, put your real
env vars in `/opt/routewisp/.env`, then:
```bash
sudo cp deploy/routewisp.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now routewisp
```

**TLS** — routewisp itself speaks plain HTTP. Put a reverse proxy in front on
the VPS. `deploy/Caddyfile` is the whole config if you have a domain pointed
at the VPS (Caddy provisions Let's Encrypt automatically):
```bash
sudo caddy run --config deploy/Caddyfile
```
No domain yet? Either keep it plain HTTP and firewall port 20128 to known
client IPs only, or use `tls internal` in the Caddyfile for a self-signed
cert (clients need to trust it explicitly).

**Backup** — `~/.routewisp` (or `$DATA_DIR`) holds every provider connection,
OAuth token, and API key. Nothing backs it up automatically.
```bash
./deploy/backup.sh                       # -> ~/routewisp-backups/routewisp-<timestamp>.tar.gz
```
Add to cron for daily backups (`crontab -e`):
```
17 3 * * * /opt/routewisp/deploy/backup.sh
```
It's a plain `tar` of the SQLite files while the server may still be
writing — safe enough for a daily snapshot, but for a guaranteed-consistent
backup stop the service first (`systemctl stop routewisp`), back up, restart.

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

## Verification

The 49 tests exercising the real translator/chat flow (including antigravity)
pass; see the $ref fix note below. Beyond that, the full request path has been
verified live: non-streaming and streaming `/v1/chat/completions` against real
antigravity and commandcode accounts, multi-account rotation (2 antigravity
logins on the same router), and `/api/quota`.

(`tests/unit/gemini-3.{6,7,8}-integration.test.js` were removed — they only
tested `src/mitm/config.js`'s `extractModel()`, which doesn't exist in this
fork.)

## Bug fix carried over from the first pass

`open-sse/translator/request/openai-to-gemini.js`: tool_result content with
`$`-prefixed JSON-Schema keys (`$ref`/`$defs`/`$schema`) surviving into a
Gemini `functionResponse` got treated as a schema ref and rejected the whole
request. Fixed with `sanitizeFunctionResponseValue()`; test in
`tests/translator/bugs-gemini-cursor-commandcode.test.js`.
