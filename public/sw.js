/*
 * Anti-Timeout service worker: makes the installed app start fast and work
 * without a connection after the first visit, and receives videos shared into
 * the app from other apps (Android "Share -> Anti-Timeout").
 *
 * - Pages: network first (always the latest version when online), the last
 *   copy when offline.
 * - Build assets (/_next/static, hashed): cache first.
 * - The video engine, speech, face-tracking and fonts (tens of MB): served
 *   from the phone, refreshed in the background, so they're downloaded once
 *   instead of on every visit.
 * Cached responses keep their headers, so the editor stays cross-origin
 * isolated offline too. API calls, sign-in and video byte ranges are never
 * cached.
 */
const VERSION = "v1";
const STATIC = `static-${VERSION}`;
const ENGINE = `engine-${VERSION}`;
const PAGES = `pages-${VERSION}`;
const ENGINE_PATHS = /^\/(ffmpeg|vendor|models|fonts|workers)\//;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC, ENGINE, PAGES]);
      for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.method === "POST" && url.pathname === "/share-target") {
    event.respondWith(receiveShare(req));
    return;
  }
  if (req.method !== "GET" || req.headers.has("range")) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/") || url.pathname === "/sw.js") return;
  if (url.pathname.startsWith("/_next/static/")) return event.respondWith(cacheFirst(req, STATIC));
  if (ENGINE_PATHS.test(url.pathname)) return event.respondWith(staleWhileRevalidate(req, ENGINE));
  if (req.mode === "navigate") return event.respondWith(networkFirst(req));
});

const cacheable = (res) => res && res.ok && res.type === "basic" && !res.redirected;

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (cacheable(res)) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  const update = fetch(req)
    .then((res) => {
      if (cacheable(res)) cache.put(req, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || update;
}

async function networkFirst(req) {
  const cache = await caches.open(PAGES);
  try {
    const res = await fetch(req);
    if (cacheable(res)) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req)) || (await cache.match("/editor")) || Response.error();
  }
}

/* Videos shared into the app: kept in IndexedDB until the editor picks them up. */
function db() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("anti-timeout-share", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("files");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

async function receiveShare(req) {
  try {
    const form = await req.formData();
    const files = form.getAll("videos").filter((f) => f instanceof File && f.size > 0);
    const store = (await db()).transaction("files", "readwrite").objectStore("files");
    await new Promise((resolve, reject) => {
      const put = store.put(files, "pending");
      put.onsuccess = resolve;
      put.onerror = () => reject(put.error);
    });
    return Response.redirect(`/editor?shared=${files.length}`, 303);
  } catch {
    return Response.redirect("/editor?shared=0", 303);
  }
}
