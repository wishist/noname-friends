// Built-in packs are precompiled; the optional worker only caches verified static files.
(() => {
  const panel = document.getElementById('friends-loading');
  const status = document.getElementById('boot-status');
  const progress = document.getElementById('boot-progress');
  const retry = document.getElementById('boot-retry');
  const cacheStatus = document.getElementById('boot-cache-status');
  const clearCache = document.getElementById('boot-clear-cache');
  const cacheConfig = JSON.parse(document.getElementById('friends-cache-config')?.textContent || 'null');
  let cacheWorker = null, cacheHits = 0, downloads = 0;
  let finished = false, failed = false;
  retry.onclick = () => location.reload();
  const fail = error => {
    if (finished || failed) return;
    failed = true;
    clearTimeout(slowTimer);
    document.getElementById('boot-title').textContent = '游戏加载未完成';
    status.textContent = '部分游戏资源未能载入，请重新加载。房间配置仍保存在此浏览器中。';
    const detail = document.getElementById('boot-error');
    detail.hidden = false;
    detail.textContent = error?.message || String(error);
    retry.hidden = false;
    if (clearCache && cacheWorker) clearCache.hidden = false;
  };
  document.addEventListener('friends-boot-error', event => fail(event.detail));
  document.addEventListener('friends-boot-progress', event => {
    if (failed) return;
    status.textContent = event.detail;
    progress.removeAttribute('value');
  });
  document.addEventListener('friends-boot-ready', () => {
    finished = true;
    clearTimeout(slowTimer);
    panel.remove();
    if (cacheWorker) console.info('[好友资源缓存]', JSON.stringify({ version:cacheConfig.version.slice(0,12), cacheHits, downloads }));
  }, { once: true });
  const slowTimer = setTimeout(() => {
    if (finished || failed) return;
    status.textContent += ' 网络较慢，仍在加载；也可以返回配置页或重新加载。';
    retry.hidden = false;
  }, 60000);
  function askWorker(worker, message, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => { channel.port1.close(); reject(new Error('缓存响应超时')); }, timeoutMs);
      channel.port1.onmessage = event => {
        clearTimeout(timeout);channel.port1.close();
        if (event.data?.ok) resolve(event.data);
        else reject(new Error(event.data?.error || '缓存不可用'));
      };
      worker.postMessage(message, [channel.port2]);
    });
  }
  function waitForCacheController(timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
      const matches = () => navigator.serviceWorker.controller?.scriptURL === new URL('/friends-cache-worker.js',location.origin).href;
      if (matches()) return resolve(navigator.serviceWorker.controller);
      const check = () => { if (matches()) { clearTimeout(timer);navigator.serviceWorker.removeEventListener('controllerchange',check);resolve(navigator.serviceWorker.controller); } };
      const timer = setTimeout(() => { navigator.serviceWorker.removeEventListener('controllerchange',check);reject(new Error('缓存启动超时')); }, timeoutMs);
      navigator.serviceWorker.addEventListener('controllerchange',check);
      check();
    });
  }
  async function enableCache() {
    if (!cacheConfig || !('serviceWorker' in navigator) || !window.isSecureContext) {
      if (cacheStatus) cacheStatus.textContent = '此浏览器暂无法保存资源，正在按普通方式加载。';
      return;
    }
    let timedOut = false, timer;
    const setup = (async () => {
      await navigator.serviceWorker.register('/friends-cache-worker.js', {scope:'/',updateViaCache:'none'});
      const controller = await waitForCacheController();
      if (timedOut) return;
      const report = await askWorker(controller,{type:'friends-cache-configure',manifestURL:cacheConfig.manifestURL});
      if (timedOut) return;
      cacheWorker = controller;
      cacheStatus.textContent = report.cached > 0 ? `已保存 ${report.cached} 项资源，优先从本地缓存读取。` : '首次载入：正在下载并保存游戏资源。';
    })();
    try {
      await Promise.race([setup, new Promise((_,reject) => {timer=setTimeout(()=>{timedOut=true;reject(new Error('缓存启动超时'));},15000);})]);
    } catch (error) {
      if (cacheStatus) cacheStatus.textContent = '本次使用普通加载；缓存暂不可用，不影响联机。';
      console.warn('[好友资源缓存]',error.message);
    } finally { clearTimeout(timer); }
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', event => {
    if (!cacheWorker || event.source !== navigator.serviceWorker.controller || event.data?.type !== 'friends-cache-progress') return;
    if (event.data.source === 'cache') cacheHits++;
    else if (event.data.source === 'network') downloads++;
    if (cacheStatus) cacheStatus.textContent = `读取本地缓存 ${cacheHits} 项 · 下载新增资源 ${downloads} 项`;
  });
  if (clearCache) clearCache.onclick = async () => {
    if (!cacheWorker) return;
    clearCache.disabled = true;
    try { await askWorker(cacheWorker,{type:'friends-cache-clear'});location.reload(); }
    catch { clearCache.disabled=false;cacheStatus.textContent='缓存清理未完成，请使用“重新加载”重试。'; }
  };
  async function preloadModule(href) {
    await new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'modulepreload';
      link.href = href;
      link.onload = resolve;
      link.onerror = () => reject(new Error(`资源下载失败：${href}`));
      document.head.appendChild(link);
    });
  }
  (async () => {
    await enableCache();
    const modules = JSON.parse(document.getElementById('friends-modules').textContent);
    if (!document.createElement('link').relList?.supports?.('modulepreload')) {
      status.textContent = '正在以兼容模式加载游戏…';
      await import('/noname/entry.js');
      return;
    }
    let next = 0, loaded = 0;
    progress.max = modules.length;
    progress.value = 0;
    // Limit explicit preload requests instead of starting every script tag at once.
    await Promise.all(Array.from({ length: 16 }, async () => {
      while (!failed && next < modules.length) {
        await preloadModule(modules[next++]);
        if (failed) return;
        progress.value = ++loaded;
        status.textContent = `正在加载游戏核心 ${loaded} / ${modules.length}`;
      }
    }));
    status.textContent = '正在初始化游戏和武将牌…';
    progress.removeAttribute('value');
    await import('/noname/entry.js');
  })().catch(fail);
})();
