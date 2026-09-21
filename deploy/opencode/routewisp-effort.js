let currentEffort;

export const RoutewispEffort = async () => ({
  config: async (cfg) => {
    const provider = cfg?.provider?.routewisp;
    if (!provider) return;
    provider.options = provider.options || {};
    provider.options.transformRequestBody = (body) => {
      try {
        if (currentEffort && typeof body?.model === "string" && body.model.startsWith("cmc/")) {
          body.reasoning_effort = currentEffort;
        }
      } catch {}
      return body;
    };
  },
  "chat.message": async (input) => {
    if (input?.model?.providerID !== "routewisp") return;
    currentEffort = input.variant || undefined;
  },
});
