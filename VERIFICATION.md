# 验证记录

时间：2026-08-17 20:00 Asia/Shanghai
工作区：`C:\Users\Administrator\Documents\抖音解析-客户小宝`

## 本次完成

- 首页改为抖音风格 Web UI：粘贴识别、自动解析、视频预览、自动下载、作品信息展示。
- v1 数据接口补齐封面、背景音乐、下载代理地址。
- 新增同源媒体代理：`/api/v1/media` 与 `/api/v1/download`，支持 Range 预览和附件下载。
- 新增在线人数：`/api/v1/online` 与 `/api/v1/online/ping`。
- 新增会员激活：`/api/v1/vip/activate` 与 `/api/v1/vip/status`。
- 新增会员批量主页解析任务：`/api/v1/batch/inspect`、`/api/v1/batch/start`、`/api/v1/batch/:id`。
- 更新 `README.md` 与 `DEPLOYMENT.md`，补齐 `dy.devforai.cn` Docker + Nginx 部署文档。

## 已通过验证

### 单元/API 测试

```powershell
pnpm test
```

结果：

```text
Test Files  2 passed (2)
Tests       20 passed (20)
Exit code   0
```

### 构建与类型检查

```powershell
pnpm build
```

结果：

```text
scripts/build-vercel.ts completed
tsc --noEmit completed
Exit code 0
```

### Node 本地服务 smoke

```powershell
pnpm smoke:node
```

结果：

```json
{
  "NODE_SMOKE_STATUS": 200,
  "NODE_SMOKE_BODY": {
    "ok": true,
    "code": "OK",
    "message": "healthy"
  }
}
```

### 会员激活接口 smoke

命令：使用测试 `VipStore` 调用 `/api/v1/vip/activate` 与 `/api/v1/vip/status`。

结果：

```json
{
  "activate_status": 200,
  "activated": true,
  "status_status": 200,
  "status": { "ok": true, "code": "OK", "message": "success" }
}
```

### 真实抖音链接服务 smoke

输入：

```text
https://v.douyin.com/jC_sgt3I3PQ/
```

命令：

```powershell
$env:SMOKE_DOUYIN_URL='https://v.douyin.com/jC_sgt3I3PQ/'
pnpm smoke:server-real
```

结果：

```json
{
  "aweme_id": "6914948781100338440",
  "statuses": {
    "v1": 200,
    "compat_text": 200,
    "compat_data": 200,
    "api_hello": 200
  },
  "media": {
    "v1": { "status": 206, "contentType": "video/mp4", "contentRange": "bytes 0-4095/844227" },
    "compat_text": { "status": 206, "contentType": "video/mp4", "contentRange": "bytes 0-4095/844227" },
    "compat_data": { "status": 206, "contentType": "video/mp4", "contentRange": "bytes 0-4095/844227" },
    "api_hello": { "status": 206, "contentType": "video/mp4", "contentRange": "bytes 0-4095/844227" }
  },
  "exitCode": 0
}
```

### 同源预览代理 smoke

命令：通过 `createApp()` 先解析真实链接，再请求返回的 `download.video_proxy_url`。

结果：

```json
{
  "input": "https://v.douyin.com/jC_sgt3I3PQ/",
  "aweme_id": "6914948781100338440",
  "proxy_status": 206,
  "content_type": "video/mp4",
  "content_range": "bytes 0-1023/844227",
  "bytes": 1024
}
```

### Deno / Cloudflare 入口

```powershell
npx deno check src/deno.ts
npx wrangler deploy --dry-run --outdir .wrangler-dry-run
```

结果：

```text
Deno check: pass
Wrangler dry-run: pass
Total Upload: 172.73 KiB / gzip: 37.87 KiB
Exit code: 0
```

### Vercel 构建

```powershell
npx vercel build --yes
```

结果：

```text
Build completed
Exit code: 0
```

## 未完成的服务器上线条件

服务器已通过宝塔终端完成上线：

