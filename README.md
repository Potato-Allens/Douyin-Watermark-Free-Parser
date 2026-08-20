# Douyin Watermark-Free Parser

A lightweight Douyin parsing service with a Douyin-style creator workspace, normalized API, compatibility API, media preview proxy, download proxy, member activation, batch profile parsing, optional comment collection/AI modules, and an admin console.

## Features

- Single video/image parse from Douyin share text, short links, or detail URLs.
- Watermark-free playback URL plus same-origin `/api/v1/media` preview and `/api/v1/download` download proxy.
- Frontend workspace `抖映灵感台`; Scheme A is selected, with the video preview centered and operations around it.
- Automatic paste/clipboard recognition for Douyin links.
- Metadata parsing: title, description, author, likes, comments, shares, collects, cover, and background music.
- Real online count only; default `ONLINE_BASE_COUNT=0`.
- Member activation-code registration, account/password login, plan permissions, queue priority, and batch privileges.
- Profile works preview, member-isolated batch task history, persistent queue progress, and JSON/CSV/text/cover ZIP export.
- Comment collection code and APIs are retained for later use, including incremental cursor collection, second-level replies, JSONL persistence, keyword search, selection, JSON/CSV export, per-video progress, and multi-video concurrency. The public comment UI is hidden by default with `PUBLIC_COMMENTS_FEATURES_ENABLED=false`.
- Real speech-to-text with Xiaomi `mimo-v2.5-asr`: the Node service extracts MP3 audio with FFmpeg, sends it as `input_audio`, and forwards the recognized transcript into Xiaomi/OpenAI-compatible rewriting, title, description, and tag generation. When ASR is disabled the API explicitly reports a degraded metadata draft.
- Admin console `/admin` with a server-gated login entry, HttpOnly cookie session, password + Google Authenticator/TOTP self-service setup, model config, timeout/max tokens/temperature controls, plan config, activation codes, metrics, usage logs, and audit logs.
- Admin login failed-attempt lockout with `admin_login_failed` and `admin_login_locked` audit records.
- Cookie-session mutations use double-submit CSRF tokens; bearer-token API calls remain supported for the web UI and server-side operation.
- Rate-limit interceptions are recorded in usage logs and audit logs as `rate_limit_block`.
- Admin security policies: IP blacklist, optional Origin/Referer allowlist, browser-header checks, and blocked-request audit logs.
- Admin operations: API usage summary, batch job list/cancel/retry, member user list/plan update/disable, and full plan-permission editing for batch AI, comments, covers, queue priority, and concurrency.

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
pnpm smoke:admin
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
POST /api/v1/auth/activate-register
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/me
POST /api/v1/batch/inspect
POST /api/v1/profile/inspect
GET  /api/v1/profile/:id/videos?count=12&offset=0
POST /api/v1/profile/preview
POST /api/v1/batch/start
POST /api/v1/jobs/start
GET  /api/v1/batch/tasks
GET  /api/v1/batch/queue/status
GET  /api/v1/batch/:id
GET  /api/v1/jobs/:id
GET  /api/v1/jobs/:id/items
GET  /api/v1/jobs/:id/export.json
GET  /api/v1/batch/:id/jobs
POST /api/v1/batch/:id/ai
GET  /api/v1/batch/:id/export?type=json|items_csv|scripts|scripts_csv|covers|covers_zip|comments|comments_csv
GET  /api/v1/comments?aweme_id=<id>&count=20
GET  /api/v1/comments/export?aweme_id=<id>&type=json|csv
GET  /api/v1/comments/export?task_id=<batch-id>&type=json|csv
GET  /api/v1/batch/:id/comments
GET  /api/v1/batch/:id/comments/export?type=json|csv
POST /api/v1/batch/:id/comments/import
POST /api/v1/batch/:id/comments/fetch
POST /api/v1/batch/:id/comments/collect   # compatibility alias for /comments/fetch
POST /api/v1/comments/collect
GET  /api/v1/comments/collection/:id?aweme_id=<id>&q=<keyword>&offset=0&limit=100
POST /api/v1/comments/collection/:id/export
POST /api/v1/ai/transcript
POST /api/v1/ai/script
POST /api/v1/ai/rewrite
POST /api/v1/ai/tags
POST /api/v1/ai/batch
```

The comment APIs are backend-ready but not shown in the public workbench by default. They only read comments and never post replies. Pass `"async": true` to queue collection and poll the collection/task endpoint for persisted progress.

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
POST /api/admin/logout
GET  /api/admin/totp
POST /api/admin/totp/setup
POST /api/admin/totp/verify
GET  /api/admin/settings/llm
POST /api/admin/settings/llm
POST /api/admin/settings/llm/test
POST /api/admin/settings/llm/test-asr
GET  /api/admin/dashboard
GET  /api/admin/metrics
GET  /api/admin/usage/summary
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
POST /api/admin/jobs/:id/post-jobs/:jobId/cancel
GET  /api/admin/users
POST /api/admin/users/:id/plan
POST /api/admin/users/:id/disable
GET  /api/admin/plans
POST /api/admin/plans
GET  /api/admin/codes
POST /api/admin/codes
GET  /api/admin/activation-codes
POST /api/admin/activation-codes
```

