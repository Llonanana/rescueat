/* RescuEat 離線快取（Service Worker）
 * 自己網站的檔案「網路優先」：有網路一定拿最新版，沒網路才用上次存下的版本，避免新舊檔案混用。
 * Leaflet 與字型「快取優先」：版本固定，不用每次重抓。
 * 地圖圖磚與 Apps Script 不快取：圖磚太多，品項與預訂必須是即時資料。
 */
const CACHE = "rescueat-v1";
const SHELL = [
  "./", "index.html", "manifest.webmanifest", "css/style.css", "js/config.js", "js/app.js",
  "data/shops.js", "data/listings.js", "data/foods.js", "data/dris.js", "data/recipes.js", "data/stats.js", "data/meals.js",
  "img/logo.png", "img/favicon.png", "img/icons/icon-192.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("index.html"))));
    return;
  }
  if (/^(cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res;
    })));
  }
});