- 服务器：`47.97.126.85`
- 域名：`http://dy.devforai.cn`
- 应用目录：`/www/wwwroot/dy.devforai.cn`
- systemd 服务：`douyin-parser`
- 运行端口：`127.0.0.1:8000`
- Nginx 配置：`/www/server/panel/vhost/nginx/dy.devforai.cn.conf`
- 部署日志：`/root/douyin-parser-deploy.log`

线上验证：

```powershell
Invoke-WebRequest -UseBasicParsing -Uri "http://dy.devforai.cn/healthz"
Invoke-WebRequest -UseBasicParsing -Uri "http://dy.devforai.cn/"
Invoke-WebRequest -UseBasicParsing -Uri "http://dy.devforai.cn/api/v1/parse?url=https%3A%2F%2Fv.douyin.com%2FjC_sgt3I3PQ%2F"
curl.exe -I -r 0-1023 "<download.video_proxy_url>"
```

结果：

```text
healthz: 200 {"ok":true,"code":"OK","message":"healthy"}
home page: 200, contains "抖音视频解析"
parse: 200, ok=true, aweme_id=6914948781100338440, media.type=video
media proxy: 206 Partial Content, Content-Type=video/mp4, Content-Range=bytes 0-1023/844227
```

本机 Docker Desktop 当前 daemon 未启动，因此本机 `pnpm verify:docker` 停在 Docker API 连接阶段；线上使用服务器已有 Node.js 22 + pnpm + 宝塔 Nginx 方式运行。


## 2026-08-17 20:54 ??????

### ????

- ?????????????????????`ONLINE_BASE_COUNT=0`????? `/api/v1/online/ping` ?????
- ???????? `@media(max-width:720px)`?????????????????????????????????
- ??????????/??????????????????????
- ?? HTTPS ????Nginx ???? `X-Forwarded-Proto: https` ? `X-Forwarded-Host`????? `https://` ???????

### ??????

```powershell
pnpm test
pnpm build
```

???`tests/parser.test.ts`?`tests/api.test.ts` ? `21 passed`?`tsc --noEmit` ???

### ??????

???`https://dy.devforai.cn`

```powershell
Invoke-WebRequest -UseBasicParsing -Uri "https://dy.devforai.cn/healthz"
Invoke-WebRequest -UseBasicParsing -Uri "https://dy.devforai.cn/"
Invoke-WebRequest -UseBasicParsing -Uri "https://dy.devforai.cn/api/v1/online"
Invoke-WebRequest -UseBasicParsing -Method Post -Uri "https://dy.devforai.cn/api/v1/online/ping" -ContentType "application/json" -Body '{"client_id":"codex-verify-mobile"}'
Invoke-WebRequest -UseBasicParsing -Uri "https://dy.devforai.cn/api/v1/parse?url=https%3A%2F%2Fv.douyin.com%2FjC_sgt3I3PQ%2F"
curl.exe -I -r 0-1023 "<download.video_proxy_url>"
```

???

```json
{
  "healthStatus": 200,
  "rootStatus": 200,
  "hasTitle": true,
  "hasOnlineElement": true,
  "hasFakeCurrentOnline": false,
  "hasMobileMedia": true,
  "captionOutsideVideo": true,
  "onlineGetStatus": 200,
  "onlinePingStatus": 200,
  "parseStatus": 200,
  "awemeId": "6914948781100338440",
  "proxyScheme": "https",
  "mediaHead": "HTTP/1.1 206 Partial Content | Content-Type: video/mp4 | Content-Range: bytes 0-1023/844227"
}
```


## 2026-08-17 21:22 ?????????

### ????

- ?????????????????TypeScript + Hono + Node.js 22 + SQLite + systemd + Nginx HTTPS?
- ??????????????????????????????/??/?????????????? AI ??????????
- ??????????????`?? <number>`????????? / ????????????
- ???????`/favicon.svg`?
- ?? AI ????????
  - `/api/v1/ai/script`?????????/???????????
  - `/api/admin/login`?????????? `ADMIN_TOTP_SECRET` ? Google Authenticator ?? TOTP?
  - `/api/admin/settings/llm`??????????/???
  - `/api/admin/settings/llm/test`???????????
  - `/api/admin/metrics`??????AI ??????????
