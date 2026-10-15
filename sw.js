/* Match Fit service worker: lets the app open with no signal.
   - App pages and icons: network first (so updates arrive), cached copy when the network is slow or gone.
   - Fonts and the Supabase script: cached after first use.
   - Supabase data (sessions, drills, games) is NOT cached here. The one offline copy kept on the device is the next planned session, saved by the app itself in localStorage and removed once its date has passed.
   Nothing is written to Supabase from here. Bump VER to force a refresh of everything. */
const VER = "v9";
const SHELL = "matchfit-shell-" + VER;
const FILES = ["./", "index.html", "session-block-library.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
const SCRIPT = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await Promise.allSettled(FILES.map(f => c.add(f)).concat([c.add(new Request(SCRIPT, { mode: "cors" }))]));
    self.skipWaiting();
  })());
});
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    // Removes the old data cache from earlier versions as well.
    for(const k of await caches.keys()) if(k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function networkFirst(req, cacheName, ms, key){
  const cache = await caches.open(cacheName);
  const net = fetch(req).then(r => { if(r && r.ok) cache.put(key || req, r.clone()); return r; });
  net.catch(() => {});
  try{
    return await Promise.race([net, new Promise((_, rej) => setTimeout(rej, ms))]);
  }catch(err){
    const hit = await cache.match(key || req, { ignoreVary: true });
    return hit || net;
  }
}
async function staleWhileRevalidate(req){
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req);
  const net = fetch(req).then(r => { if(r && (r.ok || r.type === "opaque")) cache.put(req, r.clone()); return r; }).catch(() => hit);
  return hit || net;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);
  // The film streams straight from the network: video uses partial (range) requests, which can't be cached, and it shouldn't take up space on the phone.
  if(req.destination === "video" || req.headers.has("range") || /\.mp4$/i.test(url.pathname)) return;
  if(req.mode === "navigate"){
    const key = new Request(url.origin + url.pathname);
    e.respondWith(networkFirst(req, SHELL, 4000, key).then(async r => {
      if(r && (r.ok || r.type === "opaque")) return r;
      return (await caches.match(key)) || (await caches.match("index.html")) || r;
    }).catch(async () => (await caches.match(key)) || (await caches.match("index.html"))));
  } else if(url.origin === location.origin){
    e.respondWith(networkFirst(req, SHELL, 4000));
  } else if(url.hostname === "cdn.jsdelivr.net" || url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com"){
    e.respondWith(staleWhileRevalidate(req));
  }
});
