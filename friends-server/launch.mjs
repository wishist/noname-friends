// SPDX-License-Identifier: GPL-3.0-only
// Public source release: configurable port and cross-platform launch, 2026-10-30.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT || 8090);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT 必须是 1 至 65535 之间的整数。');
  process.exit(1);
}
const origin = `http://127.0.0.1:${port}`;
// Keep the same browser origin as earlier versions so saved presets remain available.
const address = `http://localhost:${port}/friends/`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function ready() {
  try {
    const response = await fetch(`${origin}/api/friends/config`, { signal: AbortSignal.timeout(1000) });
    const data = await response.json();
    return response.ok && data.version === 1 && data.relayPath === '/relay' && data.engineReady === true;
  } catch {
    return false;
  }
}

function openBrowser() {
  if (process.argv.includes('--no-browser')) return;
  const [command, args] = process.platform === 'win32'
    ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process '${address}'`]]
    : process.platform === 'darwin' ? ['open', [address]] : ['xdg-open', [address]];
  const browser = spawn(command, args, { windowsHide: true, stdio: 'ignore' });
  browser.on('error', () => console.log(`请手动打开 ${address}`));
  browser.unref();
}

if (await ready()) {
  console.log(`游戏服务已启动，正在打开 ${address}`);
  openBrowser();
} else {
  const server = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    stdio: 'inherit', env: { ...process.env, PORT: String(port) },
  });
  let failed = false;
  server.once('error', error => { failed = true; console.error(`无法启动：${error.message}`); process.exitCode = 1; });
  server.once('exit', code => { failed = true; process.exitCode = code ?? 1; });
  for (let i = 0; i < 30 && !failed; i++) {
    if (await ready()) {
      console.log(`服务已就绪：${address}\n请保持此窗口打开。`);
      openBrowser();
      break;
    }
    await delay(500);
    if (i === 29) {
      console.error(`服务启动失败，请检查上方报错，或确认 ${port} 端口没有被其他程序占用。`);
      server.kill();
      process.exitCode = 1;
    }
  }
}
