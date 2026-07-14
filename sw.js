'use strict';

// Naikkan versi ini kalau ada perubahan besar di app shell, supaya browser
// tau harus ambil ulang semua file-nya (bukan pakai cache lama).
const CACHE_NAME = 'mytbl-box-shell-v4';

const APP_SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './manifest.webmanifest',
  './fonts/plus-jakarta-sans-latin-400-normal.woff2',
  './fonts/plus-jakarta-sans-latin-500-normal.woff2',
  './fonts/plus-jakarta-sans-latin-600-normal.woff2',
  './fonts/plus-jakarta-sans-latin-700-normal.woff2',
  './fonts/plus-jakarta-sans-latin-800-normal.woff2',
  './fonts/baloo-2-latin-500-normal.woff2',
  './fonts/baloo-2-latin-600-normal.woff2',
  './fonts/baloo-2-latin-700-normal.woff2',
  './fonts/baloo-2-latin-800-normal.woff2',
  './fonts/lora-latin-400-normal.woff2',
  './fonts/lora-latin-500-normal.woff2',
  './fonts/lora-latin-600-normal.woff2',
  './fonts/lora-latin-700-normal.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
  './vendor/tesseract/tesseract.min.js',
  './vendor/tesseract/worker.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Strategi: app shell (file lokal) pakai cache-first supaya cepat & bisa
// offline. Request ke API eksternal (Jikan/Google Books/gambar dari
// internet) dibiarkan lewat langsung ke network — tidak ikut di-cache,
// karena datanya memang harus selalu yang terbaru & bukan bagian dari
// "aplikasinya", cuma data pelengkap.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;

  if (!isSameOrigin || event.request.method !== 'GET') {
    return; // biarkan browser handle langsung (network normal)
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
