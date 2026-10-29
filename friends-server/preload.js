// SPDX-License-Identifier: GPL-3.0-only
// Browser-only static asset adapter. Never grants access to a server's file system.
import { FileSystem, installLegacyFileSystemAPI, FileSystemError, FileSystemErrorCode } from '/noname/library/fs/index.js';
import path from '/node_modules/.pnpm/path-browserify-esm@1.0.6/node_modules/path-browserify-esm/index.esm.js';

const ROOT_DIRECTORIES = ['noname', 'game', 'mode', 'card', 'character', 'image', 'audio', 'theme', 'font', 'layout', 'style', 'extension', 'node_modules'];
const READ_ONLY_MESSAGE = '网页版不支持修改服务器游戏文件；房间设置和游戏偏好自动保存在当前浏览器中。安装扩展或更新游戏请由服务器部署者操作。';

function error(code, file, detail) {
  return new FileSystemError(code, String(file), { detail, cause: new Error(detail) });
}
function assetPath(value) {
  if (typeof value !== 'string' || value.includes('\0') || value.includes('\\') || /^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//')) {
    throw error(FileSystemErrorCode.InvalidPath, value, '只允许读取本站已发布的游戏资源');
  }
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { throw error(FileSystemErrorCode.InvalidPath, value, '资源路径编码无效'); }
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.includes('?') || decoded.includes('#') || decoded.split('/').some(p => p === '..' || p.startsWith('.') && p !== '.' && p !== '.pnpm')) {
    throw error(FileSystemErrorCode.InvalidPath, value, '资源路径无效');
  }
  return decoded.split('/').filter(p => p && p !== '.').join('/');
}
function assetURL(file) {
  return new URL('/' + assetPath(file).split('/').map(encodeURIComponent).join('/'), location.origin).href;
}

export class StaticAssetAdapter {
  async stat(file) {
    const name = assetPath(file);
    if (!name || ROOT_DIRECTORIES.includes(name)) return { type: 'directory' };
    const response = await fetch(assetURL(name), { method: 'HEAD', credentials: 'same-origin', redirect: 'error' });
    if (response.status === 404 || response.status === 403) return null;
    if (!response.ok) throw error(FileSystemErrorCode.IoError, file, `读取资源状态失败：HTTP ${response.status}`);
    return { type: 'file', size: Number(response.headers.get('content-length')) || undefined };
  }
  async read(file) {
    const name = assetPath(file);
    if (!name || ROOT_DIRECTORIES.includes(name)) throw error(FileSystemErrorCode.NotFile, file, '路径是目录');
    const response = await fetch(assetURL(name), { credentials: 'same-origin', redirect: 'error' });
    if (response.status === 404) throw error(FileSystemErrorCode.NotFound, file, '游戏资源不存在');
    if (!response.ok) throw error(FileSystemErrorCode.IoError, file, `读取游戏资源失败：HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }
  async list(file) {
    const name = assetPath(file);
    // A hosted release does not scan or install arbitrary server-side extensions.
    // Built-in extensions remain loaded through the game's declared configuration.
    if (name === 'extension') return [];
    if (!name) return ROOT_DIRECTORIES.map(name => ({ name, type: 'directory' }));
    throw error(FileSystemErrorCode.PermissionDenied, file, '网页版不提供服务器目录浏览；请读取已知的游戏资源路径。');
  }
  async open(file, options = {}) {
    if (options.write || options.append || options.create || options.createNew || options.truncate || options.read === false) {
      throw error(FileSystemErrorCode.PermissionDenied, file, READ_ONLY_MESSAGE);
    }
    const info = await this.stat(file);
    if (!info) throw error(FileSystemErrorCode.NotFound, file, '游戏资源不存在');
    if (info.type !== 'file') throw error(FileSystemErrorCode.NotFile, file, '路径不是文件');
    let closed = false;
    const assertOpen = () => { if (closed) throw error(FileSystemErrorCode.IoError, file, '资源句柄已经关闭'); };
    return {
      readAll: async () => { assertOpen(); return this.read(file); },
      stat: async () => { assertOpen(); return this.stat(file); },
      write: async () => { assertOpen(); throw error(FileSystemErrorCode.PermissionDenied, file, READ_ONLY_MESSAGE); },
      truncate: async () => { assertOpen(); throw error(FileSystemErrorCode.PermissionDenied, file, READ_ONLY_MESSAGE); },
      close: async () => { closed = true; },
    };
  }
  async write(file) { throw error(FileSystemErrorCode.PermissionDenied, file, READ_ONLY_MESSAGE); }
  async createDir(file) { throw error(FileSystemErrorCode.PermissionDenied, file, READ_ONLY_MESSAGE); }
  async remove(file) { throw error(FileSystemErrorCode.PermissionDenied, file, READ_ONLY_MESSAGE); }
}

export default async function preload({ lib, game }) {
  lib.path = path;
  lib.fs = new FileSystem(new StaticAssetAdapter());
  installLegacyFileSystemAPI(game, lib.fs);
  game.export = (data, name = 'noname') => {
    const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.download = String(name).replace(/[\\/:?"*<>|]/g, '-');
    anchor.href = url;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  game.exit = () => { location.href = '/friends/'; };
  game.open = url => { window.open(url, '_blank', 'noopener,noreferrer'); };
}
