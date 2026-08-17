# Douyin Watermark-Free Parser

A lightweight Douyin parsing service with a Douyin-style creator workspace, normalized API, compatibility API, media preview proxy, download proxy, member activation, batch profile parsing, comments collection, AI copywriting, and an admin console.

## Features

- Single video/image parse from Douyin share text, short links, or detail URLs.
- Watermark-free playback URL plus same-origin `/api/v1/media` preview and `/api/v1/download` download proxy.
- Frontend workspace `抖映灵感台`; Scheme A is selected, with the video preview centered and operations around it.
- Automatic paste/clipboard recognition for Douyin links.
- Metadata parsing: title, description, author, likes, comments, shares, collects, cover, and background music.
- Real online count only; default `ONLINE_BASE_COUNT=0`.
- Member activation-code registration, account/password login, plan permissions, queue priority, and batch privileges.
- Profile works preview, member-isolated batch task history, persistent queue progress, and JSON/CSV/text/cover ZIP/comment export.
- Single and batch comments collection/import/export.
- Xiaomi/OpenAI-compatible AI copywriting for scripts, rewrites, titles, descriptions, and tags.
- Admin console `/admin` with password + optional Google Authenticator/TOTP, model config, timeout/max tokens/temperature controls, plan config, activation codes, metrics, usage logs, and audit logs.
- Admin login failed-attempt lockout with `admin_login_failed` and `admin_login_locked` audit records.
- Rate-limit interceptions are recorded in usage logs and audit logs as `rate_limit_block`.
- Admin security policies: IP blacklist, optional Origin/Referer allowlist, browser-header checks, and blocked-request audit logs.
- Admin operations: batch job list/cancel/retry, member user list/plan update/disable, and full plan-permission editing for batch AI, comments, covers, queue priority, and concurrency.

## Quick Start

```bash
pnpm install
pnpm dev
```

Open:

```text
http://localhost:8000
```

Run checks:

```bash
pnpm test
pnpm build
pnpm smoke:node
```

## Pages

| Page | Description |
| --- | --- |
| `/` | Main parsing and creator workspace |
| `/designs` | Interface scheme preview page; Scheme A is selected |
| `/admin` | Admin console |
| `/healthz` | Health check |
| `/favicon.svg`, `/favicon.ico`, `/app-icon.svg`, `/apple-touch-icon.svg`, `/site.webmanifest` | Site icon, mobile app icon, and web app manifest |

## Compatibility API

```http
GET /?url=<douyin-url>
GET /?data&url=<douyin-url>
GET /api/hello?url=<douyin-url>
GET /api/hello?data&url=<douyin-url>
```

- `GET /?url=` returns `text/plain` no-watermark playback URL.
- `GET /?data&url=` returns bare compatibility JSON.

## Normalized API

```http
GET /api/v1/parse?url=<douyin-url>
```

All response fields are stable. Missing scalar fields return `null`; list fields return arrays.

```json
{
  "ok": true,
  "code": "OK",
  "message": "success",
  "data": {
    "source": { "input_url": "", "resolved_url": "", "aweme_id": "" },
    "author": { "nickname": null, "signature": null },
    "stats": { "comment_count": null, "digg_count": null, "share_count": null, "collect_count": null },
    "content": { "desc": null, "create_timestamp": null, "created_at": null },
    "media": { "type": "video", "video_url": null, "cover_url": null, "image_url_list": [] },
    "music": { "title": null, "author": null, "cover_url": null, "play_url": null },
    "download": { "video_proxy_url": null, "download_url": null, "filename": null },
    "compat": {}
  }
}
```

Error responses use:

```json
{
  "ok": false,
  "code": "MISSING_URL",
  "message": "url query parameter is required",
  "error": { "detail": "" }
}
```

Fixed error codes:

```text
MISSING_URL, INVALID_URL, FETCH_FAILED, PARSE_FAILED, UNSUPPORTED_CONTENT, INTERNAL_ERROR
```

## Media Proxy

