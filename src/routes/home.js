export async function GET() {
  return new Response(
    "routewisp is running. API: /v1/*, /v1beta/*. OAuth setup: /api/oauth/<provider>/authorize.",
    { headers: { "content-type": "text/plain" } },
  );
}
