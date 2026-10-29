import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';

const source = await readFile(new URL('../friends-ui/cache-worker.js', import.meta.url), 'utf8');
const origin = 'https://game.example';
const hash = value => createHash('sha256').update(value).digest('hex');
const js = text => new Response(text, { headers: { 'Content-Type': 'text/javascript' } });

class MemoryCache {
  data = new Map();
  key(request) { return typeof request === 'string' ? request : request.url; }
  async match(request) { return this.data.get(this.key(request))?.clone(); }
  async put(request, response) { this.data.set(this.key(request), response.clone()); }
  async keys() { return [...this.data.keys()].map(url => new Request(url)); }
  async delete(request) { return this.data.delete(this.key(request)); }
}
function cacheStorage() {
  const storage = new Map();
  return {
    storage,
    async open(name) { if (!storage.has(name)) storage.set(name, new MemoryCache()); return storage.get(name); },
    async delete(name) { return storage.delete(name); },
  };
}
function fixture({ caches = cacheStorage(), assets = {} } = {}) {
  const handlers = new Map(), responses = new Map(Object.entries(assets)), calls = [], messages = [];
  const clients = new Map([['one', { id: 'one', url: origin + '/?friends=1', postMessage: value => messages.push(value) }]]);
  let claimed = 0, skipped = 0;
  const context = vm.createContext({
    URL, Request, Response, TextEncoder, Uint8Array, Map, Set, Date, crypto: webcrypto, caches,
    fetch: async (input, options) => {
      const url = typeof input === 'string' ? input : input.url;
      calls.push({ url, options });
      const answer = responses.get(url);
      return typeof answer === 'function' ? answer() : answer?.clone() || new Response('missing', { status: 404 });
    },
    self: {
      location: { origin },
      addEventListener: (name, handler) => handlers.set(name, handler),
      skipWaiting: async () => { skipped++; },
      clients: {
        get: async id => clients.get(id),
        matchAll: async () => [...clients.values()],
        claim: async () => { claimed++; },
      },
    },
  });
  vm.runInContext(source, context);
  const registerManifest = bodies => {
    const assets = Object.fromEntries(Object.entries(bodies).map(([path, body]) => [path, hash(body)]));
    const version = hash(JSON.stringify(assets));
    const manifest = { version, assets };
    const url = '/friends-cache-manifests/' + version + '.json';
    responses.set(origin + url, new Response(JSON.stringify(manifest)));
    for (const [path, body] of Object.entries(bodies)) responses.set(origin + path, js(body));
    return { url, manifest };
  };
  const message = async (data, id = 'one') => {
    let job, result;
    handlers.get('message')({ data, source: clients.get(id), ports: [{ postMessage: value => { result = value; } }], waitUntil: promise => { job = promise; } });
    await job;
    return result;
  };
  const request = async (path, { id = 'one', method = 'GET', navigation = false } = {}) => {
    let result;
    const request = new Request(new URL(path, origin), { method });
    if (navigation) Object.defineProperty(request, 'mode', { value: 'navigate' });
    handlers.get('fetch')({ request, clientId: id, respondWith: promise => { result = promise; } });
    return result ? { intercepted: true, response: await result } : { intercepted: false };
  };
  const lifecycle = async name => { let job; handlers.get(name)({ waitUntil: promise => { job = promise; } }); await job; };
  return { caches, clients, calls, messages, responses, registerManifest, message, request, lifecycle, claimed: () => claimed, skipped: () => skipped };
}

test('first resource downloads once, subsequent visits use the same verified cached body', async () => {
  const f = fixture();
  const m = f.registerManifest({ '/noname/entry.js': 'export const ready=true;' });
  const setup = await f.message({ type: 'friends-cache-configure', manifestURL: m.url });
  assert.equal(setup.ok, true); assert.equal(setup.cached, 0);
  assert.equal(await (await f.request('/noname/entry.js')).response.text(), 'export const ready=true;');
  const nextSetup = await f.message({ type: 'friends-cache-configure', manifestURL: m.url });
  assert.equal(nextSetup.cached, 1);
  assert.equal(await (await f.request('/noname/entry.js')).response.text(), 'export const ready=true;');
  assert.equal(f.calls.filter(call => call.url.endsWith('/noname/entry.js')).length, 1);
  assert.deepEqual(f.messages.map(value => value.source), ['network', 'cache']);
});

