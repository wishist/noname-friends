import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createFriendsServer } from '../server.mjs';

async function socket(url, id) {
  const ws = new WebSocket(url);
  const queue = [];
  const pending = [];
  ws.on('message', data => {
    const value = JSON.parse(data.toString());
    const i = pending.findIndex(item => item.type === value[0]);
    if (i === -1) queue.push(value);
    else { const item = pending.splice(i, 1)[0]; clearTimeout(item.timer); item.resolve(value); }
  });
  const wait = type => {
    const i = queue.findIndex(value => value[0] === type);
    if (i !== -1) return Promise.resolve(queue.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const item = { type, resolve, timer: setTimeout(() => reject(new Error(`Waiting for ${type}`)), 2500) };
      pending.push(item);
    });
  };
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await wait('roomlist');
  const send = (...data) => ws.send(JSON.stringify(data));
  send('server', 'key', [id]);
  return { ws, wait, send, queue };
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'noname-friends-test-'));
  const gameDir = join(root, 'game'), uiDir = join(root, 'ui');
  await mkdir(gameDir); await mkdir(uiDir);
  await writeFile(join(gameDir, 'index.html'), '<h1>engine</h1>');
  await writeFile(join(uiDir, 'index.html'), '<h1>friends</h1>');
  const app = createFriendsServer({ gameDir, uiDir });
  const { port } = await app.listen(0, '127.0.0.1');
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  return { base: `http://127.0.0.1:${port}`, relay: `ws://127.0.0.1:${port}/relay`, gameDir };
}

test('serves lobby and game on one origin; never serves desktop file APIs', async t => {
  const { base } = await fixture(t);
  assert.equal(await (await fetch(`${base}/friends/`)).text(), '<h1>friends</h1>');
  assert.equal(await (await fetch(`${base}/?friends=1`)).text(), '<h1>engine</h1>');
  assert.equal((await fetch(`${base}/readFile?fileName=LICENSE`)).status, 404);
  assert.equal((await fetch(`${base}/%2e%2e%2fLICENSE`)).status, 403);
  assert.equal((await fetch(`${base}/.git/config`)).status, 403);
  assert.equal((await fetch(`${base}/writeFile`, { method: 'POST', body: '{}' })).status, 405);
  const config = await (await fetch(`${base}/api/friends/config`)).json();
  assert.equal(config.relayPath, '/relay'); assert.equal(config.engineReady, true);
});

test('serves Vite preserved .pnpm dependency assets without exposing other hidden paths', async t => {
  const { base, gameDir } = await fixture(t);
  const moduleDir = join(gameDir, 'node_modules', '.pnpm', 'vue@3.5.28', 'node_modules', 'vue', 'dist');
  await mkdir(moduleDir, { recursive: true });
  const moduleBody = 'export const version = "3.5.28";';
  await writeFile(join(moduleDir, 'vue.esm-browser.js'), moduleBody);
  const moduleUrl = `${base}/node_modules/.pnpm/vue@3.5.28/node_modules/vue/dist/vue.esm-browser.js`;
  const response = await fetch(moduleUrl);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/javascript/);
  assert.equal(await response.text(), moduleBody);
  const head = await fetch(moduleUrl, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  for (const pathname of [
    '/.git/config',
    '/.pnpm/secret.js',
    '/node_modules/.env',
    '/node_modules/.pnpm/.git/config',
    '/node_modules/.pnpm/vue@3.5.28/%2e%2e%2f.env',
    '/%2e%2e%2fLICENSE',
  ]) {
    assert.equal((await fetch(base + pathname)).status, 403, pathname);
  }
});

test('serves the explicit preload and license routes with usable content types', async t => {
  const { base } = await fixture(t);
  const preload = await fetch(`${base}/preload.js`);
  assert.equal(preload.status, 200);
  assert.match(preload.headers.get('content-type'), /^text\/javascript/);
  assert.match(await preload.text(), /export class StaticAssetAdapter/);
  const license = await fetch(`${base}/LICENSE`);
  assert.equal(license.status, 200);
  assert.match(license.headers.get('content-type'), /^text\/plain/);
  assert.match(await license.text(), /GNU GENERAL PUBLIC LICENSE/);
  for (const pathname of ['/preload.js', '/LICENSE']) {
    const response = await fetch(base + pathname, { method: 'HEAD' });
    assert.equal(response.status, 200); assert.equal(await response.text(), '');
  }
});

test('two independent sockets create, join, synchronize configuration and exchange engine messages', async t => {
  const { relay } = await fixture(t);
  const host = await socket(relay, 'host-key');
  host.send('server', 'create', 'host-key', '房主', 'caocao');
  assert.deepEqual(await host.wait('createroom'), ['createroom', 'host-key']);
  const config = { mode: 'identity', player_number: 4, characterPack: ['standard', 'shenhua'], friendsProfile: { counts: { 'sha|': 20, 'shan|': 10 } } };
  host.send('server', 'config', config);
  const guest = await socket(relay, 'guest-key');
  guest.send('server', 'enter', 'host-key', '好友', 'liubei');
  const [, guestId] = await host.wait('onconnection');
  const init = ['init', { characterPack: config.characterPack, friendsProfile: config.friendsProfile }];
  host.send('server', 'send', guestId, JSON.stringify(init));
  assert.deepEqual(await guest.wait('init'), init);
  guest.send('result', { cards: ['sha'] });
  assert.deepEqual(await host.wait('onmessage'), ['onmessage', guestId, JSON.stringify(['result', { cards: ['sha'] }])]);
  host.ws.close();
  assert.deepEqual(await guest.wait('selfclose'), ['selfclose']);
});

test('failed join does not poison lobby state; guests cannot mutate host configuration', async t => {
  const { base, relay } = await fixture(t);
  const host = await socket(relay, 'owner');
  host.send('server', 'create', 'owner', '房主', 'caocao'); await host.wait('createroom');
  const guest = await socket(relay, 'guest');
  guest.send('server', 'enter', 'owner', '好友', 'liubei'); await guest.wait('enterroomfailed');
  host.send('server', 'config', { mode: 'identity', characterPack: ['standard'] });
  await guest.wait('updaterooms');
  guest.send('server', 'enter', 'owner', '好友', 'liubei'); await host.wait('onconnection');
  guest.send('server', 'config', { mode: 'evil' });
  assert.equal((await host.wait('onmessage'))[2], JSON.stringify(['server', 'config', { mode: 'evil' }]));
  const observer = await socket(relay, 'observer');
  observer.send('server', 'status', 'waiting');
  const [, rooms] = await observer.wait('updaterooms');
  assert.equal(rooms[0][2].mode, 'identity');
  assert.equal((await (await fetch(`${base}/healthz`)).json()).rooms, 1);
});

test('rejects cross-origin websocket upgrades', async t => {
  const { relay } = await fixture(t);
  const ws = new WebSocket(relay, { origin: 'https://other.example' });
  await new Promise((resolve, reject) => {
    ws.once('error', resolve);
    ws.once('open', () => reject(new Error('Cross-origin connection accepted')));
  });
});
