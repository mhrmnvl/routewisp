# routewisp

Minimal AI provider router: one OpenAI/Claude/Gemini-compatible endpoint that
routes to Antigravity and CommandCode, with automatic format translation and
fallback. No dashboard, no Next.js — a small Bun-native server plus a CLI for
setup.

See **[SETUP.md](SETUP.md)** for install, configuration, and provider setup.

## Provenance

Forked from [9router](https://github.com/decolua/9router) (MIT licensed) —
`open-sse/` (the routing/translation engine) is vendored from it essentially
unmodified. The dashboard, Next.js, MITM proxy, tunnel, and most other
upstream features were removed; see `SETUP.md` for the full list of what
changed. Original copyright and license terms are preserved in `LICENSE`.