- ??????? Base URL?`https://token-plan-cn.xiaomimimo.com/v1`?
- ??????????? Key ???????????????????????

### ????

```powershell
pnpm test
pnpm build
```

???

```text
tests/parser.test.ts passed
tests/api.test.ts passed
21 passed
tsc --noEmit passed
```

### ????

???`https://dy.devforai.cn`

```powershell
Invoke-WebRequest -UseBasicParsing -Uri "https://dy.devforai.cn/healthz"
Invoke-WebRequest -UseBasicParsing -Uri "https://dy.devforai.cn/?v=creator"
Invoke-WebRequest -UseBasicParsing -Uri "https://dy.devforai.cn/favicon.svg"
Invoke-WebRequest -UseBasicParsing -Method Post -Uri "https://dy.devforai.cn/api/v1/online/ping" -ContentType "application/json" -Body '{"client_id":"creator-verify"}'
Invoke-WebRequest -UseBasicParsing -Uri "https://dy.devforai.cn/api/admin/settings/llm" -Headers @{Authorization='Bearer <ADMIN_TOKEN>'}
Invoke-WebRequest -UseBasicParsing -Uri "https://dy.devforai.cn/api/v1/parse?url=https%3A%2F%2Fv.douyin.com%2FjC_sgt3I3PQ%2F"
```

???

```json
{
  "health": 200,
  "root": 200,
  "title": true,
  "old_words": false,
  "online_only": true,
  "favicon": 200,
  "ai_panel": true,
  "admin_llm": 200,
  "parse": 200,
  "aweme": "6914948781100338440",
  "proxy_scheme": "https"
}
```
## Creator Workbench Member/Admin Update - 2026-08-17 21:46 Asia/Shanghai

Scope:
- Frontend renamed to 抖映灵感台 and kept video preview as the center stage.
- Added member account registration/login after activation code validation.
- Added `/admin` lightweight console with admin login, TOTP support, Xiaomi LLM settings, member plans, activation codes, metrics.
- Added plan-aware AI rate limit, batch count limit and concurrency limit.
- Added local browser persistence for the latest batch task id.

Changed paths:
- `src/app.ts`
- `src/admin-ui.ts`
- `src/core/vip.ts`
- `src/ui.ts`
- `tests/api.test.ts`
- `README.md`
- `docs/short-video-creator-workbench-dev-plan.md`

Verification commands:

```powershell
pnpm test
```
Result: 2 test files passed, 23 tests passed, exit status 0.

```powershell
pnpm build
```
Result: `tsx scripts/build-vercel.ts && pnpm typecheck`, `tsc --noEmit`, exit status 0.

```powershell
@'
import { createApp } from './src/app.ts';
import { createMemoryVipStore } from './src/core/index.ts';
const u=(s)=>JSON.parse('"'+s+'"');
const app = createApp({ vipStore: await createMemoryVipStore(['DEMO-003']) });
const html = await (await app.request('/')).text();
const adminHtml = await (await app.request('/admin')).text();
const reg = await app.request('/api/v1/auth/register', { method:'POST', body: JSON.stringify({code:'DEMO-003', username:'allen_demo', password:'password123'}) });
const regBody = await reg.json();
const me = await app.request('/api/v1/me', { headers:{authorization:'Bearer '+regBody.data.token} });
console.log(JSON.stringify({homeStatus:200, product:html.includes(u('\\u6296\\u6620\\u7075\\u611f\\u53f0')), centered:html.includes(u('\\u89c6\\u9891\\u5728\\u4e2d\\u5fc3')), memberRegister:html.includes(u('\\u6fc0\\u6d3b\\u5e76\\u521b\\u5efa\\u8d26\\u53f7')), admin:adminHtml.includes(u('\\u89e3\\u6790\\u4e2d\\u63a7\\u53f0')), adminGarbled:adminHtml.includes('????'), regStatus:reg.status, meStatus:me.status, meType:(await me.json()).data.session_type},null,2));
'@ | pnpm exec tsx -
```
Result:
```json
{
  "homeStatus": 200,
  "product": true,
  "centered": true,
  "memberRegister": true,
  "admin": true,
  "adminGarbled": false,
  "regStatus": 200,
  "meStatus": 200,
  "meType": "member"
}
```
Exit status 0.

