# 中文部署文档

本项目可作为轻量 Node.js 服务运行，并通过 Nginx 配置域名和 HTTPS。以下示例域名为 `dy.devforai.cn`。

## 一、本地检查

```bash
pnpm install
pnpm test
pnpm build
pnpm smoke:node
pnpm smoke:admin
```

全部命令通过后再上传服务器。

## 二、服务器环境

推荐配置：

- Ubuntu 22.04 或更高版本
- Node.js 22
- pnpm
- Nginx
- Chromium
- FFmpeg（仅智能口播功能需要）

安装基础软件：

```bash
sudo apt-get update
sudo apt-get install -y nginx chromium-browser ffmpeg
corepack enable
corepack prepare pnpm@11.17.0 --activate
```

不同系统的 Chromium 命令可能是 `chromium`，可使用下面的命令确认：

```bash
command -v chromium-browser || command -v chromium
```

## 三、上传项目

```bash
sudo mkdir -p /www/wwwroot/dy.devforai.cn
sudo chown -R "$USER":"$USER" /www/wwwroot/dy.devforai.cn
cd /www/wwwroot/dy.devforai.cn
git clone https://github.com/Potato-Allens/Douyin-Watermark-Free-Parser.git .
pnpm install --frozen-lockfile
pnpm build
```

## 四、环境变量

创建 `.env` 文件，或在 systemd、宝塔面板等进程管理工具中配置：

```bash
PORT=8000
DATABASE_URL=/www/wwwroot/dy.devforai.cn/.data/app.db
VIP_INIT_CODES=CODE-A,CODE-B
VIP_SESSION_DAYS=30
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password
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
COMMENT_STORE_DIR=/www/wwwroot/dy.devforai.cn/.data/comments
COMMENTS_MAX_TOP_LEVEL_PER_JOB=50000
COMMENTS_TASK_CACHE_LIMIT=200
COMMENTS_PAGE_DELAY_MS=250
DOUYIN_PROFILE_BROWSER=1
DOUYIN_COMMENTS_BROWSER=1
DOUYIN_CHROMIUM_PATH=/usr/bin/chromium-browser
ADMIN_LOGIN_MAX_FAILURES=5
ADMIN_LOGIN_WINDOW_MINUTES=15
ADMIN_LOGIN_LOCK_MINUTES=15
ASR_MAX_CONCURRENCY=1
ASR_MAX_QUEUE=20
ASR_MAX_VIDEO_BYTES=125829120
ASR_MAX_AUDIO_BYTES=25165824
ASR_MEDIA_TIMEOUT_MS=120000
FFMPEG_PATH=/usr/bin/ffmpeg
FFMPEG_TIMEOUT_MS=120000
```

请将 `ADMIN_PASSWORD` 改为高强度密码。首次绑定动态码时，后台登录页会在账号密码验证通过后生成一次性二维码；绑定成功后二维码入口自动隐藏。

## 五、创建 systemd 服务

创建 `/etc/systemd/system/douyin-parser.service`：

```ini
[Unit]
Description=抖音无水印解析服务
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

启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now douyin-parser
sudo systemctl status douyin-parser
```

查看日志：

```bash
sudo journalctl -u douyin-parser -f
```

## 六、配置 Nginx

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

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/dy.devforai.cn /etc/nginx/sites-enabled/dy.devforai.cn
sudo nginx -t
sudo systemctl reload nginx
```

## 七、开启 HTTPS

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d dy.devforai.cn
sudo certbot renew --dry-run
```

证书完成后访问：

```text
https://dy.devforai.cn/
https://dy.devforai.cn/admin
https://dy.devforai.cn/healthz
```

## 八、上线检查

```bash
curl -fsS https://dy.devforai.cn/healthz
curl -I https://dy.devforai.cn/
curl -I https://dy.devforai.cn/admin
```

健康检查应返回：

```json
{"ok":true,"code":"OK","message":"healthy"}
```

## 九、更新版本

```bash
cd /www/wwwroot/dy.devforai.cn
git pull
pnpm install --frozen-lockfile
pnpm build
sudo systemctl restart douyin-parser
curl -fsS https://dy.devforai.cn/healthz
```

更新前建议备份 `.data`、`.env` 和当前源码。

## 十、常见问题

### 主页作品读取失败

确认 Chromium 已安装，并检查：

```bash
echo "$DOUYIN_CHROMIUM_PATH"
command -v chromium-browser || command -v chromium
```

### 视频可以加载但拖动进度失败

确认 Nginx 未缓存媒体代理响应，并保留 `proxy_buffering off`。项目媒体代理已支持 HTTP Range。

### 动态码登录异常

确认服务器时间同步：

```bash
timedatectl status
sudo timedatectl set-ntp true
```

### 批量任务速度较慢

根据服务器配置调整：

```bash
BATCH_MAX_ACTIVE_TASKS=2
BATCH_MAX_GLOBAL_CONCURRENCY=4
```

低配置服务器应使用较小并发，避免内存和带宽占用过高。

### 关闭智能文案和评论功能

```bash
PUBLIC_AI_FEATURES_ENABLED=false
PUBLIC_COMMENTS_FEATURES_ENABLED=false
```

关闭后前台隐藏相关入口，保留后端代码供后续开启。

## 十一、Docker 部署

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

检查容器：

```bash
docker logs -f douyin-parser
curl -fsS http://127.0.0.1:8000/healthz
```
