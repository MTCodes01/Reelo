const cachea = "SreeCache-v1";
list = []
var appshellfiles = [
    '/index.html',
    '/static/js/app.js',
    '/static/js/sw.js',
    '/static/css/style.css',
    '/maskable_icon_x48.png',
    '/maskable_icon_x72.png',
    '/maskable_icon_x96.png',
    '/maskable_icon_x128.png',
    '/maskable_icon_x192.png',
    '/maskable_icon_x384.png',
    '/maskable_icon_x512.png',
    '/favicon_black.png',
    '/favicon_white.png',
    '/favicon_colour.png'
]
appshellfiles = []
self.addEventListener("install", e => {


    e.waitUntil((async () => {

        const cache = await caches.open(cachea);
        await cache.addAll(appshellfiles);
    })());


});
self.addEventListener("activate", event => {
    console.log("WE ARE GOOGLY BOOGLY WOOGLY");
});

const cacheFirst = async (request) => {
    const responseFromCache = await caches.match(request);
    if (responseFromCache) {
        return responseFromCache;
    }
    return fetch(request);
};

self.addEventListener("fetch", (event) => {
    event.respondWith(cacheFirst(event.request));
});