test('new versions reuse unchanged resources while open clients stay pinned to their old version', async () => {
  const f = fixture();
  const old = f.registerManifest({ '/noname/entry.js': 'old', '/card/standard.js': 'unchanged' });
  await f.message({ type: 'friends-cache-configure', manifestURL: old.url });
  await f.request('/noname/entry.js'); await f.request('/card/standard.js');
  const current = f.registerManifest({ '/noname/entry.js': 'new', '/card/standard.js': 'unchanged' });
  f.clients.set('two', { id: 'two', url: origin + '/?friends=1', postMessage() {} });
  const setup = await f.message({ type: 'friends-cache-configure', manifestURL: current.url }, 'two');
  assert.equal(setup.cached, 1);
  assert.equal(await (await f.request('/noname/entry.js', { id: 'two' })).response.text(), 'new');
  assert.equal(await (await f.request('/noname/entry.js')).response.text(), 'old');
  await f.request('/card/standard.js', { id: 'two' });
  assert.equal(f.calls.filter(call => call.url.endsWith('/card/standard.js')).length, 1);
});

test('client bindings and cached resources survive a service worker restart', async () => {
  const f = fixture();
  const m = f.registerManifest({ '/mode/connect.js': 'connect' });
  await f.message({ type: 'friends-cache-configure', manifestURL: m.url });
  await f.request('/mode/connect.js');
  const restart = fixture({ caches: f.caches });
  assert.equal(await (await restart.request('/mode/connect.js')).response.text(), 'connect');
  assert.equal(restart.calls.length, 0);
});

test('a saved exact-version manifest survives a transient manifest network failure', async () => {
  const f = fixture();
  const m = f.registerManifest({ '/mode/connect.js': 'connect' });
  await f.message({ type: 'friends-cache-configure', manifestURL: m.url });
  await f.request('/mode/connect.js');
  const restart = fixture({ caches: f.caches });
  restart.responses.set(origin + m.url, () => { throw new Error('Offline'); });
  const setup = await restart.message({ type: 'friends-cache-configure', manifestURL: m.url });
  assert.equal(setup.ok, true); assert.equal(setup.cached, 1);
  assert.equal(await (await restart.request('/mode/connect.js')).response.text(), 'connect');
});

test('missing or changed network responses are never saved under an expected old hash', async () => {
  const f = fixture();
  const m = f.registerManifest({ '/character/standard.js': 'expected' });
  await f.message({ type: 'friends-cache-configure', manifestURL: m.url });
  f.responses.set(origin + '/character/standard.js', js('unexpected new build'));
  assert.equal((await f.request('/character/standard.js')).response.status, 409);
  f.responses.delete(origin + '/character/standard.js');
  assert.equal((await f.request('/character/standard.js')).response.status, 404);
  f.responses.set(origin + '/character/standard.js', js('expected'));
  assert.equal(await (await f.request('/character/standard.js')).response.text(), 'expected');
  await f.request('/character/standard.js');
  assert.equal(f.calls.filter(call => call.url.endsWith('/character/standard.js')).length, 3);
});

test('API, navigation, cross-origin, query and non-GET traffic remain untouched', async () => {
  const f = fixture();
  const m = f.registerManifest({ '/noname/entry.js': 'body' });
  await f.message({ type: 'friends-cache-configure', manifestURL: m.url });
  for (const [path, options] of [
    ['/api/friends/config', {}], ['/relay', {}], ['/readFile', {}], ['/friends/app.js', {}],
    ['/?friends=1', { navigation: true }], ['/noname/entry.js?custom=1', {}],
    ['https://elsewhere.example/noname/entry.js', {}], ['/noname/entry.js', { method: 'HEAD' }],
    ['/noname/entry.js', { method: 'POST' }], ['/src/noname/entry.js', {}],
  ]) assert.equal((await f.request(path, options)).intercepted, false, path);
  await f.request('/noname/entry.js', { id: 'unconfigured' });
  await f.request('/noname/entry.js', { id: 'unconfigured' });
  assert.equal(f.calls.filter(call => call.url.endsWith('/noname/entry.js')).length, 2);
});

test('manifest validation refuses private paths, foreign manifests and invalid content hashes', async () => {
  const f = fixture();
  const valid = f.registerManifest({ '/noname/entry.js': 'body' });
  assert.equal((await f.message({ type: 'friends-cache-configure', manifestURL: 'https://elsewhere.example' + valid.url })).ok, false);
  for (const path of ['/readFile.js', '/node_modules/.env.js', '/src/noname/entry.js', '/game/../private.js']) {
    const m = f.registerManifest({ [path]: 'body' });
    assert.equal((await f.message({ type: 'friends-cache-configure', manifestURL: m.url })).ok, false, path);
  }
  f.responses.set(origin + valid.url, new Response(JSON.stringify({ version: valid.manifest.version, assets: { '/noname/entry.js': hash('different') } })));
  assert.equal((await f.message({ type: 'friends-cache-configure', manifestURL: valid.url })).ok, false);
});

