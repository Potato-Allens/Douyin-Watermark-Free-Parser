# 部署文档

这份文档只写最常用的部署方式，按步骤执行即可。

## 1. 准备环境

需要安装：

- Node.js 22
- pnpm
- Git

安装依赖：

```bash
pnpm install
```

本地检查：

```bash
pnpm test
pnpm build
```

## 2. 本地启动

```bash
pnpm start
```

默认地址：

```text
http://localhost:8000
```

测试接口：

```bash
curl "http://localhost:8000/api/v1/parse?url=https://v.douyin.com/xxxx/"
```

## 3. Vercel 部署

推荐新手优先用 Vercel，最简单。

### 方法一：网页导入 GitHub 仓库

1. 打开 Vercel。
2. 点击 **Add New Project**。
3. 选择 GitHub 仓库：

```text
Potato-Allens/Douyin-Watermark-Free-Parser
```

4. Framework 选择 **Other**。
5. Build Command 保持默认或填写：

```bash
pnpm build
```

6. Install Command 保持默认或填写：

```bash
pnpm install
```

7. 点击 Deploy。

部署完成后访问：

```text
https://你的域名.vercel.app/api/v1/parse?url=https://v.douyin.com/xxxx/
```

### 方法二：命令行部署

登录 Vercel：

```bash
npx vercel login
```

绑定项目：

```bash
npx vercel link
```

部署预览环境：

```bash
npx vercel deploy
```

部署生产环境：

```bash
npx vercel deploy --prod
```

验证生产环境：

```bash
VERCEL_REMOTE_BASE_URL=https://你的域名.vercel.app pnpm verify:vercel-remote
```

## 4. Docker 部署

构建镜像：

```bash
docker build -t douyin-parser .
```

启动容器：

```bash
docker run -d --name douyin-parser -p 8000:8000 douyin-parser
```

访问：

```text
http://服务器IP:8000/api/v1/parse?url=https://v.douyin.com/xxxx/
```

停止容器：

```bash
docker stop douyin-parser
docker rm douyin-parser
```

本地 Docker 验证：

```bash
pnpm verify:docker
```

## 5. Cloudflare Workers 部署

登录 Cloudflare：

```bash
npx wrangler login
```

先做一次 dry-run 检查：

```bash
npx wrangler deploy --dry-run --outdir .wrangler-dry-run
```

正式部署：

```bash
npx wrangler deploy
```

入口文件：

```text
src/worker.ts
```

## 6. Deno Deploy 部署

Deno 入口文件：

```text
src/deno.ts
```

部署时选择该文件作为入口即可。

本地 Deno 检查：

```bash
npx deno check src/deno.ts
pnpm smoke:deno-real
```

## 7. 常用接口

规范接口：

```text
GET /api/v1/parse?url=<抖音链接>
```

兼容接口：

```text
GET /?url=<抖音链接>
GET /?data&url=<抖音链接>
GET /api/hello?url=<抖音链接>
GET /api/hello?data&url=<抖音链接>
```

## 8. 上线前验证

推荐执行：

```bash
pnpm verify
```

它会检查：

- 单元测试
- TypeScript 构建
- 真实抖音视频解析
- 真实抖音图文解析
- Node 服务
- Deno 服务
- Vercel Dev
- Vercel 生产远端
- Docker 容器
- Cloudflare Worker dry-run

如果只想快速验证生产域名：

```bash
VERCEL_REMOTE_BASE_URL=https://你的域名.vercel.app pnpm verify:vercel-remote
```

## 9. 当前已验证生产地址

```text
https://douyin-parser-allen.vercel.app
```

示例：

```text
https://douyin-parser-allen.vercel.app/api/v1/parse?url=https://v.douyin.com/xxxx/
```

## 10. 常见问题

### Vercel 部署后 500

先看日志：

```bash
npx vercel logs https://你的域名.vercel.app
```

然后重新构建部署：

```bash
pnpm build
npx vercel deploy --prod
```

### Docker 里请求失败

先确认本机 Docker 正常：

```bash
docker version
```

再执行：

```bash
pnpm verify:docker
```

### 直链浏览器不能直接播放

有些 `douyinvod` 直链会限制浏览器热链播放，但接口返回的直链是真实可访问的。程序内验证会用正确请求头做 Range 校验。
