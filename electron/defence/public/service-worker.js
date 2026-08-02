const CACHE='defence-copilot-v4'; const ASSETS=['/','/app.js?v=4','/styles.css?v=4','/manifest.webmanifest?v=4'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))));
self.addEventListener('fetch',event=>{if(event.request.method==='GET'&&!event.request.url.includes('/api/'))event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));});
