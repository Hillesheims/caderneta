// Service worker da Caderneta: guarda o app no aparelho para abrir sem internet.
// Os dados (Supabase) nunca passam pelo cache: vão direto para a rede.
const VERSION = "caderneta-196c12c2c6";
const SHELL = [
  "./index.html",
  "./app.css",
  "./app.js",
  "./config.js",
  "./vendor/supabase.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./fonts/bricolage-grotesque-latin-700-normal.woff2",
  "./fonts/figtree-latin-400-normal.woff2",
  "./fonts/figtree-latin-500-normal.woff2",
  "./fonts/figtree-latin-600-normal.woff2",
  "./fonts/ibm-plex-mono-latin-400-normal.woff2",
  "./fonts/ibm-plex-mono-latin-500-normal.woff2"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(VERSION)
      .then(cache => cache.addAll(SHELL.map(u => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith("caderneta-") && k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(staleWhileRevalidate(event, "./index.html"));
  } else if (url.pathname.endsWith("/config.js")) {
    event.respondWith(networkFirst(req));
  } else {
    event.respondWith(staleWhileRevalidate(event, req));
  }
});

// Responde na hora com o que está guardado e atualiza o guardado em segundo plano.
async function staleWhileRevalidate(event, key) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(key, { ignoreSearch: true });
  const network = fetch(key, { cache: "no-cache" })
    .then(res => {
      if (res && res.ok && res.type === "basic") cache.put(key, res.clone());
      return res;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  const res = await network;
  return res || new Response("Sem conexão.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

// Tenta a rede primeiro (para pegar configurações novas) e cai no guardado se estiver offline.
async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req, { cache: "no-cache" });
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await cache.match(req, { ignoreSearch: true });
    return cached || new Response("", { status: 503 });
  }
}
