// No dashboard is running to catch this via postMessage, so the page completes
// the exchange itself with a small inline script. The `authorize` call must be
// started with `redirect_uri` set to this exact page + `?provider=<id>` (see
// SETUP.md) — that same string (minus code/state/error, appended by Google/etc.)
// is resent to /api/oauth/<provider>/exchange so it matches what was registered.
export async function GET(request) {
  const html = `<!doctype html>
<html><body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh">
<div id="status" style="text-align:center;max-width:32rem;padding:2rem">Completing authorization...</div>
<script>
(function () {
  var params = new URLSearchParams(location.search);
  var provider = params.get("provider");
  var code = params.get("code") || params.get("token");
  var state = params.get("state");
  var codeVerifier = params.get("cv");
  var error = params.get("error");
  var el = document.getElementById("status");

  if (error) {
    el.textContent = "Authorization failed: " + (params.get("error_description") || error);
    return;
  }
  if (!provider || !code) {
    el.innerHTML = "Missing provider/code. Copy this URL and check SETUP.md:<br><code style='word-break:break-all'>" + location.href + "</code>";
    return;
  }

  var url = new URL(location.href);
  ["code", "token", "state", "error", "error_description"].forEach(function (k) { url.searchParams.delete(k); });

  fetch("/api/oauth/" + encodeURIComponent(provider) + "/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: code, state: state, redirectUri: url.toString(), codeVerifier: codeVerifier }),
  })
    .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
    .then(function (r) {
      if (!r.ok) throw new Error(r.data && r.data.error || "Exchange failed");
      el.textContent = "Connected: " + (r.data.connection && (r.data.connection.email || r.data.connection.displayName) || provider) + ". You can close this tab.";
    })
    .catch(function (err) { el.textContent = "Authorization failed: " + err.message; });
})();
</script>
</body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
