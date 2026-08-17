# 抖音无水印解析服务

一个独立实现的抖音视频/图文解析服务，提供兼容接口、规范化 v1 数据接口和 SDK，支持 Node/Docker、Vercel、Cloudflare Workers、Deno Deploy 等运行环境。

## 功能

- 解析抖音分享短链或长链。
- 视频：返回无水印播放直链。
- 图文：返回去重后的图片列表。
- 兼容参考项目接口：`/?url=`、`/?data&url=`、`/api/hello?...`。
- 新增规范化接口：`/api/v1/parse?url=`。
- SDK 导出：`parseDouyinUrl`、`getNoWatermarkUrl`、`parseDouyinHtml`。

## 快速开始

```bash
pnpm install
pnpm dev
```

默认监听：`http://localhost:8000`

```bash
curl "http://localhost:8000/?url=https%3A%2F%2Fv.douyin.com%2Fxxxx%2F"
curl "http://localhost:8000/?data&url=https%3A%2F%2Fv.douyin.com%2Fxxxx%2F"
curl "http://localhost:8000/api/v1/parse?url=https%3A%2F%2Fv.douyin.com%2Fxxxx%2F"
```

## 兼容接口

### `GET /?url=<douyin-url>`

成功时返回 `text/plain`：

```text
https://v11-cold-src.douyinvod.com/.../video/tos/.../?mime_type=video_mp4&...
```

缺少 `url` 时返回：

```text
请提供url参数
```

### `GET /?data&url=<douyin-url>`

成功时返回裸 JSON：

```json
{
  "aweme_id": "string|null",
  "comment_count": "number|null",
  "digg_count": "number|null",
  "share_count": "number|null",
  "collect_count": "number|null",
  "nickname": "string|null",
  "signature": "string|null",
  "desc": "string|null",
  "create_time": "YYYY-MM-DD HH:mm:ss|null",
  "video_url": "https://*.douyinvod.com/...|null",
  "type": "video",
  "image_url_list": []
}
```

图文内容中，兼容字段 `type` 返回 `img`，`image_url_list` 返回图片数组。

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
      "input_url": "string",
      "resolved_url": "string",
      "aweme_id": "string|null"
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
      "video_url": "https://*.douyinvod.com/...|null",
      "image_url_list": []
    },
    "compat": {
      "aweme_id": "string|null",
      "comment_count": "number|null",
      "digg_count": "number|null",
      "share_count": "number|null",
      "collect_count": "number|null",
      "nickname": "string|null",
      "signature": "string|null",
      "desc": "string|null",
      "create_time": "YYYY-MM-DD HH:mm:ss|null",
      "video_url": "https://*.douyinvod.com/...|null",
      "type": "video|img|null",
      "image_url_list": []
    }
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

const parsed = await parseDouyinUrl("https://v.douyin.com/xxxx/");
console.log(parsed.media.type, parsed.media.video_url, parsed.media.image_url_list);

const videoUrl = await getNoWatermarkUrl("https://v.douyin.com/xxxx/");

const fromHtml = parseDouyinHtml("<html>...</html>", "https://www.douyin.com/video/...");
```

## 测试与验证

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

真实 smoke 默认使用仓库内置的公开抖音视频链接，也可以用环境变量覆盖：

```bash
$env:SMOKE_DOUYIN_URL="https://v.douyin.com/xxxx/"
pnpm smoke
$env:SMOKE_DOUYIN_IMAGE_URL="https://www.douyin.com/note/xxxx"
pnpm smoke:image-real
```

## 真实解析策略

- 优先通过 `aweme_id` 请求移动端 feed 数据，解析 `play_addr`、统计、作者、标题与图集字段。
- feed 不返回目标作品时，自动获取 `ttwid` 并请求 Web detail 数据，用于图文/笔记等场景。
- 分享页遇到 ByteDance WAF proof-of-work 页面时，计算 `_wafchallengeid` 后重试一次。
- 视频直链会发起 Range 校验，要求返回视频 `content-type` 或 `ftyp` 头，且过滤 `playwm`、`watermark=1`、`logo_name` 等水印标记。
- 图片列表会按图集条目选择可访问图片 URL，过滤 `/obj/` 资源、去重，并发起 Range 校验确保真实图片可读。
- HTTP 应用层默认对同一输入 URL 做 60 秒内存缓存；缓存只保存已成功解析且已校验的真实结果，用于降低多接口连续请求时的上游抖动。

## 部署

### Node / Docker

```bash
pnpm start
pnpm smoke:server-real
```

Docker：

```bash
docker build -t douyin-parser .
docker run -p 8000:8000 douyin-parser
pnpm verify:docker
```

`pnpm verify:docker` 会构建镜像、启动临时容器、请求真实抖音链接并校验四个 HTTP 接口与视频 Range 响应，结束后删除临时容器。

### Vercel

项目包含 `api/hello.ts`、`api/v1/parse.ts` 和 `vercel.json`，导入后可直接部署。访问：

```text
https://your-domain.vercel.app/api/hello?url=https://v.douyin.com/xxxx/
https://your-domain.vercel.app/api/v1/parse?url=https://v.douyin.com/xxxx/
```

本地构建校验：

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

默认校验 `https://douyin-parser-allen.vercel.app`；如需校验其它部署：

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
- 碰到移动分享页的 ByteDance WAF proof-of-work 页面时，会计算 `_wafchallengeid` 后重试一次；若重试页面仍没有真实媒体字段，则返回 `PARSE_FAILED`，不会构造虚假媒体 URL。


`pnpm verify:docker` ?????????????????????????? HTTP ????? Range ?????????????Windows ??????????? CA ?? BuildKit secret ?????????????/??????????? TLS ??????????? `.docker-ca/`???? `.gitignore`?