Admin login supports username/password plus Google Authenticator/TOTP. Before authentication, `GET /admin` returns only the dedicated login page; the backend workspace markup is rendered only for a valid server-side cookie session. If no authenticator has been bound yet, `/api/admin/totp/bootstrap` can generate the first QR after username/password verification, and `/api/admin/totp/bootstrap/verify` verifies the 6-digit code, enables TOTP, and creates the admin session. Once TOTP is enabled, reading an existing QR/secret also requires the current 6-digit code. Logged-in admins can use `/api/admin/totp/setup` and `/api/admin/totp/verify` to rotate, enable, or disable stored TOTP, and `/api/admin/logout` revokes the server session. Cookie mutations require CSRF, failed login attempts are locked by IP + username, auth request bodies are JSON-only and size-limited, and admin pages/responses are marked `no-store`. `/api/admin/dashboard` aggregates online count, adaptive queue capacity, usage summary, rate limits, security policy summary, and recent jobs for the admin overview. The job console shows persisted batch `post_jobs` for async AI/comment work and can cancel queued/running post-processing jobs.

### Xiaomi ASR configuration

Open `/admin` → **AI 模型** and configure:

- Shared Xiaomi API Key.
- ASR endpoint: `https://api.xiaomimimo.com/v1` (or a compatible Xiaomi Token Plan gateway).
- ASR model: `mimo-v2.5-asr`.
- Language: `auto`, `zh`, or `en`.
- Enable **口播识别**, click **测试语音识别**, then save.

