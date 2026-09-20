import { readdirSync, statSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";

const API_DIR = join(import.meta.dirname, "app", "api");

function makeNode() {
  return { static: new Map(), dynamic: null, catchAll: null, handlers: null };
}

async function loadRoutes(dir, segments, root) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      await loadRoutes(full, [...segments, entry], root);
      continue;
    }
    if (entry !== "route.js") continue;

    let node = root;
    for (const seg of segments) {
      if (seg.startsWith("[...")) {
        const name = seg.slice(4, -1);
        node.catchAll ??= { name, node: makeNode() };
        node = node.catchAll.node;
      } else if (seg.startsWith("[")) {
        const name = seg.slice(1, -1);
        node.dynamic ??= { name, node: makeNode() };
        node = node.dynamic.node;
      } else {
        if (!node.static.has(seg)) node.static.set(seg, makeNode());
        node = node.static.get(seg);
      }
    }

    const mod = await import(pathToFileURL(full).href);
    node.handlers = mod;
  }
}

export async function buildRouter() {
  const root = makeNode();
  await loadRoutes(API_DIR, [], root);
  return root;
}

// Mirrors next.config.mjs `rewrites()` — applied before matching against the
// /api/* tree built from src/app/api.
const REWRITES = [
  [/^\/v1\/v1(\/.*)?$/, (m) => `/api/v1${m[1] || ""}`],
  [/^\/codex(\/.*)?$/, () => "/api/v1/responses"],
  [/^\/responses$/, () => "/api/v1/responses"],
  [/^\/v1beta(\/.*)?$/, (m) => `/api/v1beta${m[1] || ""}`],
  [/^\/v1(\/.*)?$/, (m) => `/api/v1${m[1] || ""}`],
];

export function rewritePath(pathname) {
  for (const [re, to] of REWRITES) {
    const m = pathname.match(re);
    if (m) return to(m);
  }
  return pathname;
}

// Walks the trie for `/api/...` paths, preferring static > dynamic > catch-all
// at each level (same precedence Next.js uses for colliding route shapes).
export function matchRoute(root, pathname) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "api") return null;

  function walk(node, i, params) {
    if (i === segments.length) {
      return node.handlers ? { handlers: node.handlers, params } : null;
    }
    const seg = segments[i];
    if (node.static.has(seg)) {
      const hit = walk(node.static.get(seg), i + 1, params);
      if (hit) return hit;
    }
    if (node.dynamic) {
      const hit = walk(node.dynamic.node, i + 1, { ...params, [node.dynamic.name]: seg });
      if (hit) return hit;
    }
    if (node.catchAll) {
      return node.catchAll.node.handlers
        ? { handlers: node.catchAll.node.handlers, params: { ...params, [node.catchAll.name]: segments.slice(i) } }
        : null;
    }
    return null;
  }

  return walk(root, 1, {});
}
