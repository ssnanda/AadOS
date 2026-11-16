// The session cookie is SameSite=Strict, so a redirect chain that starts at the provider
// (cross-site) reaches the next page without it and lands on the login screen. Answer with a
// small same-site page that forwards on its own: that navigation is same-site, cookie included.
export function oauthLanding(to: string): Response {
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connecting…</title><meta http-equiv="refresh" content="0;url=${to}"><body style="font-family:system-ui;color:#43516c;padding:40px"><p>Finishing up… <a href="${to}">Continue</a></p><script>location.replace(${JSON.stringify(to)})</script></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}
