<!-- SPDX-License-Identifier: GPL-3.0-only -->
# 好友联机服务

本服务将好友配置页面、游戏客户端和 WebSocket 中继放在同一个地址。代码来源及许可见 [NOTICE.md](../NOTICE.md) 和 [LICENSE](../LICENSE)。这是非官方改良版；原版媒体与上游可选扩展不随本代码包发布。

| 路径 | 用途 |
| --- | --- |
| `/friends/` | 好友配置页：牌堆、武将池、昵称和邀请入口。 |
| `/?friends=1` | 好友专用游戏加载入口。 |
| `/relay` | WebSocket 大厅与房间消息中继。 |
| `/api/friends/config` | 客户端连接配置和引擎构建状态。 |
| `/healthz` | 服务健康状态。 |

## 从源码准备和启动

先安装 Node.js 22.12 或更新版本及其随附 npm，在项目根目录执行：

```sh
node scripts/setup-friends.mjs --prepare-only
node friends-server/server.mjs
```

也可按 [根目录说明](../README.md) 使用准备并启动脚本。打开 `http://localhost:8090/friends/`；服务进程需要保持运行。

服务优先读取 `dist/index.html`，否则读取 `apps/core/dist/index.html`。如果设置 `GAME_DIR`，其值必须指向构建结果目录，不能指向未经构建的源码。自定义构建目录还需运行 `node friends-tools/prepare-web.mjs <目录>` 生成好友入口。

默认监听 `0.0.0.0:8090`。可通过 `HOST`、`PORT` 调整；只供本机使用时可绑定回环地址。此服务限制静态资源目录，未提供桌面文件管理 API，但这些限制不构成完整安全审计或访问控制。数据与日志说明见 [PRIVACY.md](../PRIVACY.md)。

## 异地好友

`localhost` 仅表示访问者自己的电脑。让异地好友点击网页加入，需要部署一个双方都能访问的 HTTPS 地址，并支持 `/relay` 的 WebSocket Upgrade。房主和好友应使用相同构建；房主创建房间后分享游戏内生成的网页邀请。

本仓库不附可用的公共大厅、云服务器、域名、通道账号或 `cloudflared` 二进制文件。可按自己的环境选择正式部署或临时 HTTPS 通道。临时通道在进程退出后可能失效，重建时可能更换地址；旧邀请和不同域名的浏览器缓存不能直接沿用。

如果使用可选 Windows `启动公网联机.cmd`，需要先完成源码准备，并自行从 [Cloudflare 官方说明](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/) 获取适用于本机的通道程序，放置为 `.runtime/tools/cloudflared.exe`。该脚本会检查已有进程，复用健康通道或建立临时通道，验证成功后生成本机的 `本次公网联机.url`。它不提供开机自启或持续后台监控，生成的地址和日志不应提交到仓库。

## Docker Compose 与 HTTPS

`Dockerfile.friends` 使用已构建的 `apps/core/dist`，不会在镜像构建时自动完成引擎编译。

1. 在部署目录完成 `node scripts/setup-friends.mjs --prepare-only`。
2. 安装 Docker Compose，配置自己的域名指向该服务器，并确保外部可访问 TCP 80、443。
3. 在未提交的 `.env` 中设置 `GAME_DOMAIN=game.example.com`，用实际受你控制的域名替换示例。
4. 在项目根目录执行：

   ```sh
   docker compose -f compose.friends.yml up -d --build
   ```

5. 在 DNS、网络和证书签发条件满足时，Caddy 提供 HTTPS，入口为 `https://你的域名/friends/`。

Compose 文件为 `apps/core/image/` 和 `apps/core/audio/` 配置了只读挂载。没有准备有权使用的媒体时，它们只是空目录，不会凭空补齐图片和声音；可在启动前创建这两个空目录。字体通常在构建时进入产物，后补字体需重新构建。素材许可、路径及缺失影响见 [ASSETS.md](../ASSETS.md)。本代码快照没有上游完整媒体历史，不应使用 `git sparse-checkout` 作为获取媒体的步骤。

已有 Nginx 或 Caddy 时，也可直接运行 Node 服务并代理网页和 `/relay`。设置 `PUBLIC_ORIGIN=https://你的域名`，使浏览器来源校验与外部地址一致。反向代理、访问控制、日志和维护由部署者负责。

## 房间与协议边界

房主浏览器执行主要对局逻辑，中继负责转发消息。它不是集中式完整反作弊服务器。房间状态只保存在当前进程内；服务器重启或房主离开后，没有持久化对局恢复或房主迁移。多实例部署还需解决连接与房间落点一致的问题，不能简单轮询分流。

房间 ID 使用引擎的 `game.roomId`。客户端连接同源 `/relay` 后，沿用上游兼容的 `key/create/config/enter/send` 等协议。房主设置经过验证的牌堆和多个武将池；访客不能替代房主修改这些设置。完整卡牌结算和技能仍由原版引擎处理，特定模式和第三方扩展应分别验证。