## Production Deployment - 2026-08-17 21:56 Asia/Shanghai

Commit deployed: `ecabb102f848364949136a2634749f2d36da3339`
Domain: `https://dy.devforai.cn`
Server app dir: `/www/wwwroot/dy.devforai.cn`
Service: `douyin-parser`

Deployment evidence:
- Uploaded archive bytes: `85788`
- Uploaded archive SHA256: `9d144ca7dae124b0ea09ad677e7e1aa12084c4127fad43d2a2b90e57a7761a7b`
- Server decode result: `85788 /tmp/douyin-parser-main.tar.gz`
- Server SHA256 result: `9d144ca7dae124b0ea09ad677e7e1aa12084c4127fad43d2a2b90e57a7761a7b /tmp/douyin-parser-main.tar.gz`
- Deploy result: `DEPLOY_OK dy.devforai.cn port=8000 app=/www/wwwroot/dy.devforai.cn log=/root/douyin-parser-deploy.log`
- systemd result: `douyin-parser.service active (running)`

Production verification commands/results:

```powershell
Invoke-WebRequest -UseBasicParsing https://dy.devforai.cn/healthz
```
Result: HTTP 200, body `{"ok":true,"code":"OK","message":"healthy"}`, exit status 0.

```powershell
Invoke-WebRequest -UseBasicParsing https://dy.devforai.cn/?v=<random>
```
Result: HTTP 200, page contains `抖映灵感台`, `视频在中心`, `激活并创建账号`, exit status 0.

```powershell
Invoke-WebRequest -UseBasicParsing https://dy.devforai.cn/admin?v=<random>
```
Result: HTTP 200, page contains `解析中控台`, no `????` garbled marker, exit status 0.

```powershell
GET https://dy.devforai.cn/api/v1/plans
GET https://dy.devforai.cn/api/v1/me
GET https://dy.devforai.cn/api/admin/settings/llm Authorization: Bearer <admin-token>
GET https://dy.devforai.cn/api/admin/metrics Authorization: Bearer <admin-token>
```
Result: all HTTP 200; `/api/v1/me` guest permissions returned; admin LLM base_url is `https://token-plan-cn.xiaomimimo.com/v1`; metrics returned online state, exit status 0.

```powershell
POST https://dy.devforai.cn/api/admin/codes Authorization: Bearer <admin-token>
POST https://dy.devforai.cn/api/v1/auth/register
GET https://dy.devforai.cn/api/v1/me Authorization: Bearer <member-token>
```
Result: admin code creation HTTP 200; registration HTTP 200; `/api/v1/me` returned `session_type: member`, plan `standard`, exit status 0.
## Batch AI Export Update - 2026-08-17 22:01 Asia/Shanghai

Scope:
- Added persistent batch task file `.data/batch-tasks.json`.
- Added batch item metadata fields: author, music, stats, AI copy and comments.
- Added `POST /api/v1/batch/:id/ai` for batch oral-copy/title/description/tag generation.
- Added `GET /api/v1/batch/:id/export?type=json|scripts|covers|comments`.
- Added frontend buttons for batch AI generation and exports.

Changed paths:
- `src/core/batch.ts`
- `src/app.ts`
- `src/ui.ts`
- `tests/api.test.ts`
- `README.md`
- `docs/short-video-creator-workbench-dev-plan.md`

