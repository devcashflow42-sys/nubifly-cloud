// Serves login.html at /register (registration uses the same page as login).
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  url.pathname = '/login.html';
  return env.ASSETS.fetch(url.toString());
}
