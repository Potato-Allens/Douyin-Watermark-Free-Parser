# 中文部署文档

本文档适用于 Node.js + Chromium + Nginx 的完整部署方式。线上主链路以 Node.js 运行；Cloudflare Workers、Deno Deploy 和 Vercel 入口主要用于兼容解析接口。

## 0. 上线功能状态

| 模块 | 上线状态 | 环境开关/依赖 |
| --- | --- | --- |
| 单条解析、预览、下载 | 已启用 | Node.js、Nginx |
| 主页作品预览与增量获取 | 已启用 | Chromium、`DOUYIN_PROFILE_BROWSER=1` |
| 会员批量任务与视频下载 | 已启用 | 持久化目录、队列参数 |
| 会员、套餐、激活码、后台 | 已启用 | 管理员密码、动态码 |
| 评论采集与导出 | 未收口，前台隐藏 | `PUBLIC_COMMENTS_FEATURES_ENABLED=false` |
| 智能口播与文案改写 | 已关闭，前台隐藏 | `PUBLIC_AI_FEATURES_ENABLED=false` |

隐藏模块的源码仍保留。正式打开前应完成接口、资源、限流、失败恢复与大数据量专项验收。

## 1. 本地检查

```bash
pnpm install
pnpm test
pnpm build
pnpm smoke:node
pnpm smoke:admin
```

## 2. 服务器环境

- Ubuntu 22.04 或更新版本
- Node.js 22
- pnpm 11
- Nginx
- Chromium
- FFmpeg（仅保留的口播模块使用）

```bash
sudo apt-get update
sudo apt-get install -y nginx chromium-browser ffmpeg
corepack enable
corepack prepare pnpm@11.17.0 --activate
command -v chromium-browser || command -v chromium
```

## 3. 获取项目

```bash
sudo mkdir -p /www/wwwroot/dy.devforai.cn
sudo chown -R "$USER":"$USER" /www/wwwroot/dy.devforai.cn
cd /www/wwwroot/dy.devforai.cn
git clone https://github.com/Potato-Allens/Douyin-Watermark-Free-Parser.git .
pnpm install --frozen-lockfile
pnpm build
mkdir -p .data/comments
```

## 4. 环境变量

创建 `/www/wwwroot/dy.devforai.cn/.env`：

```bash
PORT=8000
DATABASE_URL=/www/wwwroot/dy.devforai.cn/.data/app.db

ADMIN_USERNAME=admin
ADMIN_PASSWORD=请替换为高强度随机密码
ADMIN_LOGIN_MAX_FAILURES=5
ADMIN_LOGIN_WINDOW_MINUTES=15
ADMIN_LOGIN_LOCK_MINUTES=15

VIP_INIT_CODES=
VIP_SESSION_DAYS=30

ONLINE_BASE_COUNT=0
PARSE_RATE_LIMIT_PER_MINUTE=60
MEDIA_RATE_LIMIT_PER_MINUTE=120
BATCH_RATE_LIMIT_PER_HOUR=30
BATCH_MAX_ACTIVE_TASKS=2
BATCH_MAX_GLOBAL_CONCURRENCY=4
BATCH_QUEUE_PRESSURE_ONLINE=5
BATCH_QUEUE_PRESSURE_STEP=5

PUBLIC_AI_FEATURES_ENABLED=false
PUBLIC_COMMENTS_FEATURES_ENABLED=false
AI_RATE_LIMIT_PER_DAY=1000
COMMENTS_RATE_LIMIT_PER_DAY=200

DOUYIN_PROFILE_BROWSER=1
DOUYIN_COMMENTS_BROWSER=0
DOUYIN_CHROMIUM_PATH=/usr/bin/chromium-browser

COMMENT_STORE_DIR=/www/wwwroot/dy.devforai.cn/.data/comments
COMMENTS_MAX_TOP_LEVEL_PER_JOB=50000
COMMENTS_TASK_CACHE_LIMIT=200
COMMENTS_PAGE_DELAY_MS=250

ASR_MAX_CONCURRENCY=1
ASR_MAX_QUEUE=20
ASR_MAX_VIDEO_BYTES=125829120
ASR_MAX_AUDIO_BYTES=25165824
ASR_MEDIA_TIMEOUT_MS=120000
FFMPEG_PATH=/usr/bin/ffmpeg
FFMPEG_TIMEOUT_MS=120000
```

配置原则：

- `.env` 权限设为仅服务账号可读：`chmod 600 .env`。
- 管理员密码、模型 Key、动态码密钥和会话密钥仅写入环境变量或后台加密配置。
- Git 仓库、部署脚本、终端记录和截图中只保留占位值。
- 首次绑定动态码后，二维码入口会自动隐藏。

