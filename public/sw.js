/**
 * Service worker for Kentjems Court and Garden.
 *
 * The single most important rule here: NEVER cache a page. Availability is the
 * whole product, and a cached grid would send someone to Kentjems Store to pay
 * for an hour that sold ten minutes ago. Pages are always fetched from the
 * network; if the network is gone the customer sees an honest offline page
 * rather than a stale one that looks fine.
 *
 * Only content-addressed static assets are cached, and those are safe because
 * their filenames change whenever their contents do.
 */

const VERSION = "v1";
const SHELL = `kentjems-shell-${VERSION}`;
const ASSETS = `kentjems-assets-${VERSION}`;
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll([OFFLINE_URL, "/icon-192.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL && key !== ASSETS)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Pages: network only. A stale booking screen is worse than no screen.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((cached) => cached ?? Response.error()),
      ),
    );
    return;
  }

  // Never cache anything from Supabase or our own API — that is live data.
  if (url.pathname.startsWith("/api/")) return;

  // Build output and icons are content-hashed or stable, so cache-first is
  // safe and makes a repeat launch feel instant.
  const cacheable =
    url.pathname.startsWith("/_next/static/") ||
    /\.(?:png|jpg|jpeg|svg|webp|woff2?|ico)$/.test(url.pathname);

  if (!cacheable) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(ASSETS).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
