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
