import { readFile, writeFile, access, mkdir, copyFile, rename } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCacheManifest } from './cache-manifest.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(process.argv[2] || join(repo, 'apps/core/dist'));
const html = await readFile(join(dist, 'index.html'), 'utf8');
const map = html.match(/<script\b[^>]*type="importmap"[^>]*>([\s\S]*?)<\/script>/i);
if (!map) throw new Error('Build the engine first: import map not found');
const imports = JSON.parse(map[1]);
const modules = [...new Set([...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*>/g)]
  .map(m => m[1]).filter(src => src.startsWith('/') || src.startsWith('./'))
  .map(src => new URL(src, 'https://game.invalid/').pathname))];
for (const src of modules) await access(join(dist, decodeURIComponent(src.slice(1))));
const styles = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(m => m[0]).join('\n');
const template = await readFile(join(repo, 'friends-ui/game.html'), 'utf8');
const manifest = await createCacheManifest(dist, join(repo,'friends-server/preload.js'));
const manifestName = `friends-cache-manifests/${manifest.version}.json`;
await mkdir(join(dist,'friends-cache-manifests'), {recursive:true});
await writeFile(join(dist,manifestName), JSON.stringify(manifest));
await copyFile(join(repo,'friends-ui/cache-worker.js'),join(dist,'friends-cache-worker.js'));
await writeFile(join(dist, 'friends-game.html.tmp'), template
  .replace('<!-- IMPORTMAP -->', `<script type="importmap">${JSON.stringify(imports).replaceAll('<', '\\u003c')}</script>`)
  .replace('<!-- STYLES -->', styles)
  .replace('<!-- CACHE -->', `<script id="friends-cache-config" type="application/json">${JSON.stringify({manifestURL:'/'+manifestName,version:manifest.version})}</script>`)
  .replace('<!-- MODULES -->', `<script id="friends-modules" type="application/json">${JSON.stringify(modules)}</script>`));
await rename(join(dist,'friends-game.html.tmp'),join(dist,'friends-game.html'));
console.log(`Friends web entry ready: ${modules.length} modules; ${Object.keys(manifest.assets).length} cacheable assets, version ${manifest.version.slice(0,12)}.`);
