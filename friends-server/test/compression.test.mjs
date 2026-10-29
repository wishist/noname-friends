import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createFriendsServer } from '../server.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'noname-compression-test-'));
  const gameDir = join(root, 'game'), uiDir = join(root, 'ui');
  await mkdir(gameDir); await mkdir(uiDir);
  const body = '/* 无名杀 multiplayer engine asset */\n'.repeat(5000);
  for (const extension of ['html', 'js', 'mjs', 'json', 'css', 'txt', 'svg', 'png']) {
    await writeFile(join(gameDir, `asset.${extension}`), body);
  }
  await writeFile(join(gameDir, 'small.js'), 'export const ready = true;');
  const app = createFriendsServer({ gameDir, uiDir });
  const { port } = await app.listen(0, '127.0.0.1');
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  return { port, gameDir, body: Buffer.from(body) };
}

function request(port, path, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers, agent: false }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject); req.end();
  });
}

test('streams compressed engine text assets with negotiable, consistent GET and HEAD headers', async t => {
  const { port, body } = await fixture(t);
  for (const extension of ['html', 'js', 'mjs', 'json', 'css', 'txt', 'svg']) {
    const path = `/asset.${extension}`;
    const get = await request(port, path, { 'Accept-Encoding': 'gzip, deflate, br' });
    assert.equal(get.status, 200);
    assert.equal(get.headers['content-encoding'], 'gzip', extension);
    assert.equal(get.headers.vary, 'Accept-Encoding');
    assert.equal(get.headers['content-length'], undefined);
    assert.ok(get.body.length < body.length / 10, extension);
    assert.deepEqual(gunzipSync(get.body), body);
    const head = await request(port, path, { 'Accept-Encoding': 'gzip' }, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    for (const name of ['content-type', 'content-encoding', 'content-length', 'vary', 'etag', 'last-modified', 'cache-control']) {
      assert.equal(head.headers[name], get.headers[name], `${extension}: ${name}`);
    }
  }
});

test('honors encoding opt-outs, identity preference and wildcard; leaves binary and tiny assets intact', async t => {
  const { port, body } = await fixture(t);
  for (const encoding of ['', 'br', 'gzip;q=0', '*;q=1, gzip;q=0', 'gzip;q=0.5, identity;q=1', 'gzip;q=invalid']) {
    const get = await request(port, '/asset.js', { 'Accept-Encoding': encoding });
    assert.equal(get.headers['content-encoding'], undefined, encoding);
    assert.equal(Number(get.headers['content-length']), body.length);
    assert.deepEqual(get.body, body);
    assert.equal(get.headers.vary, 'Accept-Encoding');
  }
  const wildcard = await request(port, '/asset.js', { 'Accept-Encoding': '*;q=0.5' });
  assert.equal(wildcard.headers['content-encoding'], 'gzip');
  const binary = await request(port, '/asset.png', { 'Accept-Encoding': 'gzip' });
  assert.equal(binary.headers['content-encoding'], undefined);
  assert.equal(binary.headers.vary, undefined);
  assert.deepEqual(binary.body, body);
  const tiny = await request(port, '/small.js', { 'Accept-Encoding': 'gzip' });
  assert.equal(tiny.headers['content-encoding'], undefined);
  assert.equal(tiny.body.toString(), 'export const ready = true;');
});

test('revalidates identity and gzip using ETags and modification dates, and notices changed files', async t => {
  const { port, gameDir } = await fixture(t);
  const first = await request(port, '/asset.js', { 'Accept-Encoding': 'gzip' });
  assert.match(first.headers.etag, /^W\/".+"$/);
  for (const headers of [
    { 'If-None-Match': first.headers.etag },
    { 'If-None-Match': `"other", ${first.headers.etag.replace('W/', '')}`, 'Accept-Encoding': 'gzip' },
    { 'If-None-Match': '*' },
    { 'If-Modified-Since': first.headers['last-modified'] },
  ]) {
    const cached = await request(port, '/asset.js', headers);
    assert.equal(cached.status, 304);
    assert.equal(cached.body.length, 0);
    assert.equal(cached.headers['content-length'], undefined);
    assert.equal(cached.headers.etag, first.headers.etag);
    assert.equal(cached.headers.vary, 'Accept-Encoding');
    assert.equal(cached.headers['cache-control'], 'no-cache');
  }
  const precedence = await request(port, '/asset.js', { 'If-None-Match': '"different"', 'If-Modified-Since': first.headers['last-modified'] });
  assert.equal(precedence.status, 200);
  const invalidDate = await request(port, '/asset.js', { 'If-Modified-Since': 'invalid' });
  assert.equal(invalidDate.status, 200);
  const file = join(gameDir, 'asset.js');
  await writeFile(file, 'export const changed = true;');
  const later = new Date(Date.now() + 2000);
  await utimes(file, later, later);
  const changed = await request(port, '/asset.js', { 'If-None-Match': first.headers.etag });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.etag, first.headers.etag);
  assert.equal(changed.body.toString(), 'export const changed = true;');
});

test('explicit preload and license routes use the same compression and revalidation', async t => {
  const { port } = await fixture(t);
  for (const path of ['/preload.js', '/LICENSE']) {
    const get = await request(port, path, { 'Accept-Encoding': 'gzip' });
    assert.equal(get.status, 200);
    assert.equal(get.headers['content-encoding'], 'gzip');
    assert.equal(get.headers['cache-control'], 'no-cache');
    assert.ok(gunzipSync(get.body).length > get.body.length);
    const cached = await request(port, path, { 'If-None-Match': get.headers.etag }, 'HEAD');
    assert.equal(cached.status, 304);
    assert.equal(cached.body.length, 0);
  }
});

test('uses the optional friends entry only for root friends links, with normal entry fallback', async t => {
  const { port, gameDir } = await fixture(t);
  await writeFile(join(gameDir, 'index.html'), '<h1>normal entry</h1>');
  const fallback = await request(port, '/?friends=1');
  assert.equal(fallback.status, 200);
  assert.equal(fallback.body.toString(), '<h1>normal entry</h1>');
  await writeFile(join(gameDir, 'friends-game.html'), '<h1>friends entry</h1>');
  for (const path of ['/?friends=1', '/?room=example&friends=1']) {
    const friends = await request(port, path);
    assert.equal(friends.status, 200);
    assert.equal(friends.body.toString(), '<h1>friends entry</h1>');
  }
  for (const path of ['/', '/?other=1', '/index.html?friends=1']) {
    const normal = await request(port, path);
    assert.equal(normal.status, 200);
    assert.equal(normal.body.toString(), '<h1>normal entry</h1>');
  }
});
