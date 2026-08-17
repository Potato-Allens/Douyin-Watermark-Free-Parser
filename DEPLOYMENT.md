# Deployment Guide

This project can run as a lightweight Node service behind Nginx. The examples below use `dy.devforai.cn`.

## 1. Local Verification

```bash
pnpm install
pnpm test
pnpm build
pnpm smoke:node
```

## 2. Environment Variables

Create a `.env` file or configure these variables in your process manager:

```bash
PORT=8000
DATABASE_URL=/app/.data/app.db
VIP_INIT_CODES=CODE-A,CODE-B
VIP_SESSION_DAYS=30
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password
ADMIN_TOTP_SECRET=BASE32_TOTP_SECRET
ONLINE_BASE_COUNT=0
PARSE_RATE_LIMIT_PER_MINUTE=60
MEDIA_RATE_LIMIT_PER_MINUTE=120
BATCH_RATE_LIMIT_PER_HOUR=30
AI_RATE_LIMIT_PER_DAY=1000
COMMENTS_RATE_LIMIT_PER_DAY=200
ADMIN_LOGIN_MAX_FAILURES=5
ADMIN_LOGIN_WINDOW_MINUTES=15
ADMIN_LOGIN_LOCK_MINUTES=15
```

`ADMIN_TOTP_SECRET` is a Base32 secret that can be added to Google Authenticator. If it is empty, only username/password is checked.

## 3. Node/systemd Deployment

```bash
git clone https://github.com/Potato-Allens/Douyin-Watermark-Free-Parser.git /www/wwwroot/dy.devforai.cn
cd /www/wwwroot/dy.devforai.cn
pnpm install --frozen-lockfile
pnpm build
```

Create `/etc/systemd/system/douyin-parser.service`:

```ini
[Unit]
Description=Douyin Watermark-Free Parser
After=network.target

[Service]
WorkingDirectory=/www/wwwroot/dy.devforai.cn
Environment=PORT=8000
Environment=DATABASE_URL=/www/wwwroot/dy.devforai.cn/.data/app.db
Environment=ONLINE_BASE_COUNT=0
Environment=ADMIN_USERNAME=admin
Environment=ADMIN_PASSWORD=change-this-password
Environment=ADMIN_TOTP_SECRET=BASE32_TOTP_SECRET
ExecStart=/usr/local/bin/pnpm start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now douyin-parser
sudo systemctl status douyin-parser
curl http://127.0.0.1:8000/healthz
```

## 4. Docker Deployment

```bash
git clone https://github.com/Potato-Allens/Douyin-Watermark-Free-Parser.git /opt/douyin-parser
cd /opt/douyin-parser

docker build -t douyin-parser .
docker rm -f douyin-parser 2>/dev/null || true
docker run -d \
  --name douyin-parser \
  --restart unless-stopped \
  -p 127.0.0.1:8000:8000 \
  -e PORT=8000 \
  -e DATABASE_URL=/app/.data/app.db \
  -e VIP_INIT_CODES="CODE-A,CODE-B" \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD="change-this-password" \
  -e ADMIN_TOTP_SECRET="BASE32_TOTP_SECRET" \
  -e ONLINE_BASE_COUNT=0 \
  douyin-parser
```

Verify:

```bash
curl http://127.0.0.1:8000/healthz
```

## 5. Nginx Reverse Proxy

Create a site config for `dy.devforai.cn`:

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
    proxy_set_header Range $http_range;
    proxy_set_header If-Range $http_if_range;
    proxy_buffering off;
  }
}
```

Reload Nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 6. HTTPS

If Certbot is installed:

```bash
sudo certbot --nginx -d dy.devforai.cn
sudo nginx -t
sudo systemctl reload nginx
```

If using a hosting panel, create an SSL certificate in the panel and keep the reverse proxy target as `http://127.0.0.1:8000`.

## 7. Smoke Checks

```bash
curl -i https://dy.devforai.cn/healthz
curl -i https://dy.devforai.cn/favicon.svg
curl -i "https://dy.devforai.cn/api/v1/parse"
curl -i https://dy.devforai.cn/designs
```

Expected:

- `/healthz` returns `200 OK`.
- `/api/v1/parse` without `url` returns `400` with `MISSING_URL`.
- `/designs` shows Scheme A selected.
- `/admin` opens the admin login page.
