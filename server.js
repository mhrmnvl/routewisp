import { buildRouter, rewritePath, matchRoute } from "./src/router.js";
import { GET as homeGET } from "./src/routes/home.js";
import { GET as callbackGET } from "./src/routes/callback.js";
import { initializeApp } from "./src/shared/services/initializeApp.js";
import { extractApiKey } from "./src/sse/services/auth.js";

const port = Number(process.env.PORT) || 20128;
const hostname = process.env.HOSTNAME || "0.0.0.0";

const router = await buildRouter();
await initializeApp();

const DEFAULT_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

// Everything under /api/* is an admin operation (create keys, register provider
// credentials, browse/alter combos, import local desktop tokens) EXCEPT the
// public LLM endpoints (their own requireApiKey gate applies) and the two OAuth
// actions a bare browser mid-redirect must be able to reach unauthenticated.
const PUBLIC_API = [
  /^\/api\/health$/,
  /^\/api\/v1(\/|$)/,
  /^\/api\/v1beta(\/|$)/,
  /^\/api\/oauth\/[^/]+\/(authorize|exchange|poll)$/,
];
const isPublicApi = (pathname) => PUBLIC_API.some((re) => re.test(pathname));

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || crypto.randomUUID();
if (!process.env.ADMIN_TOKEN) {
  console.log(`[Admin] No ADMIN_TOKEN set — generated one for this run: ${ADMIN_TOKEN}`);
  console.log("[Admin] Set ADMIN_TOKEN to this value (or your own) to keep it stable across restarts.");
}

const RATE_LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 60);
const rateBuckets = new Map();

function checkRateLimit(key) {
  if (!RATE_LIMIT_PER_MINUTE || RATE_LIMIT_PER_MINUTE <= 0) return { allowed: true };
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return { allowed: true };
  }
  bucket.count++;
  if (bucket.count > RATE_LIMIT_PER_MINUTE) {
    return { allowed: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { allowed: true };
}

const isLlmPath = (pathname) => /^\/api\/v1(\/|$)|^\/api\/v1beta(\/|$)/.test(pathname);

Bun.serve({
  port,
  hostname,
  idleTimeout: 0,
  async fetch(request, server) {
    const url = new URL(request.url);

    if (url.pathname === "/") return homeGET(request);
    if (url.pathname === "/callback") return callbackGET(request);

    const pathname = rewritePath(url.pathname);

    if (pathname.startsWith("/api/") && !isPublicApi(pathname)) {
      const auth = request.headers.get("Authorization");
      if (auth !== `Bearer ${ADMIN_TOKEN}`) {
        return Response.json({ error: "Missing or invalid admin token" }, { status: 401 });
      }
    }

    if (isLlmPath(pathname)) {
      const rateKey = extractApiKey(request) || server.requestIP(request)?.address || "unknown";
      const { allowed, retryAfterSec } = checkRateLimit(rateKey);
      if (!allowed) {
        return Response.json({ error: "Rate limit exceeded" }, { status: 429, headers: { "Retry-After": String(retryAfterSec) } });
      }
    }

    const match = matchRoute(router, pathname);
    if (!match) return new Response("Not found", { status: 404 });

    const handler = match.handlers[request.method];
    if (!handler) {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: DEFAULT_CORS });
      return new Response("Method not allowed", { status: 405 });
    }

    return handler(request, { params: Promise.resolve(match.params) });
  },
});

console.log(`routewisp listening on http://${hostname}:${port}`);
