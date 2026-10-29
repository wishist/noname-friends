// SPDX-License-Identifier: GPL-3.0-only
// Static game resources only. No navigation, room traffic, settings or filesystem APIs are cached.
const META_CACHE = 'noname-friends-meta-v1';
const ASSET_CACHE = 'noname-friends-assets-v1';
const CACHE_ROOT = '/__noname-friends-cache__/';
const HASH = /^[a-f0-9]{64}$/;
const bindings = new Map();
const manifests = new Map();
const pending = new Map();
let generation = 0;
let lastUsedAt = 0;
let maintenance = Promise.resolve();

function internalPath(kind, value) {
  return new URL(`${CACHE_ROOT}${kind}/${encodeURIComponent(value)}`, self.location.origin).href;
}
function contentKey(path, hash) {
  return internalPath('content', hash) + '?asset=' + encodeURIComponent(path);
}
function allowedAsset(path) {
  if (typeof path !== 'string' || /[\\\0?#%]/.test(path) || !path.startsWith('/')) return false;
  const parts = path.split('/');
  if (parts.some((part, index) => part.startsWith('.') && !(part === '.pnpm' && parts[index - 1] === 'node_modules'))) return false;
  if (!/\.(?:m?js|json|css|woff2?|ttf|otf)$/.test(path)) return false;
  return path === '/noname.js' || path === '/preload.js' || /^\/(?:noname|node_modules|_virtual|mode|card|character|game|layout|theme|font)\//.test(path);
}
async function digest(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function readMetadata(kind, value) {
  try {
    const response = await (await caches.open(META_CACHE)).match(internalPath(kind, value));
    return response ? await response.json() : null;
  } catch { return null; }
}
async function writeMetadata(kind, value, data) {
  try { await (await caches.open(META_CACHE)).put(internalPath(kind, value), new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })); }
  catch { /* Private browsing or a full cache must not prevent online play. */ }
}
async function getManifest(clientId) {
  if (!clientId) return null;
  let version = bindings.get(clientId);
  if (!version) {
    const stored = await readMetadata('client', clientId);
    if (!stored || !HASH.test(stored.version)) return null;
    version = stored.version;
    bindings.set(clientId, version);
  }
  if (!manifests.has(version)) {
    const stored = await readMetadata('manifest', version);
    if (!stored?.assets || stored.version !== version) return null;
    manifests.set(version, stored);
  }
  return manifests.get(version);
}
async function configure(clientId, manifestURL) {
  const url = new URL(manifestURL, self.location.origin);
  const match = /^\/friends-cache-manifests\/([a-f0-9]{64})\.json$/.exec(url.pathname);
  if (url.origin !== self.location.origin || url.search || url.hash || !match) throw new Error('无效的游戏资源版本地址');
  let manifest;
  try {
    const response = await fetch(url.href, { cache: 'no-cache', credentials: 'same-origin', redirect: 'error' });
    if (!response.ok) throw new Error('无法读取游戏资源版本');
    manifest = await response.json();
  } catch (error) {
    // This exact version was validated before; a transient network failure need not discard it.
    manifest = manifests.get(match[1]) || await readMetadata('manifest', match[1]);
    if (!manifest) throw error;
  }
  if (manifest?.version !== match[1] || !manifest.assets || typeof manifest.assets !== 'object' || Array.isArray(manifest.assets)) throw new Error('游戏资源清单格式无效');
  const assets = Object.entries(manifest.assets);
  if (!assets.length || assets.length > 10000 || assets.some(([path, hash]) => !allowedAsset(path) || typeof hash !== 'string' || !HASH.test(hash))) throw new Error('游戏资源清单包含不支持的路径');
  if (await digest(new TextEncoder().encode(JSON.stringify(manifest.assets))) !== manifest.version) throw new Error('游戏资源清单校验失败');
  lastUsedAt = Math.max(Date.now(), lastUsedAt + 1);
  const saved = { version: manifest.version, assets: manifest.assets, usedAt: lastUsedAt };
  manifests.set(saved.version, saved);
  bindings.set(clientId, saved.version);
  await writeMetadata('manifest', saved.version, saved);
  await writeMetadata('client', clientId, { version: saved.version });
  let cached = 0;
  try {
    const keys = new Set((await (await caches.open(ASSET_CACHE)).keys()).map(key => key.url));
    cached = assets.filter(([path, hash]) => keys.has(contentKey(path, hash))).length;
  } catch { /* A valid manifest also works without persistent storage. */ }
  return { ok: true, cached, total: assets.length };
}
async function report(clientId, source, path) {
  try { (await self.clients.get(clientId))?.postMessage({ type: 'friends-cache-progress', source, path }); } catch {}
}
async function loadAsset(request, path, hash) {
  const key = contentKey(path, hash);
  const before = generation;
  let cache;
  try {
    cache = await caches.open(ASSET_CACHE);
    const response = await cache.match(key);
    if (response) return { response, source: 'cache' };
  } catch {}
  if (pending.has(key)) {
    const result = await pending.get(key);
    return { response: result.response.clone(), source: result.source };
  }
  const task = (async () => {
    const response = await fetch(request, { cache: 'no-cache', redirect: 'error' });
    if (response.status !== 200 || response.type === 'opaque') return { response, source: 'network' };
    if (await digest(await response.clone().arrayBuffer()) !== hash) {
      return { response: new Response('游戏资源已经更新，请重新加载页面后再进入房间。', { status: 409, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } }), source: 'network' };
    }
    if (cache && before === generation) {
      try { await cache.put(key, response.clone()); } catch { /* Quota failure: return verified network content. */ }
    }
    return { response, source: 'network' };
  })();
  pending.set(key, task);
  try {
    const result = await task;
    return { response: result.response.clone(), source: result.source };
  } finally { if (pending.get(key) === task) pending.delete(key); }
}
async function serve(request, clientId, path) {
  const manifest = await getManifest(clientId);
  const hash = manifest?.assets[path];
  if (!hash) return fetch(request);
  const result = await loadAsset(request, path, hash);
  await report(clientId, result.source, path);
  return result.response;
}

