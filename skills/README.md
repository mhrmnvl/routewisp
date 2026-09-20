# routewisp — Agent Skills

Drop-in skill for any AI agent (Claude, Cursor, ChatGPT, custom SDK) to use
this router without writing provider boilerplate.

Note: this isn't published anywhere yet (no remote configured on this repo),
so "paste this raw GitHub link to your AI" only works once you push it
somewhere your agent can fetch from. Until then, just point your agent at the
file locally: `skills/routewisp/SKILL.md`.

## Skills

| Capability | File |
|---|---|
| **Entry / Setup** (start here) | `skills/routewisp/SKILL.md` |
| Web search | `skills/routewisp-web-search/SKILL.md` |
| Web fetch (URL → markdown) | `skills/routewisp-web-fetch/SKILL.md` |

Image, video, TTS, STT, and embeddings skills from upstream were dropped —
those endpoints (`/v1/images`, `/v1/audio`, `/v1/videos`, `/v1/embeddings`)
aren't in this fork (see `SETUP.md`).

## Configure your shell once

```bash
export NINEROUTER_URL="http://localhost:20128"   # or your VPS URL
export NINEROUTER_KEY="sk-..."                   # via `node bin/routewisp.mjs keys create <name>`
```

Verify: `curl $NINEROUTER_URL/api/health` → `{"ok":true}`.
