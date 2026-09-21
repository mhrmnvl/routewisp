#!/usr/bin/env node
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import open from "open";

const CONFIG_PATH = join(homedir(), ".routewisp", "cli.json");

const OPENCODE_PLUGIN_SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "deploy", "opencode", "routewisp-effort.js");
const OPENCODE_VARIANTS = ["none", "low", "medium", "high", "xhigh", "max"];

function opencodeTargets(project) {
  if (project) {
    return {
      configPath: join(process.cwd(), "opencode.json"),
      pluginPath: join(process.cwd(), ".opencode", "plugin", "routewisp-effort.js"),
    };
  }
  const configDir = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode");
  return {
    configPath: join(configDir, "opencode.json"),
    pluginPath: join(configDir, "plugins", "routewisp-effort.js"),
  };
}

function buildOpencodeModels(modelIds) {
  const variants = Object.fromEntries(OPENCODE_VARIANTS.map((v) => [v, { reasoningEffort: v }]));
  const models = {};
  for (const id of modelIds) {
    models[id] = id.startsWith("cmc/")
      ? { interleaved: { field: "reasoning_content" }, variants }
      : {};
  }
  return models;
}

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  mkdirSync(join(homedir(), ".routewisp"), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function resolveConn(flags) {
  const cfg = loadConfig();
  const apiUrl = flags["api-url"] || process.env.NINEROUTER_API_URL || cfg.apiUrl || "http://localhost:20128";
  const token = flags.token || process.env.NINEROUTER_ADMIN_TOKEN || cfg.token || "";
  return { apiUrl: apiUrl.replace(/\/$/, ""), token };
}

async function call(conn, method, path, body) {
  const res = await fetch(`${conn.apiUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(conn.token ? { Authorization: `Bearer ${conn.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

// Opens the given URL in a browser, catches the single OAuth redirect on a
// local loopback port (works from any machine — the port only needs to be
// reachable by the browser that opens `authUrl`, not by the router), then
// forwards the code to the router's exchange endpoint.
function waitForCallback(port) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html><body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh">
<div style="text-align:center;padding:2rem">
  <p style="font-size:1.25rem">Done — you can close this tab.</p>
</div>
</body></html>`);
      server.close();
      const error = url.searchParams.get("error");
      if (error) return reject(new Error(url.searchParams.get("error_description") || error));
      resolve({
        code: url.searchParams.get("code") || url.searchParams.get("token"),
        state: url.searchParams.get("state"),
      });
    });
    server.listen(port);
    setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for the OAuth redirect (5 min)"));
    }, 5 * 60 * 1000);
  });
}

const commands = {
  async "config:set"({ flags }) {
    const cfg = loadConfig();
    if (flags["api-url"]) cfg.apiUrl = flags["api-url"];
    if (flags.token) cfg.token = flags.token;
    saveConfig(cfg);
    console.log(`Saved to ${CONFIG_PATH}`);
  },

  async "keys:create"({ positional, flags }) {
    const conn = resolveConn(flags);
    const data = await call(conn, "POST", "/api/keys", { name: positional[0] || "cli" });
    console.log(`API key: ${data.key}`);
  },

  async "keys:list"({ flags }) {
    const conn = resolveConn(flags);
    const data = await call(conn, "GET", "/api/keys");
    for (const k of data.keys || []) console.log(`${k.id}  ${k.name}  ${k.isActive === false ? "disabled" : "active"}`);
  },

  async "providers:add"({ positional, flags }) {
    const conn = resolveConn(flags);
    const provider = positional[0];
    if (!provider || !flags["api-key"]) throw new Error("usage: providers add <provider> --api-key <key> [--name <name>]");
    const data = await call(conn, "POST", "/api/providers", {
      provider,
      apiKey: flags["api-key"],
      name: flags.name || provider,
    });
    console.log(`Connected: ${data.connection.provider} (${data.connection.id})`);
  },

  async "providers:list"({ flags }) {
    const conn = resolveConn(flags);
    const data = await call(conn, "GET", "/api/providers");
    for (const c of data.connections || data || []) console.log(`${c.id}  ${c.provider}  ${c.name}  ${c.isActive === false ? "disabled" : "active"}`);
  },

  async "providers:login"({ positional, flags }) {
    const conn = resolveConn(flags);
    const provider = positional[0];
    if (!provider) throw new Error("usage: providers login <provider>");
    const port = Number(flags.port) || 8765;
    const redirectUri = `http://localhost:${port}/callback?provider=${provider}`;
    // generateAuthData always mints a PKCE codeVerifier and the generic /exchange
    // handler requires it back verbatim (most providers use it; antigravity's own
    // exchange ignores it but the shared gate still checks it's present).
    const { authUrl, codeVerifier } = await call(
      conn,
      "GET",
      `/api/oauth/${encodeURIComponent(provider)}/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`,
    );
    console.log(`Opening browser for ${provider} login...`);
    console.log(authUrl);
    open(authUrl).catch(() => {});
    const { code, state } = await waitForCallback(port);
    const data = await call(conn, "POST", `/api/oauth/${encodeURIComponent(provider)}/exchange`, { code, state, redirectUri, codeVerifier });
    console.log(`Connected: ${data.connection?.email || data.connection?.displayName || provider}`);
  },

  async models({ flags }) {
    const conn = resolveConn(flags);
    const data = await call(conn, "GET", "/v1/models");
    for (const m of data.data || []) console.log(m.id);
  },

  async "combos:add"({ positional, flags }) {
    const conn = resolveConn(flags);
    const [name, modelsCsv] = positional;
    if (!name || !modelsCsv) throw new Error("usage: combos add <name> <model1,model2,...> [--strategy fallback|fusion]");
    const data = await call(conn, "POST", "/api/combos", {
      name,
      models: modelsCsv.split(",").map((m) => m.trim()),
      fallbackStrategy: flags.strategy || "fallback",
    });
    console.log(`Combo created: ${data.combo?.name || name}`);
  },

  async "combos:list"({ flags }) {
    const conn = resolveConn(flags);
    const data = await call(conn, "GET", "/api/combos");
    for (const c of data.combos || data || []) console.log(`${c.name}  ${(c.models || []).join(", ")}`);
  },

  async "opencode:install"({ flags }) {
    const conn = resolveConn(flags);
    const project = flags.project === true;

    const modelsData = await call(conn, "GET", "/v1/models");
    const modelIds = (modelsData.data || []).map((m) => m.id).filter(Boolean);
    if (modelIds.length === 0) throw new Error("gateway returned no models — add a provider first (routewisp providers login/add)");

    const { configPath, pluginPath } = opencodeTargets(project);
    let cfg = {};
    try { cfg = JSON.parse(readFileSync(configPath, "utf8")); } catch {}
    let prevKey = cfg.provider?.routewisp?.options?.apiKey;
    if (prevKey) {
      try {
        const keysData = await call(conn, "GET", "/api/keys");
        if (!(keysData.keys || []).some((k) => k.isActive && k.key === prevKey)) prevKey = undefined;
      } catch {}
    }

    const explicitKey = flags["api-key"] || process.env.ROUTEWISP_API_KEY || "";
    let apiKey = explicitKey || prevKey || "";
    let created = false;
    if (!apiKey) {
      const data = await call(conn, "POST", "/api/keys", { name: "opencode" });
      apiKey = data.key;
      created = true;
    }
    const useEnvRef = !flags["api-key"] && (!!process.env.ROUTEWISP_API_KEY || !prevKey);

    cfg.provider = cfg.provider || {};
    cfg.provider.routewisp = {
      npm: "@ai-sdk/openai-compatible",
      name: "routewisp",
      options: {
        baseURL: `${conn.apiUrl}/v1`,
        apiKey: useEnvRef ? "{env:ROUTEWISP_API_KEY}" : apiKey,
      },
      models: buildOpencodeModels(modelIds),
    };
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n");
    mkdirSync(dirname(pluginPath), { recursive: true });
    copyFileSync(OPENCODE_PLUGIN_SRC, pluginPath);

    console.log(`Provider + ${modelIds.length} models → ${configPath}`);
    console.log(`Plugin → ${pluginPath}`);
    if (created) console.log(`\nCreated API key: ${apiKey}`);
    console.log(`\nNext:`);
    if (useEnvRef) console.log(`  export ROUTEWISP_API_KEY=${apiKey}`);
    console.log(`  restart opencode`);
    if (project) console.log(`  gitignore: opencode.json .opencode/ (so the key reference / local plugin never lands in the repo)`);
  },

  async quota({ flags }) {
    const conn = resolveConn(flags);
    const data = await call(conn, "GET", "/api/quota");
    for (const c of data.connections || []) {
      console.log(`\n${c.provider} — ${c.name}`);
      if (c.usage?.error || c.usage?.message) {
        console.log(`  ${c.usage.error || c.usage.message}`);
        continue;
      }
      for (const [name, q] of Object.entries(c.usage?.quotas || {})) {
        const pct = q.remainingPercentage != null
          ? `${q.remainingPercentage.toFixed(1)}% left`
          : q.remaining != null ? `${q.remaining.toFixed(2)}/${q.total} left` : "";
        const reset = q.resetAt ? `resets ${new Date(q.resetAt).toLocaleString()}` : "";
        console.log(`  ${(q.displayName || name).padEnd(28)} ${pct.padEnd(14)} ${reset}`);
      }
    }
  },
};

async function main() {
  const [cmd, sub, ...rest] = process.argv.slice(2);
  const key = sub && commands[`${cmd}:${sub}`] ? `${cmd}:${sub}` : cmd;
  const argv = commands[`${cmd}:${sub}`] ? rest : [sub, ...rest].filter(Boolean);
  const fn = commands[key];
  if (!fn) {
    console.log("Usage: routewisp <config set|keys create|keys list|providers add|providers list|providers login|models|quota|combos add|combos list|opencode install [--global|--project] [--api-key sk-...]> [args] [--api-url URL] [--token TOKEN]");
    process.exit(1);
  }
  try {
    await fn(parseArgs(argv));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