async function prune() {
  try {
    const openClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const liveIds = new Set(openClients.map(client => client.id));
    const keep = new Set();
    for (const client of openClients) {
      const manifest = await getManifest(client.id);
      if (manifest) keep.add(manifest.version);
    }
    const metadata = await caches.open(META_CACHE);
    const saved = [];
    for (const request of await metadata.keys()) {
      const path = new URL(request.url).pathname;
      if (path.startsWith(`${CACHE_ROOT}manifest/`)) {
        const value = await (await metadata.match(request)).json();
        saved.push({ request, value });
        lastUsedAt = Math.max(lastUsedAt, value.usedAt || 0);
      } else if (path.startsWith(`${CACHE_ROOT}client/`) && !liveIds.has(decodeURIComponent(path.slice(`${CACHE_ROOT}client/`.length)))) {
        await metadata.delete(request);
      }
    }
    saved.sort((a, b) => b.value.usedAt - a.value.usedAt);
    saved.slice(0, 2).forEach(item => keep.add(item.value.version));
    const contentToKeep = new Set();
    for (const { request, value } of saved) {
      if (!keep.has(value.version)) { await metadata.delete(request); manifests.delete(value.version); continue; }
      for (const [path, hash] of Object.entries(value.assets)) contentToKeep.add(contentKey(path, hash));
    }
    // In-memory bindings remain valid when quota exhaustion prevented metadata writes.
    for (const version of keep) {
      for (const [path, hash] of Object.entries(manifests.get(version)?.assets || {})) contentToKeep.add(contentKey(path, hash));
    }
    for (const id of bindings.keys()) if (!liveIds.has(id)) bindings.delete(id);
    const assets = await caches.open(ASSET_CACHE);
    for (const request of await assets.keys()) if (!contentToKeep.has(request.url)) await assets.delete(request);
  } catch { /* Cache maintenance must never interrupt a game. */ }
}

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim().then(prune)));
self.addEventListener('message', event => {
  const port = event.ports?.[0];
  if (!port || !event.source?.id) return;
  try { if (new URL(event.source.url).origin !== self.location.origin) return; } catch { return; }
  if (!['friends-cache-configure', 'friends-cache-clear'].includes(event.data?.type)) return;
  const job = maintenance.then(async () => {
    try {
      if (event.data.type === 'friends-cache-clear') {
        generation++; pending.clear();
        // Other tabs must retain their pinned version, even after resource data is cleared.
        // If their old bytes no longer exist on the server they will get 409, never mixed code.
        await caches.delete(ASSET_CACHE);
        port.postMessage({ ok: true });
      } else {
        port.postMessage(await configure(event.source.id, event.data.manifestURL));
        await prune();
      }
    } catch (error) { port.postMessage({ ok: false, error: error.message }); }
  });
  maintenance = job.catch(() => {});
  event.waitUntil(job);
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode === 'navigate' || !event.clientId) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.search) return;
  let path;
  try { path = decodeURIComponent(url.pathname); } catch { return; }
  if (!allowedAsset(path)) return;
  event.respondWith(serve(request, event.clientId, path));
});