## 5. systemd 服务

创建 `/etc/systemd/system/douyin-parser.service`：

```ini
[Unit]
Description=Douyin parser service
After=network.target

[Service]
Type=simple
WorkingDirectory=/www/wwwroot/dy.devforai.cn
EnvironmentFile=/www/wwwroot/dy.devforai.cn/.env
ExecStart=/usr/bin/env pnpm start
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now douyin-parser
sudo systemctl status douyin-parser
sudo journalctl -u douyin-parser -f
```

生产环境可创建独立低权限服务账号，并将项目目录和 `.data` 所有权交给该账号。

## 6. Nginx

创建 `/etc/nginx/sites-available/dy.devforai.cn`：

```nginx
server {
    listen 80;
    server_name dy.devforai.cn;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        proxy_buffering off;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/dy.devforai.cn /etc/nginx/sites-enabled/dy.devforai.cn
sudo nginx -t
sudo systemctl reload nginx
```

## 7. HTTPS

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d dy.devforai.cn
sudo certbot renew --dry-run
```

访问入口：

```text
https://dy.devforai.cn/
https://dy.devforai.cn/admin
https://dy.devforai.cn/healthz
```

## 8. 上线验收

```bash
curl -fsS https://dy.devforai.cn/healthz
curl -I https://dy.devforai.cn/
curl -I https://dy.devforai.cn/admin
```

健康检查响应：

```json
{"ok":true,"code":"OK","message":"healthy"}
```

人工验收清单：

1. 分享链接能够解析并预览。
2. 视频进度可拖动，下载响应文件名正常。
3. 主页链接能够按目标数量加载并显示进度。
4. 会员登录后能够创建批量任务并恢复历史进度。
5. 批量下载和封面 ZIP 能够生成。
6. `/admin` 在未登录时只展示独立登录页。
7. 动态码首次绑定成功后二维码设置入口隐藏。
8. 评论和口播入口在当前配置下保持隐藏。

## 9. 更新版本

```bash
cd /www/wwwroot/dy.devforai.cn
cp -a .data ".data.backup.$(date +%Y%m%d%H%M%S)"
git pull
pnpm install --frozen-lockfile
pnpm test
pnpm build
sudo systemctl restart douyin-parser
curl -fsS https://dy.devforai.cn/healthz
```

`.env` 单独保管，升级包中不携带该文件。

## 10. 临时 SSH 密钥清理

部署期间使用临时公钥时，结束后从服务账号的 `~/.ssh/authorized_keys` 精确移除对应行，并删除本地临时私钥与公钥。保留长期运维密钥时，应使用独立名称、口令和最小权限账号。

检查仓库提交内容：

```bash
git ls-files | grep -E '(^|/)(\.env|.*\.pem|id_rsa|id_ed25519)$' || true
git grep -n -E 'BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY|ghp_[A-Za-z0-9]+' || true
```

## 11. 常见问题

### 主页作品读取失败

```bash
echo "$DOUYIN_CHROMIUM_PATH"
command -v chromium-browser || command -v chromium
sudo journalctl -u douyin-parser -n 200 --no-pager
```

同时检查服务器时间、网络、Chromium 依赖和抖音页面响应。

### 视频加载后进度拖动异常

保留 `proxy_buffering off`，确认媒体接口返回 `Accept-Ranges`、`Content-Range` 与 `206 Partial Content`。

### 动态码校验异常

```bash
timedatectl status
sudo timedatectl set-ntp true
```

### 批量任务资源占用较高

低配置服务器可先使用：

```bash
BATCH_MAX_ACTIVE_TASKS=1
BATCH_MAX_GLOBAL_CONCURRENCY=2
```

### 隐藏评论与口播模块

```bash
PUBLIC_AI_FEATURES_ENABLED=false
PUBLIC_COMMENTS_FEATURES_ENABLED=false
DOUYIN_COMMENTS_BROWSER=0
```

修改后重启服务：

```bash
sudo systemctl restart douyin-parser
```

## 12. Docker

```bash
docker build -t douyin-parser .
docker run -d \
  --name douyin-parser \
  --restart always \
  -p 8000:8000 \
  -v "$(pwd)/.data:/app/.data" \
  --env-file .env \
  douyin-parser
```

```bash
docker logs -f douyin-parser
curl -fsS http://127.0.0.1:8000/healthz
```

## 13. 使用边界

本项目仅用于个人学习、技术研究、功能验证和内部测试，禁止商业使用。完整条款见 [LICENSE.md](./LICENSE.md)。
