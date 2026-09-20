import { NextResponse } from "@/lib/nextCompat.js";
import { getProviderConnections } from "@/lib/localDb";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";

export async function GET() {
  const connections = await getProviderConnections({ isActive: true });
  const results = await Promise.all(connections.map(async (c) => {
    const proxyOptions = await resolveConnectionProxyConfig(c.providerSpecificData).catch(() => null);
    const usage = await getUsageForProvider(c, proxyOptions).catch((e) => ({ error: e.message }));
    return {
      id: c.id,
      provider: c.provider,
      name: c.email || c.name || c.provider,
      usage,
    };
  }));
  return NextResponse.json({ connections: results });
}
