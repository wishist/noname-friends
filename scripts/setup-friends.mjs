// SPDX-License-Identifier: GPL-3.0-only
// Added for the public source release, 2026-10-30.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pnpmVersion = '10.11.0';
const args = new Set(process.argv.slice(2));
const allowed = new Set(['--prepare-only', '--no-browser', '--help']);

function run(command, argv, cwd = root, shell = false) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, argv, {
      cwd, shell, stdio: 'inherit', windowsHide: true,
      env: {
        ...process.env, CI: 'true',
        // Package scripts also invoke pnpm; no global pnpm installation is needed.
        PATH: `${join(root, '.runtime', 'package-manager', 'node_modules', '.bin')}${delimiter}${process.env.PATH || ''}`,
      },
    });
    child.once('error', error => reject(new Error(`无法执行 ${command}：${error.message}`)));
    child.once('exit', (code, signal) => code === 0 ? resolveRun() : reject(new Error(`${command} 失败（${signal || code}）`)));
  });
}

// Prefer the npm bundled with Node; fixed literal arguments also support PATH shims.
const npmCli = [
  join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
].find(filename => existsSync(filename));
const npm = (argv, cwd) => npmCli
  ? run(process.execPath, [npmCli, ...argv], cwd)
  : run(process.platform === 'win32' ? 'npm.cmd' : 'npm', argv, cwd, process.platform === 'win32');

async function main() {
  for (const arg of args) if (!allowed.has(arg)) throw new Error(`未知参数：${arg}。用 --help 查看用法。`);
  if (args.has('--help')) {
    console.log(`用法：node scripts/setup-friends.mjs [--prepare-only] [--no-browser]
需要 Node.js 22.12 或更新版本及随附的 npm；首次安装需要网络。
--prepare-only  安装依赖并构建，完成后退出
--no-browser    准备后启动服务，但不自动打开浏览器
默认会安装依赖、重新构建，然后启动。日常启动可用 node friends-server/launch.mjs。
源码发行版不含未确认授权的图片、音频、字体，也不会自动下载这些素材。`);
    return;
  }
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw new Error('请先安装 Node.js 22.12 或更新版本（建议 Node.js 24 LTS）。');
  const packageManager = join(root, '.runtime', 'package-manager');
  const cli = join(packageManager, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs');
  const metadata = join(packageManager, 'node_modules', 'pnpm', 'package.json');
  let installedVersion;
  try { installedVersion = JSON.parse(await readFile(metadata, 'utf8')).version; } catch { /* First run. */ }
  if (installedVersion !== pnpmVersion || !existsSync(cli)) {
    console.log(`[1/5] 正在准备 pnpm ${pnpmVersion}（仅安装在本项目 .runtime 中）…`);
    await mkdir(packageManager, { recursive: true });
    await writeFile(join(packageManager, 'package.json'), JSON.stringify({ private: true }), 'utf8');
    await npm(['install', '--no-audit', '--no-fund', '--ignore-scripts', '--package-lock=false', 'pnpm@10.11.0'], packageManager);
  }
  console.log('[2/5] 按锁文件安装源码构建依赖…');
  await run(process.execPath, [cli, 'install', '--frozen-lockfile']);
  console.log('[3/5] 按锁文件安装好友联机服务依赖…');
  await npm(['ci', '--no-audit', '--no-fund'], join(root, 'friends-server'));
  console.log('[4/5] 构建 JIT 与游戏网页…');
  await run(process.execPath, [cli, '-F', '@noname/jit', 'build']);
  await run(process.execPath, [cli, 'run', 'build:friends']);
  console.log('[5/5] 准备完成。此源码发行版不含图片、音频及字体资源。');
  if (!args.has('--prepare-only')) {
    await run(process.execPath, [join(root, 'friends-server', 'launch.mjs'), ...(args.has('--no-browser') ? ['--no-browser'] : [])]);
  }
}

main().catch(error => {
  console.error(`\n准备失败：${error.message}\n请检查上方具体报错、Node.js/npm 安装和网络连接，再重新运行。原始源码不会被清理。`);
  process.exitCode = 1;
});