`POST /api/v1/ai/transcript` then performs real video-audio recognition. The response uses `provider: "xiaomi_asr"` for a real transcript and `provider: "metadata_draft", degraded: true` only when ASR is disabled. `POST /api/v1/ai/rewrite` accepts the returned text in the `transcript` field, and batch AI requests use `transcribe: true` to recognize each video's audio before rewriting. Xiaomi's API accepts MP3/WAV audio through `/v1/chat/completions`; see the [official speech-recognition documentation](https://mimo.mi.com/docs/zh-CN/api/audio/Speech-Recognition).

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8000` | Node server listen port |
| `DATABASE_URL` | `.data/app.db` | SQLite database path in Node |
| `VIP_INIT_CODES` | `VIP-DEMO-2026` | Initial activation codes, comma-separated |
| `VIP_SESSION_DAYS` | `30` | Member session days |
| `ADMIN_USERNAME` | `admin` | Admin username |
| `ADMIN_PASSWORD` | empty | Admin password; required for `/api/admin/login` |
| `ADMIN_TOTP_SECRET` | empty | Optional env-managed Base32 TOTP secret; when empty, configure TOTP from `/admin` |
| `ADMIN_TOKEN` | empty | Optional direct admin bearer token for server-side operation |
| `ADMIN_LOGIN_MAX_FAILURES` | `5` | Failed admin login attempts before lockout |
| `ADMIN_LOGIN_WINDOW_MINUTES` | `15` | Failure counting window |
| `ADMIN_LOGIN_LOCK_MINUTES` | `15` | Lockout duration |
| `ONLINE_BASE_COUNT` | `0` | Real online count base |
| `PARSE_RATE_LIMIT_PER_MINUTE` | `60` | Public parse limit per IP |
| `MEDIA_RATE_LIMIT_PER_MINUTE` | `120` | Media/download proxy limit per IP |
| `BATCH_RATE_LIMIT_PER_HOUR` | `30` | Batch task creation/inspection limit |
| `BATCH_MAX_ACTIVE_TASKS` | `2` | Base max active batch parse tasks |
| `BATCH_MAX_GLOBAL_CONCURRENCY` | `4` | Base global parse worker concurrency |
| `BATCH_QUEUE_PRESSURE_ONLINE` | `5` | Online users threshold where batch resources start to shrink |
| `BATCH_QUEUE_PRESSURE_STEP` | `5` | More online users per additional resource pressure level |
| `PUBLIC_AI_FEATURES_ENABLED` | `true` | Set to `false` to hide the public AI/ASR controls and return 404 from public AI endpoints while keeping the implementation available |
| `PUBLIC_COMMENTS_FEATURES_ENABLED` | `false` | Set to `true` only when the dormant public comment collection/view/export UI should be shown |
| `AI_RATE_LIMIT_PER_DAY` | `1000` | Global AI call ceiling per user |
| `COMMENTS_RATE_LIMIT_PER_DAY` | `200` | Global comment fetch/export ceiling per user |
| `COMMENT_STORE_DIR` | `.data/comments` | JSONL directory for persisted incremental comments |
| `COMMENTS_MAX_TOP_LEVEL_PER_JOB` | `50000` | Maximum top-level comments requested by one collection job |
| `COMMENTS_TASK_CACHE_LIMIT` | `200` | Small per-item in-task comment cache; complete data remains in JSONL |
| `COMMENTS_PAGE_DELAY_MS` | `250` | Delay between upstream comment pages |
| `POST_JOB_MAX_ACTIVE` | `2` | Max concurrent async batch AI/comment post-processing jobs |
| `ASR_MAX_CONCURRENCY` | `1` | Max active video-to-ASR jobs per Node process |
| `ASR_MAX_QUEUE` | `20` | Max waiting ASR requests before returning 503 |
| `ASR_MAX_VIDEO_BYTES` | `125829120` | Maximum downloaded source video size |
| `ASR_MAX_AUDIO_BYTES` | `25165824` | Maximum extracted MP3 size sent to Xiaomi |
| `ASR_MEDIA_TIMEOUT_MS` | `120000` | Source video download timeout |
| `FFMPEG_PATH` | `ffmpeg` | FFmpeg executable path |
| `FFMPEG_TIMEOUT_MS` | `120000` | Audio extraction timeout |
| `DOUYIN_PROFILE_BROWSER` | `1` | Enable the Node Chromium fallback for signed homepage-work requests; set `0` to disable |
| `DOUYIN_COMMENTS_BROWSER` | `1` | Enable the Node Chromium fallback when Douyin returns an empty direct comment response; set `0` to disable |
| `DOUYIN_CHROMIUM_PATH` | auto-detect | Optional absolute Chromium/Chrome executable path used by homepage works and real comment viewing/export |
| `DOUYIN_COOKIE` | empty | Optional Douyin browser cookie header for deeper reply pages; keep it server-side only |

## Deployment

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for Node/Docker/Nginx/HTTPS deployment.

## SDK Exports

```ts
import { getNoWatermarkUrl, parseDouyinHtml, parseDouyinUrl } from "douyin-watermark-free-parser";
```

- `parseDouyinUrl(url, options?)`
- `getNoWatermarkUrl(url, options?)`
- `parseDouyinHtml(html, sourceUrl?)`