test('storage failure preserves online play with validated responses', async () => {
  const f = fixture({ caches: { async open() { throw new Error('Quota exceeded'); }, async delete() { return false; } } });
  const m = f.registerManifest({ '/noname/entry.js': 'body' });
  assert.equal((await f.message({ type: 'friends-cache-configure', manifestURL: m.url })).ok, true);
  assert.equal(await (await f.request('/noname/entry.js')).response.text(), 'body');
  assert.equal(await (await f.request('/noname/entry.js')).response.text(), 'body');
});

test('clearing resources leaves unrelated caches intact and permits a fresh configure', async () => {
  const f = fixture();
  const unrelated = await f.caches.open('unrelated-app-settings');
  await unrelated.put(origin + '/setting', new Response('keep'));
  const m = f.registerManifest({ '/noname/entry.js': 'body' });
  await f.message({ type: 'friends-cache-configure', manifestURL: m.url }); await f.request('/noname/entry.js');
  assert.equal((await f.message({ type: 'friends-cache-clear' })).ok, true);
  assert.equal(f.caches.storage.has('noname-friends-assets-v1'), false);
  assert.equal(await (await unrelated.match(origin + '/setting')).text(), 'keep');
  assert.equal((await f.message({ type: 'friends-cache-configure', manifestURL: m.url })).cached, 0);
});

test('clearing resources preserves other open pages version pins across a worker restart', async () => {
  const f = fixture();
  const old = f.registerManifest({ '/noname/entry.js': 'old' });
  await f.message({ type: 'friends-cache-configure', manifestURL: old.url });
  await f.request('/noname/entry.js');
  const current = f.registerManifest({ '/noname/entry.js': 'new' });
  f.clients.set('two', { id: 'two', url: origin + '/?friends=1', postMessage() {} });
  await f.message({ type: 'friends-cache-configure', manifestURL: current.url }, 'two');
  await f.message({ type: 'friends-cache-clear' }, 'two');
  const restart = fixture({ caches: f.caches });
  restart.responses.set(origin + '/noname/entry.js', js('new'));
  assert.equal((await restart.request('/noname/entry.js')).response.status, 409);
});

test('maintenance retains open pages and the latest two versions and removes older unused bytes', async () => {
  const f = fixture();
  const versions = [];
  for (const number of [1, 2, 3, 4]) {
    const id = String(number);
    f.clients.set(id, { id, url: origin + '/?friends=1', postMessage() {} });
    const m = f.registerManifest({ '/noname/entry.js': 'version' + number });
    versions.push(m);
    await f.message({ type: 'friends-cache-configure', manifestURL: m.url }, id);
    await f.request('/noname/entry.js', { id });
    if (number > 1) f.clients.delete(id);
  }
  await f.lifecycle('activate');
  const assets = await f.caches.open('noname-friends-assets-v1');
  assert.equal((await assets.keys()).length, 3);
  assert.equal(await (await f.request('/noname/entry.js', { id: '1' })).response.text(), 'version1');
  const newest = await f.message({ type: 'friends-cache-configure', manifestURL: versions[3].url });
  assert.equal(newest.cached, 1);
  const removed = await f.message({ type: 'friends-cache-configure', manifestURL: versions[1].url });
  assert.equal(removed.cached, 0);
});

test('concurrent requests share a single download', async () => {
  const f = fixture();
  const m = f.registerManifest({ '/noname/entry.js': 'body' });
  await f.message({ type: 'friends-cache-configure', manifestURL: m.url });
  const results = await Promise.all([f.request('/noname/entry.js'), f.request('/noname/entry.js')]);
  assert.deepEqual(await Promise.all(results.map(result => result.response.text())), ['body', 'body']);
  assert.equal(f.calls.filter(call => call.url.endsWith('/noname/entry.js')).length, 1);
});

test('worker activation claims pages without sending reload messages', async () => {
  const f = fixture();
  await f.lifecycle('install'); await f.lifecycle('activate');
  assert.equal(f.skipped(), 1); assert.equal(f.claimed(), 1); assert.deepEqual(f.messages, []);
});
