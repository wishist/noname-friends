import http from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname, extname, sep, join } from 'node:path';
import { pipeline } from 'node:stream';
import { createGzip } from 'node:zlib';
import { createRelay } from './relay.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8' };

function acceptsGzip(header = '') {
  const encodings = new Map(String(header).toLowerCase().split(',').map(value => {
    const [name, ...parameters] = value.trim().split(';');
    const quality = parameters.find(parameter => parameter.trim().startsWith('q='));
    const q = quality === undefined ? 1 : Number(quality.trim().slice(2));
    return [name.trim(), Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0];
  }));
  const gzip = encodings.get('gzip') ?? encodings.get('*') ?? 0;
  return gzip > 0 && gzip >= (encodings.get('identity') ?? 0);
}

function serveAsset(req, res, filename, info, contentType, cacheControl) {
  const compressible = /^(?:text\/|application\/json\b|image\/svg\+xml\b)/.test(contentType);
  const compressed = compressible && info.size >= 1024 && acceptsGzip(req.headers['accept-encoding']);
  // A weak validator describes the same source content for identity and gzip.
  const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
  const headers = { 'Content-Type': contentType, 'Cache-Control': cacheControl, ETag: etag, 'Last-Modified': info.mtime.toUTCString() };
  if (compressible) headers.Vary = 'Accept-Encoding';
  if (compressed) headers['Content-Encoding'] = 'gzip';
  const match = req.headers['if-none-match'];
  const notModified = match !== undefined
    ? match.split(',').some(value => value.trim() === '*' || value.trim().replace(/^W\//, '') === etag.replace(/^W\//, ''))
    : req.headers['if-modified-since'] !== undefined && Math.floor(info.mtimeMs / 1000) * 1000 <= Date.parse(req.headers['if-modified-since']);
  if (notModified) { res.writeHead(304, headers); return res.end(); }
  if (!compressed) headers['Content-Length'] = info.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  // Stream with backpressure; aborted requests release file/compression streams.
  // Do not retain asset bodies in memory as the engine contains many large packs.
  const streams = [createReadStream(filename)];
  if (compressed) streams.push(createGzip());
  pipeline(...streams, res, error => { if (error) res.destroy(); });
}

export function createFriendsServer(options = {}) {
  const gameDir = resolve(options.gameDir || process.env.GAME_DIR || (existsSync(join(repo, 'dist/index.html')) ? join(repo, 'dist') : join(repo, 'apps/core/dist')));
  const uiDir = resolve(options.uiDir || join(repo, 'friends-ui'));
  const publicOrigin = options.publicOrigin || process.env.PUBLIC_ORIGIN;
  if (publicOrigin && !/^https?:$/.test(new URL(publicOrigin).protocol)) throw new Error('PUBLIC_ORIGIN must be an HTTP(S) origin');
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); return json(res, 405, { error: 'Method not allowed' }); }
    let pathname, requestUrl;
    try { requestUrl = new URL(req.url, 'http://localhost'); pathname = decodeURIComponent(requestUrl.pathname); } catch { return json(res, 400, { error: 'Invalid URL' }); }
    if (pathname === '/api/friends/config') return json(res, 200, { version: 1, relayPath: '/relay', lobbyPath: '/friends/', gamePath: '/', publicOrigin: publicOrigin || null, engineReady: existsSync(join(gameDir, 'index.html')) });
    if (pathname === '/healthz') return json(res, 200, { ok: true, engineReady: existsSync(join(gameDir, 'index.html')), ...relay.getStats() });
    if (pathname === '/friends') { res.writeHead(302, { Location: '/friends/' }); return res.end(); }
    if (pathname === '/preload.js' || pathname === '/LICENSE') {
      const file = pathname === '/preload.js' ? join(repo, 'friends-server/preload.js') : join(repo, 'LICENSE');
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) return json(res, 404, { error: 'Not found' });
      return serveAsset(req, res, file, info, pathname === '/preload.js' ? 'text/javascript; charset=utf-8' : 'text/plain; charset=utf-8', 'no-cache');
    }
    // Vite preserves bundled dependency paths such as node_modules/.pnpm/...;
    // those are build output, not access to the repository dependency directory.
    if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some((part, i, parts) => part.startsWith('.') && !(part === '.pnpm' && parts[i - 1] === 'node_modules'))) return json(res, 403, { error: 'Forbidden' });
    // These are desktop file-management APIs. Never expose them on a public game server.
    if (/^\/(?:checkFile|checkDir|readFile|readFileAsText|writeFile|removeFile|getFileList|createDir|removeDir)(?:\/|$)/.test(pathname)) return json(res, 404, { error: 'Not found' });
    let base = pathname.startsWith('/friends/') ? uiDir : gameDir;
    let suffix = pathname.startsWith('/friends/') ? pathname.slice('/friends/'.length) : pathname.slice(1);
    if (!suffix || suffix.endsWith('/')) suffix += 'index.html';
    if (pathname === '/' && requestUrl.searchParams.has('friends') && existsSync(join(gameDir, 'friends-game.html'))) suffix = 'friends-game.html';
    try {
      let filename = resolve(base, suffix);
      if (filename !== base && !filename.startsWith(base + sep)) return json(res, 403, { error: 'Forbidden' });
      // The upstream core build leaves large media outside dist. Only these asset roots may fall back.
      if (!existsSync(filename) && base === gameDir && /^(image|audio)\//.test(suffix)) {
        base = join(repo, 'apps/core'); filename = resolve(base, suffix);
      }
      const [actualFile, actualBase] = await Promise.all([realpath(filename), realpath(base)]);
      if (!actualFile.startsWith(actualBase + sep)) return json(res, 403, { error: 'Forbidden' });
      const info = await stat(actualFile);
      if (!info.isFile()) return json(res, 404, { error: 'Not found' });
      return serveAsset(req, res, actualFile, info, types[extname(actualFile).toLowerCase()] || 'application/octet-stream', /\.(html|m?js|json|css)$/i.test(actualFile) ? 'no-cache' : 'public, max-age=86400');
    } catch (error) {
      if (error.code === 'ENOENT' && pathname === '/') return json(res, 503, { error: '游戏尚未构建。请先按 friends-server/README.md 构建引擎。' });
      json(res, error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 500, { error: error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 'Not found' : 'Unable to read asset' });
    }
  });
  const relay = createRelay(server, { publicOrigin });
  return {
    server,
    async listen(port = Number(process.env.PORT || 8090), host = process.env.HOST || '0.0.0.0') {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
      return server.address();
    },
    async close() { await relay.close(); await new Promise(resolve => server.close(resolve)); },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const app = createFriendsServer();
  const address = await app.listen();
  console.log(`无名杀 · 好友版：http://localhost:${address.port}/friends/`);
  console.log('异地好友需访问部署到公网的 HTTPS 地址；本机 localhost 不能直接分享。');
  const stop = async () => { await app.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
