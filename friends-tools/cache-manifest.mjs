import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const runtimeRoots = new Set(['noname','node_modules','_virtual','card','character','mode','game','layout','theme','font']);
const runtimeFile = /\.(?:m?js|json|css|woff2?|ttf|otf)$/i;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Content hashes stay stable across rebuilds when files do not change. */
export async function createCacheManifest(dist, preloadFile) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, {withFileTypes:true})) {
      const filename = join(directory, entry.name);
      if (entry.isDirectory()) await walk(filename);
      else if (entry.isFile() && runtimeFile.test(entry.name)) files.push(filename);
    }
  }
  for (const entry of await readdir(dist, {withFileTypes:true})) {
    if (entry.isDirectory() && runtimeRoots.has(entry.name)) await walk(join(dist,entry.name));
    else if (entry.isFile() && entry.name === 'noname.js') files.push(join(dist,entry.name));
  }
  const assets = {};
  for (const filename of files.sort()) {
    assets['/' + relative(dist,filename).replaceAll('\\','/')] = sha256(await readFile(filename));
  }
  assets['/preload.js'] = sha256(await readFile(preloadFile));
  return { version:sha256(JSON.stringify(assets)), assets };
}