Verification commands:

```powershell
pnpm test
```
Result: 2 test files passed, 24 tests passed, exit status 0.

```powershell
pnpm build
```
Result: `tsx scripts/build-vercel.ts && pnpm typecheck`, `tsc --noEmit`, exit status 0.

Batch API coverage:
- Test fixture starts a profile batch task from a mocked Douyin homepage.
- Polls `/api/v1/batch/:id` until completion.
- Calls `/api/v1/batch/:id/ai` and verifies `generated_count = 1`.
- Calls `/api/v1/batch/:id/export?type=json` and verifies attached JSON contains `ai_copy`.
- Calls `/api/v1/batch/:id/export?type=scripts` and verifies text contains the expected `aweme_id`.
## Production Deployment - 2026-08-17 22:05 Asia/Shanghai

Commit deployed: `5477b4f53e2d1a294a1d2fd63a35938e39281c44`
Domain: `https://dy.devforai.cn`

Deployment evidence:
- Uploaded archive bytes: `90775`
- Uploaded archive SHA256: `0A693974CA8E7A9C9C124C6E35D5823A9A495784FC5F0307224394602D132764`
- Server decode result: `90775 /tmp/douyin-parser-main.tar.gz`
- Server SHA256 result: `0a693974ca8e7a9c9c124c6e35d5823a9a495784fc5f0307224394602d132764 /tmp/douyin-parser-main.tar.gz`
- Deploy result: `DEPLOY_OK dy.devforai.cn port=8000 app=/www/wwwroot/dy.devforai.cn log=/root/douyin-parser-deploy.log`
- systemd result: `douyin-parser.service active (running)`

Production verification:

```powershell
Invoke-WebRequest -UseBasicParsing https://dy.devforai.cn/healthz
```
Result: HTTP 200, body `{"ok":true,"code":"OK","message":"healthy"}`, exit status 0.

```powershell
Invoke-WebRequest -UseBasicParsing https://dy.devforai.cn/?v=5477b4f
```
Result: HTTP 200, page contains `批量生成文案` and `导出 JSON`, exit status 0.

```powershell
POST https://dy.devforai.cn/api/admin/codes
POST https://dy.devforai.cn/api/v1/auth/register
POST https://dy.devforai.cn/api/v1/batch/not-found/ai
GET  https://dy.devforai.cn/api/v1/batch/not-found/export?type=json
```
Result: admin code creation and member registration succeeded; new batch AI route and export route returned controlled `404` for unknown task under a valid member token, proving the deployed routes are active, exit status 0.

## 2026-08-17 22:15 +08:00 - Profile preview queue and centered workbench update

Changed branch: main
Changed files:
- docs/short-video-creator-workbench-dev-plan.md
- src/app.ts
- src/core/batch.ts
- src/ui.ts
- tests/api.test.ts

Local verification:
- Command: pnpm test
- Result: exit 0; 2 test files passed; 25 tests passed.
- Command: pnpm build
- Result: exit 0; tsx scripts/build-vercel.ts and tsc --noEmit passed.

Functional coverage added:
- POST /api/v1/profile/preview for member profile work previews.
- GET /api/v1/batch/queue/status for active/queued task visibility.
- queue_priority and queue_position persisted on batch tasks.
- GET/POST batch comment import/read routes, covered by API tests.
- UI keeps video preview as the center stage and lets profile work cards load into the center preview.

## 2026-08-17 22:25 +08:00 - Visual UI scheme chooser

Changed branch: main
Changed files:
- src/designs-ui.ts
- src/app.ts
- tests/api.test.ts

Local verification:
- Command: pnpm test
- Result: exit 0; 2 test files passed; 26 tests passed.
- Command: pnpm build
- Result: exit 0; tsx scripts/build-vercel.ts and tsc --noEmit passed.

Functional coverage added:
- GET /designs renders four selectable UI directions A/B/C/D.
- Scheme C is highlighted as the recommended video-centered creator panel direction.
