const CACHE='fenmeat-invoicing-shell-v0241';
const files=['/invoicing/','/invoicing/app.js','/invoicing/styles.css','/invoicing/storage.js','/invoicing/access-ui.js','/invoicing/input-selection.js','/invoicing/app.webmanifest','/invoice-domain.js','/domain.js'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(files)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('fenmeat-invoicing-shell-')&&k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin||!files.includes(u.pathname))return;e.respondWith(caches.open(CACHE).then(async cache=>{const saved=await cache.match(e.request)??await cache.match(u.pathname);if(saved)return saved;return fetch(e.request);}));});
