const CACHE_NAME = "clima-shell-v10";
const APP_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./storageService.js",
  "./geoService.js",
  "./weatherService.js",
  "./notificationService.js",
  "./manifest.webmanifest",
  "./pwa-install.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith("clima-shell-") && cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const requestUrl = new URL(request.url);
  if (request.method !== "GET" || requestUrl.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy)));
          }
          return response;
        })
        .catch(async () => {
          const cachedPage = await caches.match(request);
          const cachedIndex = cachedPage || await caches.match("./index.html");
          if (cachedIndex) return cachedIndex;
          throw new Error("No hay una página de la aplicación disponible sin conexión.");
        })
    );
    return;
  }

  event.respondWith((async () => {
    const cachedResponse = await caches.match(request);
    try {
      const response = await fetch(request);
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
      }
      return response;
    } catch (error) {
      if (cachedResponse) return cachedResponse;
      throw error;
    }
  })());
});
