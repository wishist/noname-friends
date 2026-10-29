// Verifies an already-running deployment without touching real players or rooms.
// Usage: node friends-server/test-public-relay.mjs https://game.example
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';

const base = new URL(process.argv[2] || 'http://127.0.0.1:8090');
if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw Error('Pass an HTTP(S) game origin');
base.pathname = '/'; base.search = ''; base.hash = '';
const relay = new URL('/relay', base); relay.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
const timeout = 20000;
const clients = [];
const results = [];

async function check(path, expected, pattern) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(timeout) });
  assert.equal(response.status, 200, `HTTP ${path}`);
  assert.match(response.headers.get('content-type') || '', expected, `MIME ${path}`);
  const body = await response.text();
  if (pattern) assert.match(body, pattern, `Content ${path}`);
  results.push({ check: path, status: response.status });
  return body;
}

async function connect(id) {
  const ws = new WebSocket(relay, { origin: base.origin, handshakeTimeout: timeout });
  const queue = [], pending = [];
  const client = { ws, id, send: (...values) => ws.send(JSON.stringify(values)) };
  clients.push(client);
  ws.on('error', () => {});
  ws.on('message', data => {
    let message;
    try { message = JSON.parse(data.toString()); } catch { return; }
    const index = pending.findIndex(item => item.type === message[0] && item.predicate(message));
    if (index === -1) { queue.push(message); return; }
    const item = pending.splice(index, 1)[0]; clearTimeout(item.timer); item.resolve(message);
  });
  client.wait = (type, predicate = () => true) => {
    const index = queue.findIndex(message => message[0] === type && predicate(message));
    if (index !== -1) return Promise.resolve(queue.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const item = { type, predicate, resolve, reject };
      item.timer = setTimeout(() => {
        const index = pending.indexOf(item); if (index !== -1) pending.splice(index, 1);
        reject(Error(`Timed out waiting for ${type} on ${id}`));
      }, timeout);
      pending.push(item);
    });
  };
  ws.on('close', () => {
    for (const item of pending.splice(0)) { clearTimeout(item.timer); item.reject(Error(`Socket closed waiting for ${item.type}`)); }
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await client.wait('roomlist');
  client.send('server', 'key', [id, 'friends-public-check']);
  return client;
}

async function cleanup() {
  // Close only the two connections created by this script, guest before host.
  for (const { ws } of clients.reverse()) {
    if (ws.readyState === WebSocket.CLOSED) continue;
    await new Promise(resolve => {
      const timer = setTimeout(() => { ws.terminate(); resolve(); }, 2000);
      ws.once('close', () => { clearTimeout(timer); resolve(); });
      ws.close();
    });
  }
}

try {
  await check('/friends/', /text\/html/, /无名杀/);
  await check('/preload.js', /(?:text|application)\/javascript/, /StaticAssetAdapter/);
  await check('/node_modules/.pnpm/path-browserify-esm@1.0.6/node_modules/path-browserify-esm/index.esm.js', /(?:text|application)\/javascript/, /extname/);
  const config = JSON.parse(await check('/api/friends/config', /application\/json/));
  assert.equal(config.engineReady, true); assert.equal(config.relayPath, '/relay');

  const nonce = randomBytes(10).toString('hex');
  const hostId = `qa-host-${nonce}`, guestId = `qa-guest-${nonce}`;
  const host = await connect(hostId);
  const guest = await connect(guestId);
  host.send('server', 'create', hostId, '连通性检查房主', 'caocao');
  assert.deepEqual(await host.wait('createroom'), ['createroom', hostId]);
  const roomConfig = {
    mode: 'identity', player_number: 2, characterPack: ['standard', 'refresh'],
    friendsProfile: { version: 1, enabled: true, cardPacks: ['standard', 'extra'], characterPacks: ['standard', 'refresh'], counts: { 'sha|': 20, 'sha|fire': 5, 'shan|': 10 }, excludedCharacters: [] },
  };
  host.send('server', 'config', roomConfig);
  const [, rooms] = await guest.wait('updaterooms', message => message[1].some(room => room[4] === hostId));
  assert.deepEqual(rooms.find(room => room[4] === hostId)[2], roomConfig);
  guest.send('server', 'enter', hostId, '连通性检查好友', 'liubei');
  const [, socketId] = await host.wait('onconnection');
  const init = ['public-test-config', roomConfig];
  host.send('server', 'send', socketId, JSON.stringify(init));
  assert.deepEqual(await guest.wait('public-test-config'), init);
  const reply = ['public-test-selection', { card: 'sha', nonce }];
  guest.send(...reply);
  assert.deepEqual(await host.wait('onmessage'), ['onmessage', socketId, JSON.stringify(reply)]);
  results.push({ check: 'public WSS host create / guest join / config / bidirectional messages', passed: true });
  await cleanup();
  console.log(JSON.stringify({ origin: base.origin, passed: true, results, cleanedUp: true }, null, 2));
} catch (error) {
  await cleanup();
  console.error(JSON.stringify({ origin: base.origin, passed: false, completed: results, error: error.message }, null, 2));
  process.exitCode = 1;
}
