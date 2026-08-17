# 验证记录

时间：2026-08-17 11:03 Asia/Shanghai  
工作区：`C:\Users\Administrator\Documents\抖音解析-客户小宝`

## 最终结论

- Vercel 项目名已从 `douyin-parser-xiaobao` 改为 `douyin-parser-allen`。
- 生产域名已改为 `https://douyin-parser-allen.vercel.app`。
- `douyin-parser-xiaobao.vercel.app` 已从 Vercel alias list 移除。
- 真实抖音视频解析、图文解析、兼容接口、规范 v1 接口、Node、Deno、Vercel Dev、Vercel 生产、Docker、Cloudflare Worker dry-run 全部通过验证。

## Vercel 项目与生产部署

项目链接：

```json
{
  "projectId": "prj_0jPQpqNn3MdAqlCMDJMmCgwV4aU4",
  "orgId": "team_kbnLs7TmmaZFoWyLrgq5ahJU",
  "projectName": "douyin-parser-allen"
}
```

生产部署：

- 生产入口：`https://douyin-parser-allen.vercel.app`
- 当前生产部署：`https://douyin-parser-allen-pckg182pc-1253068081-7941s-projects.vercel.app`
- SSO Deployment Protection：已关闭，公网请求不再 302 到 Vercel SSO。
- Alias list 只剩：
  - `douyin-parser-allen.vercel.app`
  - `douyin-parser-allen-1253068081-7941s-projects.vercel.app`

## 关键修复

### Vercel 函数 500

远端日志曾出现两类问题：

1. `ERR_MODULE_NOT_FOUND: Cannot find package 'hono' imported from /var/task/api/v1/parse.js`
2. `default export returned a Response` / `Cannot read properties of undefined (reading 'length')`

处理结果：

- `scripts/build-vercel.ts` 改为把 Hono 和核心解析逻辑完整 bundle 到 `api/_generated/app.js`。
- `api/hello.ts`、`api/v1/parse.ts` 改为 Vercel classic Node `(req, res)` handler，并在内部转换为 Web `Request` 后调用 `app.fetch()`。
- `package.json` 固定 `engines.node` 为 `22.x`，避免 Vercel 使用 Node 24 运行时造成不确定性。
- `scripts/vercel-dev-smoke.ts` 改为使用当前已登录 Vercel 全局配置，避免临时空 `--global-config` 触发 token 校验失败。
- 删除了 Vercel CLI 自动写入、会干扰 dev 的临时 `.env.local`。

### WSL / Docker

已处理 Docker Desktop WSL backend 启动问题：

```powershell
wsl.exe --update --web-download
wsl.exe --shutdown
Start-Service com.docker.service
Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
```

验证结果：

- `wsl.exe --update --web-download`：exit code `0`
- Docker Desktop：`4.83.0`
- Docker Engine：`29.6.2`
- `pnpm verify:docker`：通过

Docker 构建链路也已修复：`scripts/docker-smoke.ts` 导出 Windows 信任 CA 为 BuildKit secret，Dockerfile 在 build/runtime 阶段合并 CA bundle，容器内真实解析和媒体 Range 校验通过。

## 最终全量验证

命令：

```powershell
pnpm verify
```

结果：exit code `0`

覆盖项：

- `pnpm test`：2 个测试文件、16 个测试全部通过。
- `pnpm build`：`scripts/build-vercel.ts` + `tsc --noEmit` 通过。
- `pnpm smoke`：真实视频解析通过。
- `pnpm smoke:image-real`：真实图文解析通过，7 张图片全部 Range 校验通过。
- `pnpm smoke:server-real`：Node HTTP 真实服务通过。
- `npx deno check src/deno.ts`：Deno 入口类型检查通过。
- `pnpm smoke:deno-real`：Deno HTTP 真实服务通过。
- `pnpm verify:vercel-dev`：Vercel Dev 本地真实服务通过。
- `pnpm verify:vercel-remote`：Vercel 生产远端真实服务通过。
- `pnpm verify:docker`：Docker 容器真实服务通过。
- `npx wrangler deploy --dry-run --outdir .wrangler-dry-run`：Cloudflare Worker bundle 通过，Total Upload `99.03 KiB`，gzip `23.76 KiB`。

## 生产远端接口验证

命令：

```powershell
pnpm verify:vercel-remote
```

结果：exit code `0`

输入：`https://v.douyin.com/L5pbfdP/`  
远端：`https://douyin-parser-allen.vercel.app`

响应状态：

- `GET /api/v1/parse` 缺 url：`400`，错误码 `MISSING_URL`
- `GET /api/v1/parse?url=...`：`200`
- `GET /?url=...`：`200`
- `GET /?data&url=...`：`200`
- `GET /api/hello?data&url=...`：`200`

真实视频媒体校验：

- aweme_id：`6914948781100338440`
- v1 / compat_text / compat_data / api_hello 返回的视频直链均通过 Range 校验
- Range：`bytes=0-4095`
- 媒体响应：`206`
- Content-Type：`video/mp4`
- Content-Range：`bytes 0-4095/1454940`
- Bytes：`4096`
- URL 检查：未包含 `playwm`、`watermark=1`、`logo_name=` 水印标记

## 真实图文接口验证

命令：

```powershell
pnpm smoke:image-real
```

结果：exit code `0`

输入：`https://www.douyin.com/note/7188492958054829327`

结果：

- aweme_id：`7188492958054829327`
- media_type：`image`
- image_count：`7`
- `GET /api/v1/parse`：`200`
- `GET /?data&url=...`：`200`
- `GET /api/hello?data&url=...`：`200`
- `GET /?url=...`：`415`，符合图文内容无单视频直链的设计
- 7 张图片全部 Range 校验：`206 / image/webp`

## 注意

本机当前 Node 是 `v24.18.0`，因此 pnpm 会打印：

```text
[WARN] Unsupported engine: wanted: {"node":"22.x"} (current: {"node":"v24.18.0"})
```

该提示不影响验证结果；Vercel 生产运行时按 `package.json` 的 `engines.node=22.x` 执行。
