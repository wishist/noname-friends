<!-- SPDX-License-Identifier: GPL-3.0-only -->
# 无名杀 · 同袍

面向好友约局的非官方改良版，基于 [libnoname/noname](https://github.com/libnoname/noname) 1.11.7，基础提交 `b481b17552dd46e7d9ca805d5d7975b742168256`。

本仓库提供好友版及所需引擎源码，**不含原游戏图片、音频、字体、上游可选扩展，也不是下载后直接运行的完整素材客户端**。使用前需要安装依赖并构建；缺素材的影响见 [ASSETS.md](ASSETS.md)。

## 主要改动

- 房主可在开局前按牌种设置数量，组合多个卡牌包，并同时选择多个武将池、禁用单个武将。
- 方案可保存在浏览器，支持 JSON 导入导出；房间配置由房主校验并同步，开局后锁定。
- 同源网页与 WebSocket 中继，分享含房间号的网页邀请；部署到可访问的 HTTPS 地址后，好友可用浏览器加入。
- 游戏资源按内容校验和缓存，减少重复下载；加载失败可重试。
- 对浏览器拦截音乐播放和慢网首击无效的情况增加交互重试，尊重静音与音量设置。本代码包不附原音频。

保留原版规则系统。目录只覆盖本次上游检出版本；不是所有网络扩展或所有“三国杀”版本的合集。特殊模式仍有各自的牌池、选将和技能限制。

## 首次准备

1. 安装 **Node.js 22.12 或更新版本**，确保终端能运行 `node` 和随附的 `npm`。
2. 下载并解压源码，进入项目根目录。
3. Windows 可双击 `准备并启动好友版.cmd`；也可在根目录运行：

   ```sh
   node scripts/setup-friends.mjs
   ```

4. 等待依赖安装和构建完成，按终端提示打开 [本机好友大厅](http://localhost:8090/friends/)。首次准备需要网络。

准备脚本会在忽略的 `.runtime/package-manager/` 中准备固定版本 pnpm，安装项目和联机服务依赖，再构建所需模块及好友入口。它不会自动下载原游戏媒体。准备脚本每次运行都会检查安装并重新构建；日常启动无需反复执行它。

```sh
# 只安装和构建，不启动服务
node scripts/setup-friends.mjs --prepare-only

# 准备并启动，但不自动打开浏览器
node scripts/setup-friends.mjs --no-browser

# 查看参数
node scripts/setup-friends.mjs --help
```

## 日常启动与好友加入

已经准备完成后，Windows 可使用 `启动好友版.cmd`；也可以运行：

```sh
node friends-server/server.mjs
```

保持服务运行，打开 `http://localhost:8090/friends/`，选择牌堆、武将池、模式和人数，再进入游戏创建房间。房主可以在等待阶段修改配置；好友到齐后开始。

`localhost` 仅供当前电脑访问。异地好友需要访问你部署的 HTTPS 服务地址；从该地址创建房间后，使用“邀请好友”复制网页链接。好友不应把 `wss://` 地址直接粘贴到浏览器地址栏。部署和 Docker 使用方式见 [friends-server/README.md](friends-server/README.md)。仓库不附公共服务器或固定公网入口。

房主需要保持页面在线。中继重启或房主退出会影响房间，当前没有房主迁移或持久化对局恢复。建议好友使用相同构建，并先验证准备使用的模式。

## 开发与验证

构建和服务准备完成后，可运行相关测试：

```sh
node --test tests/friends-*.test.mjs friends-tools/catalog.test.mjs friends-server/test/*.test.mjs
```

更改游戏引擎后重新运行准备脚本的 `--prepare-only` 模式。只修改好友启动页或缓存脚本时，可运行 `node friends-tools/prepare-web.mjs` 更新好友入口；不要直接手工修改生成的构建文件。

## 许可与说明

代码按 **GPL-3.0-only** 提供，完整条款见 [LICENSE](LICENSE)。请保留来源与版权说明，修改后再分发应清楚注明改动。第三方依赖和媒体权利不能仅凭根目录许可证判断。

- [NOTICE.md](NOTICE.md)：上游出处、许可和非官方性质。
- [UPSTREAM_README.md](UPSTREAM_README.md)：保留的上游说明；不代表本改良版已提供其中全部安装包、扩展或服务。
- [CHANGELOG.md](CHANGELOG.md)：2026-10-28 至 2026-10-30 的改动记录。
- [ASSETS.md](ASSETS.md)：未随包发布的媒体及替换要求。
- [PRIVACY.md](PRIVACY.md)：本地存储、房间数据和公网部署边界。
