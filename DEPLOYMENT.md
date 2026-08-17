# 部署文档

目标域名示例：`dy.devforai.cn`

## 1. 本地检查

```bash
pnpm install
pnpm test
pnpm build
pnpm smoke:node
```

## 2. Docker 部署

服务器安装 Docker 后执行：

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
  -e VIP_INIT_CODES="请改成你的激活码1,请改成你的激活码2" \
  -e VIP_SESSION_DAYS=30 \
  -e ONLINE_BASE_COUNT=0 \
  douyin-parser
```

检查：

```bash
curl http://127.0.0.1:8000/healthz
```

## 3. Nginx 绑定域名

创建配置：

```bash
sudo tee /etc/nginx/sites-available/dy.devforai.cn >/dev/null <<'EOF'
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
EOF

sudo ln -sf /etc/nginx/sites-available/dy.devforai.cn /etc/nginx/sites-enabled/dy.devforai.cn
sudo nginx -t
sudo systemctl reload nginx
```

浏览器访问：

```text
http://dy.devforai.cn
```

## 4. HTTPS

如果服务器已安装 Certbot：

```bash
sudo certbot --nginx -d dy.devforai.cn
```

HTTPS 完成后访问：

```text
https://dy.devforai.cn
```

## 5. 更新版本

```bash
cd /opt/douyin-parser
git pull
docker build -t douyin-parser .
docker rm -f douyin-parser 2>/dev/null || true
docker run -d \
  --name douyin-parser \
  --restart unless-stopped \
  -p 127.0.0.1:8000:8000 \
  -e PORT=8000 \
  -e DATABASE_URL=/app/.data/app.db \
  -e VIP_INIT_CODES="请改成你的激活码1,请改成你的激活码2" \
  -e VIP_SESSION_DAYS=30 \
  -e ONLINE_BASE_COUNT=0 \
  douyin-parser
```

## 6. 常用接口检查

```bash
curl "https://dy.devforai.cn/api/v1/parse?url=https://v.douyin.com/xxxx/"
curl "https://dy.devforai.cn/api/v1/online"
curl -X POST "https://dy.devforai.cn/api/v1/vip/activate" \
  -H "Content-Type: application/json" \
  -d '{"code":"你的激活码"}'
```

## 7. 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8000` | 服务监听端口 |
| `DATABASE_URL` | `.data/app.db` | 会员激活码 SQLite 数据库路径 |
| `VIP_INIT_CODES` | `VIP-DEMO-2026` | 初始激活码，逗号分隔 |
| `VIP_SESSION_DAYS` | `30` | 会员会话有效天数 |
| `ONLINE_BASE_COUNT` | `0` | 在线人数基础值 |

## 8. 页面功能

- 首页：输入或粘贴抖音分享链接。
- 自动识别：点击“启用剪贴板识别”后，复制链接会自动填入并解析。
- 预览：解析后使用同源代理播放视频。
- 下载：解析成功后自动下载，也可点击“下载视频”。
- 批量：激活会员后，输入主页链接，先获取数量，再输入下载数量和并发数。
