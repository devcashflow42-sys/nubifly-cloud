// Serves home.html at /home without going through _redirects.
// Bypasses any potential redirect loop caused by Cloudflare routing.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  url.pathname = '/home.html';
  return env.ASSETS.fetch(url.toString());
}
