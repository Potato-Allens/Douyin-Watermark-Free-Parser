# 抖音无水印解析与批量下载工作台

一套轻量、稳定的抖音视频解析服务，提供无水印视频解析、在线播放、单条下载、主页作品预览、会员批量任务、批量视频下载、封面与作品数据导出，以及中文管理后台。

## 主要功能

- 支持粘贴抖音分享文案、短链接、视频详情链接和用户主页链接。
- 自动识别链接并解析视频或图文内容。
- 返回无水印播放地址，并通过同源代理实现稳定预览与下载。
- 解析标题、介绍、作者、点赞、评论、转发、收藏、封面和背景音乐。
- 网站首页使用指定示例视频自动轮播，用户解析后立即切换到自己的视频。
- 支持主页作品预览、输入数量增量加载和可视化进度。
- 支持会员批量解析、持久化任务、队列进度和历史任务恢复。
- 支持批量下载视频、封面压缩包、作品数据和文案数据。
- 支持激活码注册、账号密码登录、套餐权益、并发数和队列优先级。
- 中文管理后台提供会员、激活码、套餐、限流、安全审计和任务管理。
- 支持管理员账号密码与谷歌身份验证器六位动态码。
- 评论采集和智能文案代码保留，前台默认关闭，后续可按需开启。

## 技术栈

- TypeScript
- Hono
- Node.js 22
- pnpm
- Vitest
- Playwright
- SQLite 兼容持久化存储
- Nginx 与 HTTPS

## 快速启动

```bash
pnpm install
pnpm dev
```

默认访问地址：

```text
http://localhost:8000
```

## 测试与构建

```bash
pnpm test
pnpm build
pnpm smoke:node
pnpm smoke:admin
```

## 页面入口

| 地址 | 用途 |
| --- | --- |
| `/` | 视频解析、预览、下载和批量工作台 |
| `/designs` | 界面方案预览 |
| `/admin` | 中文管理后台 |
| `/healthz` | 服务健康检查 |
| `/site.webmanifest` | 网站应用清单 |

## 兼容接口

```http
GET /?url=<douyin-url>
GET /?data&url=<douyin-url>
GET /api/hello?url=<douyin-url>
GET /api/hello?data&url=<douyin-url>
```

- `GET /?url=` 返回纯文本无水印播放地址。
- `GET /?data&url=` 返回兼容格式的 JSON 数据。

## 规范解析接口

```http
GET /api/v1/parse?url=<douyin-url>
```

成功响应：

```json
{
  "ok": true,
  "code": "OK",
  "message": "success",
  "data": {
    "source": { "input_url": "", "resolved_url": "", "aweme_id": "" },
    "author": { "nickname": null, "signature": null },
    "stats": { "comment_count": null, "digg_count": null, "share_count": null, "collect_count": null },
    "content": { "desc": null, "create_timestamp": null, "created_at": null },
    "media": { "type": "video", "video_url": null, "cover_url": null, "image_url_list": [] },
    "music": { "title": null, "author": null, "cover_url": null, "play_url": null },
    "download": { "video_proxy_url": null, "download_url": null, "filename": null },
    "compat": {}
  }
}
```

错误响应：

```json
{
  "ok": false,
  "code": "MISSING_URL",
  "message": "url query parameter is required",
  "error": { "detail": "" }
}
```

固定错误码：

```text
MISSING_URL, INVALID_URL, FETCH_FAILED, PARSE_FAILED, UNSUPPORTED_CONTENT, INTERNAL_ERROR
```

## 媒体代理与下载

```http
GET /api/v1/media?url=<encoded-media-url>
GET /api/v1/download?url=<encoded-media-url>&filename=<name.mp4>
```

媒体代理支持 HTTP Range，可用于网页播放器拖动进度和断点读取。

## 会员与批量接口

```http
GET  /api/v1/plans
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/me
POST /api/v1/profile/preview
POST /api/v1/profile/preview/stream
POST /api/v1/batch/start
GET  /api/v1/batch/tasks
GET  /api/v1/batch/queue/status
GET  /api/v1/batch/:id
GET  /api/v1/batch/:id/export?type=json|items_csv|scripts|scripts_csv|covers|covers_zip
```

主页作品预览接口支持输入目标数量、增量加载和流式进度。批量任务会持久化保存，刷新或离开页面后仍可恢复。

## 管理后台接口

```http
GET  /admin
POST /api/admin/login
POST /api/admin/logout
GET  /api/admin/totp
POST /api/admin/totp/setup
POST /api/admin/totp/verify
GET  /api/admin/dashboard
GET  /api/admin/jobs
GET  /api/admin/users
POST /api/admin/users/:id/plan
POST /api/admin/users/:id/disable
GET  /api/admin/plans
POST /api/admin/plans
GET  /api/admin/codes
POST /api/admin/codes
GET  /api/admin/rate-limits
POST /api/admin/rate-limits
GET  /api/admin/security
POST /api/admin/security
GET  /api/admin/audit-logs
```

后台采用服务端会话、HttpOnly Cookie、CSRF 校验、登录失败锁定、动态码验证和安全审计。未登录时仅返回独立登录页，登录成功后才渲染后台工作区。

## 核心环境变量

```bash
PORT=8000
DATABASE_URL=/app/.data/app.db
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password
ONLINE_BASE_COUNT=0
PARSE_RATE_LIMIT_PER_MINUTE=60
MEDIA_RATE_LIMIT_PER_MINUTE=120
BATCH_RATE_LIMIT_PER_HOUR=30
BATCH_MAX_ACTIVE_TASKS=2
BATCH_MAX_GLOBAL_CONCURRENCY=4
PUBLIC_AI_FEATURES_ENABLED=false
PUBLIC_COMMENTS_FEATURES_ENABLED=false
DOUYIN_PROFILE_BROWSER=1
DOUYIN_CHROMIUM_PATH=/usr/bin/chromium-browser
```

完整部署参数和操作步骤请查看 [中文部署文档](./DEPLOYMENT.md)。

## 多平台入口

- Node.js：`src/node.ts`
- Cloudflare Workers：`src/worker.ts`
- Deno Deploy：`src/deno.ts`
- Vercel：`api/hello.ts`
- Docker：`Dockerfile`

## 软件开发工具包导出

```ts
import { parseDouyinUrl, getNoWatermarkUrl, parseDouyinHtml } from "douyin-watermark-free-parser";
```

- `parseDouyinUrl(url, options?)`：解析抖音链接。
- `getNoWatermarkUrl(url, options?)`：获取无水印视频地址。
- `parseDouyinHtml(html, sourceUrl?)`：解析已获取的页面内容。

## 使用说明

请合理控制调用频率并妥善保管后台账号、动态码密钥和模型密钥。批量任务建议根据服务器 CPU、内存和带宽设置并发数。
