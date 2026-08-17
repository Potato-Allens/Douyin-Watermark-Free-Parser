# Douyin Watermark-Free Parser

基于 **TypeScript + Hono** 开发的抖音视频/图文解析服务，提供兼容接口、规范化 v1 数据接口和 SDK，支持 Node、Docker、Vercel、Cloudflare Workers、Deno Deploy 多运行时部署。

## 功能

- 解析抖音短链、分享链接、视频详情页链接。
- 返回真实无水印视频直链，并校验媒体资源可访问。
- 支持图文内容解析，返回去重后的图片列表。
- 兼容参考项目接口：`/?url=`、`/?data&url=`、`/api/hello?...`。
- 新增规范化接口：`/api/v1/parse?url=`。
- SDK 导出：`parseDouyinUrl`、`getNoWatermarkUrl`、`parseDouyinHtml`。
- 支持 Node、Docker、Vercel、Cloudflare Workers、Deno Deploy。

## 快速开始

```bash
pnpm install
pnpm dev
```

默认监听：

```text
http://localhost:8000
```

示例：

```bash
curl "http://localhost:8000/?url=https%3A%2F%2Fv.douyin.com%2Fxxxx%2F"
curl "http://localhost:8000/?data&url=https%3A%2F%2Fv.douyin.com%2Fxxxx%2F"
curl "http://localhost:8000/api/v1/parse?url=https%3A%2F%2Fv.douyin.com%2Fxxxx%2F"
```

## 兼容接口

### `GET /?url=<douyin-url>`

返回 `text/plain` 无水印视频直链。

```text
https://v11-cold-src.douyinvod.com/.../video/tos/.../?mime_type=video_mp4&...
```

图文内容没有单一视频直链时返回：

```json
{
  "ok": false,
  "code": "UNSUPPORTED_CONTENT",
  "message": "image content has no video url",
  "error": {
    "detail": ""
  }
}
```

### `GET /?data&url=<douyin-url>`

返回兼容格式 JSON。

```json
{
  "aweme_id": "6914948781100338440",
  "comment_count": 100943,
  "digg_count": 2902205,
  "share_count": 107283,
  "collect_count": 73864,
  "nickname": "Real机智张",
  "signature": "24/7 REAL",
  "desc": "让你在几秒钟之内记住我",
  "create_time": "2021-01-07 09:33:13",
  "video_url": "https://...",
  "type": "video",
  "image_url_list": []
}
```

### `GET /api/hello?...`

与 `/` 行为完全一致，用于 Vercel 兼容入口。

## 规范化 v1 接口

### `GET /api/v1/parse?url=<douyin-url>`

成功响应：

```json
{
  "ok": true,
  "code": "OK",
  "message": "success",
  "data": {
    "source": {
      "input_url": "",
      "resolved_url": "",
      "aweme_id": ""
    },
    "author": {
      "nickname": null,
      "signature": null
    },
    "stats": {
      "comment_count": null,
      "digg_count": null,
      "share_count": null,
      "collect_count": null
    },
    "content": {
      "desc": null,
      "create_timestamp": null,
      "created_at": null
    },
    "media": {
      "type": "video",
      "video_url": null,
      "image_url_list": []
    },
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
  "error": {
    "detail": ""
  }
}
```

固定错误码：

- `MISSING_URL`
- `INVALID_URL`
- `FETCH_FAILED`
- `PARSE_FAILED`
- `UNSUPPORTED_CONTENT`
- `INTERNAL_ERROR`

## SDK

```ts
import { getNoWatermarkUrl, parseDouyinHtml, parseDouyinUrl } from "./src/index.ts";

const result = await parseDouyinUrl("https://v.douyin.com/xxxx/");
const videoUrl = await getNoWatermarkUrl("https://v.douyin.com/xxxx/");
const parsed = parseDouyinHtml("<html>...</html>", "https://www.douyin.com/video/xxxx");
```

## 项目结构

```text
src/
  app.ts              Hono HTTP 应用
  node.ts             Node 入口
  worker.ts           Cloudflare Workers 入口
  deno.ts             Deno Deploy 入口
  core/
    parser.ts         核心解析逻辑
    types.ts          类型定义
    errors.ts         统一错误
api/
  hello.ts            Vercel 兼容入口
  v1/parse.ts         Vercel v1 入口
scripts/
  verify.ts           全量验证
  *-smoke.ts          真实链路 smoke test
tests/
  *.test.ts           单元/API 测试
```

## 验证

```bash
pnpm test
pnpm build
pnpm smoke
pnpm smoke:image-real
pnpm smoke:server-real
pnpm smoke:deno-real
pnpm smoke:vercel-dev
pnpm smoke:vercel-remote
pnpm verify
```

默认真实视频 smoke 输入：

```bash
pnpm smoke
```

指定真实图文链接：

```powershell
$env:SMOKE_DOUYIN_IMAGE_URL="https://www.douyin.com/note/xxxx"
pnpm smoke:image-real
```

`pnpm verify` 会覆盖：

- 单元测试
- TypeScript 类型检查
- 真实视频解析
- 真实图文解析
- Node HTTP 服务
- Deno HTTP 服务
- Vercel Dev 本地服务
- Vercel 生产远端服务
- Docker 容器服务
- Cloudflare Worker dry-run bundle

## 部署

### Node

```bash
pnpm start
```

### Docker

```bash
docker build -t douyin-parser .
docker run -p 8000:8000 douyin-parser
pnpm verify:docker
```

`pnpm verify:docker` 会构建镜像、启动临时容器、请求真实抖音链接，并校验四个 HTTP 接口与视频 Range 响应。Windows 环境中的 CA 会通过 BuildKit secret 注入容器，避免公司代理或本机证书链导致 TLS 校验失败。`.docker-ca/` 已加入 `.gitignore`。

### Vercel

项目包含 `api/hello.ts`、`api/v1/parse.ts` 和 `vercel.json`，导入后可直接部署。

访问示例：

```text
https://your-domain.vercel.app/api/hello?url=https://v.douyin.com/xxxx/
https://your-domain.vercel.app/api/v1/parse?url=https://v.douyin.com/xxxx/
```

本地 Vercel build：

```bash
pnpm verify:vercel
```

本地 Vercel Dev 真接口校验：

```bash
pnpm verify:vercel-dev
```

生产远端真接口校验：

```bash
pnpm verify:vercel-remote
```

默认校验：

```text
https://douyin-parser-allen.vercel.app
```

如需校验其它部署：

```bash
VERCEL_REMOTE_BASE_URL=https://your-domain.vercel.app pnpm verify:vercel-remote
```

### Cloudflare Workers

```bash
npx wrangler deploy
npx wrangler deploy --dry-run --outdir .wrangler-dry-run
```

入口：`src/worker.ts`。

### Deno Deploy

入口：`src/deno.ts`。

## 数据接口约定

- 所有响应字段固定存在。
- 未解析到的标量字段返回 `null`。
- 列表字段返回数组，空列表返回 `[]`。
- v1 接口使用 ISO `created_at`。
- 兼容接口保留 `create_time` 字符串。
- 遇到移动分享页的 ByteDance WAF proof-of-work 页面时，会计算 `_wafchallengeid` 后重试一次；若重试页面仍没有真实媒体字段，则返回 `PARSE_FAILED`，不会构造虚假媒体 URL。

## 验证记录

完整验证过程和结果见：

```text
VERIFICATION.md
```
