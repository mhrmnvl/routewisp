import { getProviderConnections, getSettings } from "@/lib/localDb";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { extractApiKey, isValidApiKey } from "@/sse/services/auth.js";
import { buildQuotaV1Entries } from "@/lib/quotaV1.js";

export async function GET(request) {
  const settings = await getSettings();
  if (settings.requireApiKey) {
    const apiKey = extractApiKey(request);
    if (!apiKey || !(await isValidApiKey(apiKey))) {
      return Response.json(
        { error: { message: "Invalid API key", type: "authentication_error" } },
        { status: 401 },
      );
    }
  }

  let connections = [];
  try {
    connections = await getProviderConnections({ isActive: true });
  } catch (e) {
    console.log("Could not fetch provider connections for quota:", e?.message || e);
  }

  const results = await Promise.all(connections.map(async (connection) => {
    const proxyOptions = await resolveConnectionProxyConfig(connection.providerSpecificData).catch(() => null);
    const usage = await getUsageForProvider(connection, proxyOptions).catch((e) => ({ error: e.message }));
    return { connection, usage };
  }));

  return Response.json({ version: "quota-v1", entries: buildQuotaV1Entries(results) });
}
