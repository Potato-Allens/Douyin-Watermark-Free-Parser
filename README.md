# Douyin Watermark-Free Parser

抖音单条视频/图文解析服务，内置抖音风格 Web UI、规范 API、兼容接口、视频预览代理、下载代理、真实在线人数、会员激活与主页批量解析任务。

## 功能

- 单条解析：粘贴抖音分享文本、短链或详情页链接，自动解析无水印视频地址。
- 自动预览：前端使用同源 `/api/v1/media` 代理播放，解决部分直链浏览器不能播放的问题。
- 自动下载：解析成功后可自动触发 `/api/v1/download` 下载。
- 作品信息：返回标题/介绍、作者、点赞、评论、转发、收藏、封面、背景音乐。
- 图文解析：返回去重后的图片列表。
- 会员批量：激活码激活后，可输入主页链接，先获取作品数量，再按数量和并发数创建批量解析任务。
- 真实在线：默认基础人数为 `0`，页面只展示活跃浏览器心跳统计。
- 多运行时：Node/Docker、Vercel、Cloudflare Workers、Deno Deploy。

## 快速启动

```bash
pnpm install
pnpm dev
```

访问：

```text
http://localhost:8000
```

## Web UI

打开首页后，直接粘贴抖音分享链接即可自动识别：

```text
https://v.douyin.com/xxxx/
```

页面会自动展示：

- 视频预览
- 下载按钮
- 点赞/评论/转发/收藏
- 标题/介绍
- 背景音乐
- 封面
- 真实在线人数
- 会员批量解析入口

## API

### 兼容接口

```http
GET /?url=<douyin-url>
```

返回 `text/plain` 无水印视频直链。

```http
GET /?data&url=<douyin-url>
GET /api/hello?data&url=<douyin-url>
```

返回兼容 JSON。

### 规范接口

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

- `MISSING_URL`
- `INVALID_URL`
- `FETCH_FAILED`
- `PARSE_FAILED`
- `UNSUPPORTED_CONTENT`
- `INTERNAL_ERROR`

### 预览/下载代理

```http
GET /api/v1/media?url=<video-url>
GET /api/v1/download?url=<video-url>&filename=douyin.mp4
```

- `/media`：同源预览，支持 Range。
- `/download`：附件下载，自动设置文件名。

### 真实在线人数

```http
GET /api/v1/online
POST /api/v1/online/ping
```

`POST /api/v1/online/ping` 示例：

```json
{ "client_id": "browser-session-id" }
```

### 会员激活

默认初始激活码：

```text
VIP-DEMO-2026
```

生产环境请通过环境变量覆盖：

```bash
VIP_INIT_CODES="CODE-A,CODE-B,CODE-C"
VIP_SESSION_DAYS=30
DATABASE_URL=".data/app.db"
```

激活：

```http
POST /api/v1/vip/activate
Content-Type: application/json

{ "code": "CODE-A" }
```

状态：

```http
GET /api/v1/vip/status
Authorization: Bearer <vip-token>
```

### 会员批量解析

获取主页作品数量：

```http
POST /api/v1/batch/inspect
Authorization: Bearer <vip-token>
Content-Type: application/json

{ "url": "https://www.douyin.com/user/xxxx" }
```

创建批量任务：

```http
POST /api/v1/batch/start
Authorization: Bearer <vip-token>
Content-Type: application/json

{
  "url": "https://www.douyin.com/user/xxxx",
  "count": 10,
  "concurrency": 3
}
```

查询任务：

```http
GET /api/v1/batch/<task-id>
Authorization: Bearer <vip-token>
```

## SDK

```ts
import { getNoWatermarkUrl, parseDouyinHtml, parseDouyinUrl } from "douyin-watermark-free-parser";

const parsed = await parseDouyinUrl("https://v.douyin.com/xxxx/");
const videoUrl = await getNoWatermarkUrl("https://v.douyin.com/xxxx/");
const fixture = parseDouyinHtml("<html>...</html>", "https://www.douyin.com/video/xxxx");
```

## 验证

```bash
pnpm test
pnpm build
pnpm smoke:node
```

## 部署

新手部署请看：

```text
DEPLOYMENT.md
```

Docker 快速启动：

```bash
docker build -t douyin-parser .
docker run -d --name douyin-parser -p 8000:8000 \
  -e VIP_INIT_CODES="CODE-A,CODE-B" \
  -e DATABASE_URL="/app/.data/app.db" \
  douyin-parser
```

## 目录

```text
src/
  app.ts              Hono 应用与 API 路由
  ui.ts               抖音风格前端页面
  node.ts             Node/Docker 入口
  worker.ts           Cloudflare Workers 入口
  deno.ts             Deno Deploy 入口
  core/
    parser.ts         单条解析核心
    media-proxy.ts    视频预览/下载代理
    profile.ts        主页作品探测
    batch.ts          批量任务
    vip.ts            激活码与会员会话
    types.ts          类型定义
    errors.ts         统一错误
api/
  hello.ts            Vercel 入口
  [...path].ts        Vercel API 兜底入口
tests/
  *.test.ts           单元测试/API 测试
```