```http
GET /api/v1/media?url=<encoded-media-url>
GET /api/v1/download?url=<encoded-media-url>&filename=<name.mp4>
```

The proxy keeps playback/download same-origin and supports HTTP range requests.

## Member and Batch APIs

```http
GET  /api/v1/plans
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/me
POST /api/v1/batch/inspect
POST /api/v1/profile/preview
POST /api/v1/batch/start
GET  /api/v1/batch/tasks
GET  /api/v1/batch/queue/status
GET  /api/v1/batch/:id
POST /api/v1/batch/:id/ai
GET  /api/v1/batch/:id/export?type=json|items_csv|scripts|scripts_csv|covers|covers_zip|comments|comments_csv
GET  /api/v1/comments?aweme_id=<id>&count=20
GET  /api/v1/batch/:id/comments
POST /api/v1/batch/:id/comments/import
POST /api/v1/batch/:id/comments/collect
```

Registration example:

```http
POST /api/v1/auth/register
Content-Type: application/json

{ "code": "CODE-A", "username": "creator", "password": "password123" }
```

## Admin APIs

```http
GET  /admin
POST /api/admin/login
GET  /api/admin/settings/llm
POST /api/admin/settings/llm
POST /api/admin/settings/llm/test
GET  /api/admin/metrics
GET  /api/admin/usage
GET  /api/admin/audit-logs
GET  /api/admin/rate-limits
POST /api/admin/rate-limits
GET  /api/admin/security
POST /api/admin/security
POST /api/admin/block-ip
GET  /api/admin/jobs
POST /api/admin/jobs/:id/retry
POST /api/admin/jobs/:id/cancel
GET  /api/admin/users
POST /api/admin/users/:id/plan
POST /api/admin/users/:id/disable
GET  /api/admin/plans
POST /api/admin/plans
GET  /api/admin/codes
POST /api/admin/codes
```

Admin login supports username/password plus optional Google Authenticator/TOTP. Failed login attempts are locked by IP + username.

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8000` | Node server listen port |
| `DATABASE_URL` | `.data/app.db` | SQLite database path in Node |
| `VIP_INIT_CODES` | `VIP-DEMO-2026` | Initial activation codes, comma-separated |
| `VIP_SESSION_DAYS` | `30` | Member session days |
| `ADMIN_USERNAME` | `admin` | Admin username |
| `ADMIN_PASSWORD` | empty | Admin password; required for `/api/admin/login` |
| `ADMIN_TOTP_SECRET` | empty | Base32 TOTP secret for Google Authenticator |
| `ADMIN_TOKEN` | empty | Optional direct admin bearer token for server-side operation |
| `ADMIN_LOGIN_MAX_FAILURES` | `5` | Failed admin login attempts before lockout |
| `ADMIN_LOGIN_WINDOW_MINUTES` | `15` | Failure counting window |
| `ADMIN_LOGIN_LOCK_MINUTES` | `15` | Lockout duration |
| `ONLINE_BASE_COUNT` | `0` | Real online count base |
| `PARSE_RATE_LIMIT_PER_MINUTE` | `60` | Public parse limit per IP |
| `MEDIA_RATE_LIMIT_PER_MINUTE` | `120` | Media/download proxy limit per IP |
| `BATCH_RATE_LIMIT_PER_HOUR` | `30` | Batch task creation/inspection limit |
| `AI_RATE_LIMIT_PER_DAY` | `1000` | Global AI call ceiling per user |
| `COMMENTS_RATE_LIMIT_PER_DAY` | `200` | Global comments collection ceiling per user |

## Deployment

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for Node/Docker/Nginx/HTTPS deployment.

## SDK Exports

```ts
import { getNoWatermarkUrl, parseDouyinHtml, parseDouyinUrl } from "douyin-watermark-free-parser";
```

- `parseDouyinUrl(url, options?)`
- `getNoWatermarkUrl(url, options?)`
- `parseDouyinHtml(html, sourceUrl?)`
