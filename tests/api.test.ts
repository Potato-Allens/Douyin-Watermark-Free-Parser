import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { createMemoryCreatorStore, createMemoryVipStore } from "../src/core/index.ts";
import { IMAGE_HTML, makeFixtureFetcher, VIDEO_HTML } from "./fixtures.ts";

const encodedUrl = encodeURIComponent("https://v.douyin.com/abc123/");

describe("api routes", () => {
  it("renders the Douyin-style UI on root without url", async () => {
    const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML) });
    const response = await app.request("/");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("抖音视频解析");
    expect(html).toContain('id="onlineCount"');
    expect(html).toContain('rel="manifest" href="/site.webmanifest"');
    expect(html).toContain('rel="apple-touch-icon" href="/apple-touch-icon.svg"');
    expect(html).toContain('id="profilePreviewList"');
    expect(html).toContain('id="queuePosition"');
    expect(html).toContain('id="queuePriority"');
    expect(html).toContain('id="centerDownloadBtn"');
    expect(html).toContain('id="commentsBtn"');
    expect(html).toContain('id="commentsList"');
    expect(html).toContain('id="collectBatchCommentsBtn"');
    expect(html).toContain('id="collectMini"');
    expect(html).toContain('downloadExport("covers_zip")');
    expect(html).toContain('downloadExport("items_csv")');
    expect(html).toContain('downloadExport("scripts_csv")');
    expect(html).toContain('downloadExport("comments_csv")');
    expect(html).toContain("/api/v1/batch/tasks?limit=12");
    expect(html).toContain('profilePreviewBtn:$("inspectBtn")');
    expect(html).not.toContain('profilePreviewBtn:$("profilePreviewBtn")');

    const icon = await app.request("/favicon.ico");
    expect(icon.status).toBe(200);
    expect(icon.headers.get("content-type")).toContain("image/svg+xml");

    const manifest = await app.request("/site.webmanifest");
    const manifestBody = await manifest.json();
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get("content-type")).toContain("application/manifest+json");
    expect(manifestBody.name).toBe("抖映灵感台");
    expect(manifestBody.icons.some((item: any) => item.src === "/app-icon.svg")).toBe(true);

    const appIcon = await app.request("/app-icon.svg");
    expect(appIcon.status).toBe(200);
    expect(appIcon.headers.get("content-type")).toContain("image/svg+xml");
  });

  it("keeps /api/hello compatibility message when url is missing", async () => {
    const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML) });
    const response = await app.request("/api/hello");

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("请提供url参数");
  });

  it("renders visual design choices page", async () => {
    const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML) });
    const response = await app.request("/designs");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("scheme recommended");
    expect(html).toContain('rel="manifest" href="/site.webmanifest"');
    expect(html).toContain("mock c");
    expect(html).toContain("choice");
  });

  it("renders clean admin console with management controls", async () => {
    const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML), creatorStore: createMemoryCreatorStore() });
    const response = await app.request("/admin");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("&#25238;&#26144;&#28789;&#24863;&#21488;&#21518;&#21488;");
    expect(html).toContain("/api/admin/rate-limits");
    expect(html).toContain("/api/admin/usage/summary");
    expect(html).toContain("/api/admin/security");
    expect(html).toContain("/api/admin/jobs");
    expect(html).toContain("/api/admin/users");
    expect(html).toContain('id="usageSummaryList"');
    expect(html).toContain('rel="manifest" href="/site.webmanifest"');
    expect(html).toContain('id="planBatchAi"');
    expect(html).toContain('id="planCommentExport"');
    expect(html).toContain('id="planCoverDownload"');
    expect(html).toContain('id="llmTimeout"');
    expect(html).toContain('id="llmMaxTokens"');
    expect(html).toContain('id="llmTemperature"');
    expect(html).not.toContain("???");
  });

  it("lets admin save advanced Xiaomi/OpenAI-compatible model settings", async () => {
    const oldToken = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = "llm-admin-token";
    try {
      const creatorStore = createMemoryCreatorStore();
      const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML), creatorStore });
      const adminHeaders = { authorization: "Bearer llm-admin-token", "content-type": "application/json" };

      const saved = await app.request("/api/admin/settings/llm", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
          base_url: "https://token-plan-cn.xiaomimimo.com/v1/",
          model: "xiaomi-test",
          api_key: "sk-test-123456",
          enabled: true,
          timeout_ms: 45_000,
          max_tokens: 1_200,
          temperature: 0.35,
        }),
      });
      const savedBody = await saved.json();

      expect(saved.status).toBe(200);
      expect(savedBody.data).toMatchObject({
        base_url: "https://token-plan-cn.xiaomimimo.com/v1",
        model: "xiaomi-test",
        enabled: true,
        timeout_ms: 45_000,
        max_tokens: 1_200,
        temperature: 0.35,
      });
      expect(savedBody.data.api_key_masked).toBeTruthy();
      expect(JSON.stringify(savedBody.data)).not.toContain("sk-test-123456");

      const loaded = await app.request("/api/admin/settings/llm", { headers: { authorization: "Bearer llm-admin-token" } });
      const loadedBody = await loaded.json();
      expect(loaded.status).toBe(200);
      expect(loadedBody.data.timeout_ms).toBe(45_000);
      expect(loadedBody.data.max_tokens).toBe(1_200);
      expect(loadedBody.data.temperature).toBe(0.35);

      const audit = await app.request("/api/admin/audit-logs?limit=5", { headers: { authorization: "Bearer llm-admin-token" } });
      const auditBody = await audit.json();
      expect(auditBody.data.some((entry: any) => entry.action === "llm_settings_save")).toBe(true);
      expect(auditBody.data.some((entry: any) => entry.detail.includes('"max_tokens":1200'))).toBe(true);
    } finally {
      if (oldToken === undefined) delete process.env.ADMIN_TOKEN;
      else process.env.ADMIN_TOKEN = oldToken;
    }
  });

  it("protects cookie-based admin mutations with a CSRF token", async () => {
    const oldToken = process.env.ADMIN_TOKEN;
    const oldUser = process.env.ADMIN_USERNAME;
    const oldPassword = process.env.ADMIN_PASSWORD;
    const oldTotp = process.env.ADMIN_TOTP_SECRET;
    delete process.env.ADMIN_TOKEN;
    process.env.ADMIN_USERNAME = "admin";
    process.env.ADMIN_PASSWORD = "csrf-admin-password";
    delete process.env.ADMIN_TOTP_SECRET;
    try {
      const creatorStore = createMemoryCreatorStore();
      const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML), creatorStore });

      const login = await app.request("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "csrf-admin-password" }),
      });
      const loginBody = await login.json();
      const csrf = loginBody.data.csrf_token;
      const cookie = `admin_token=${loginBody.data.token}; admin_csrf=${csrf}`;

      expect(login.status).toBe(200);
      expect(csrf).toBeTruthy();
      expect(login.headers.get("set-cookie")).toContain("admin_csrf=");

      const read = await app.request("/api/admin/rate-limits", { headers: { cookie } });
      expect(read.status).toBe(200);

      const blocked = await app.request("/api/admin/rate-limits", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ parse_per_minute: 5 }),
      });
      expect(blocked.status).toBe(403);
      expect((await blocked.json()).error.detail).toContain("csrf token");

      const allowed = await app.request("/api/admin/rate-limits", {
        method: "POST",
        headers: { cookie, "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ parse_per_minute: 5 }),
      });
      expect(allowed.status).toBe(200);
      expect((await allowed.json()).data.parse_per_minute).toBe(5);
    } finally {
      if (oldToken === undefined) delete process.env.ADMIN_TOKEN;
      else process.env.ADMIN_TOKEN = oldToken;
      if (oldUser === undefined) delete process.env.ADMIN_USERNAME;
      else process.env.ADMIN_USERNAME = oldUser;
      if (oldPassword === undefined) delete process.env.ADMIN_PASSWORD;
      else process.env.ADMIN_PASSWORD = oldPassword;
      if (oldTotp === undefined) delete process.env.ADMIN_TOTP_SECRET;
      else process.env.ADMIN_TOTP_SECRET = oldTotp;
    }
  });

  it("returns plain text no-watermark url on compatibility endpoint", async () => {
    const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML) });
    const response = await app.request(`/?url=${encodedUrl}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe(
      "https://aweme.snssdk.com/aweme/v1/play/?video_id=v0200fg10000abc123douyin&ratio=720p&line=0",
    );
  });

  it("returns bare compat json when data parameter is present", async () => {
    const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML) });
    const response = await app.request(`/?data&url=${encodedUrl}`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      aweme_id: "7673000000000000001",
      digg_count: 345,
      nickname: "作者A",
      type: "video",
    });
    expect(body.ok).toBeUndefined();
  });

  it("keeps /api/hello compatible with root", async () => {
    const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML) });
    const root = await app.request(`/?data&url=${encodedUrl}`);
    const hello = await app.request(`/api/hello?data&url=${encodedUrl}`);

    expect(await hello.text()).toBe(await root.text());
  });

  it("returns normalized v1 schema", async () => {
    const app = createApp({ fetcher: makeFixtureFetcher(IMAGE_HTML) });
    const response = await app.request(`/api/v1/parse?url=${encodedUrl}`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      code: "OK",
      message: "success",
      data: {
        source: { aweme_id: "7673000000000000002" },
        author: { nickname: "作者B", signature: "签名B" },
        stats: { comment_count: 1, digg_count: 2, share_count: 3, collect_count: 4 },
        content: { desc: "示例图文标题", create_timestamp: 1710000000 },
        media: { type: "image", video_url: null, cover_url: "https://p3-sign.douyinpic.com/tos-cn-i-0813/a.jpeg?x=1&y=2" },
        music: { title: "图文音乐", author: "图文作者", cover_url: null, play_url: null },
        download: { video_proxy_url: null, download_url: null, filename: null },
      },
    });
    expect(body.data.media.image_url_list).toHaveLength(2);
    expect(body.data.compat.type).toBe("img");
    expect(Object.keys(body.data).sort()).toEqual(["author", "compat", "content", "download", "media", "music", "source", "stats"]);
    expect(Object.keys(body.data.source).sort()).toEqual(["aweme_id", "input_url", "resolved_url"]);
    expect(Object.keys(body.data.author).sort()).toEqual(["nickname", "signature"]);
    expect(Object.keys(body.data.stats).sort()).toEqual(["collect_count", "comment_count", "digg_count", "share_count"]);
    expect(Object.keys(body.data.content).sort()).toEqual(["create_timestamp", "created_at", "desc"]);
    expect(Object.keys(body.data.media).sort()).toEqual(["cover_url", "image_url_list", "type", "video_url"]);
    expect(Object.keys(body.data.music).sort()).toEqual(["author", "cover_url", "play_url", "title"]);
    expect(Object.keys(body.data.download).sort()).toEqual(["download_url", "filename", "video_proxy_url"]);
    expect(Object.keys(body.data.compat).sort()).toEqual([
      "aweme_id",
      "collect_count",
      "comment_count",
      "cover_url",
      "create_time",
      "desc",
      "digg_count",
      "image_url_list",
      "music_author",
      "music_title",
      "nickname",
      "share_count",
      "signature",
      "type",
      "video_url",
    ]);
  });

  it("returns normalized v1 error response", async () => {
    const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML) });
    const response = await app.request("/api/v1/parse");
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      ok: false,
      code: "MISSING_URL",
      message: "url query parameter is required",
      error: { detail: "" },
    });
  });

  it("adds same-origin preview and download proxy urls for v1 video", async () => {
    const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML) });
    const response = await app.request(`/api/v1/parse?url=${encodedUrl}`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.media.cover_url).toBe("https://p3-sign.douyinpic.com/tos-cn-i-0813/cover.jpeg");
    expect(body.data.music).toMatchObject({ title: "示例背景音乐", author: "音乐作者" });
    expect(body.data.download.filename).toBe("douyin-7673000000000000001.mp4");
    expect(body.data.download.video_proxy_url).toContain("/api/v1/media?url=");
    expect(body.data.download.download_url).toContain("/api/v1/download?url=");
  });

  it("records public parse usage and rate limits repeated parse calls", async () => {
    const oldToken = process.env.ADMIN_TOKEN;
    const oldLimit = process.env.PARSE_RATE_LIMIT_PER_MINUTE;
    process.env.ADMIN_TOKEN = "usage-admin-token";
    process.env.PARSE_RATE_LIMIT_PER_MINUTE = "1";
    try {
      const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML), cacheTtlMs: 0 });
      const first = await app.request(`/api/v1/parse?url=${encodedUrl}`);
      const second = await app.request(`/api/v1/parse?url=${encodedUrl}`);
      const secondBody = await second.json();

      expect(first.status).toBe(200);
      expect(second.status).toBe(429);
      expect(secondBody.code).toBe("UNSUPPORTED_CONTENT");

      const usage = await app.request("/api/admin/usage?limit=10", { headers: { authorization: "Bearer usage-admin-token" } });
      const usageBody = await usage.json();
      expect(usage.status).toBe(200);
      expect(usageBody.data.some((entry: any) => entry.kind === "parse" && entry.status === 200)).toBe(true);
      expect(usageBody.data.some((entry: any) => entry.kind === "parse" && entry.status === 429)).toBe(true);
      expect(usageBody.data.some((entry: any) => entry.kind === "rate_limited_parse" && entry.status === 429)).toBe(true);

      const audit = await app.request("/api/admin/audit-logs?limit=10", { headers: { authorization: "Bearer usage-admin-token" } });
      const auditBody = await audit.json();
      expect(auditBody.data.some((entry: any) => entry.action === "rate_limit_block" && entry.detail.includes('"kind":"parse"'))).toBe(true);

      const summary = await app.request("/api/admin/usage/summary?limit=20", { headers: { authorization: "Bearer usage-admin-token" } });
      const summaryBody = await summary.json();
      expect(summary.status).toBe(200);
      expect(summaryBody.data.by_kind.some((entry: any) => entry.kind === "parse" && entry.total >= 2 && entry.success >= 1)).toBe(true);
      expect(summaryBody.data.by_kind.some((entry: any) => entry.kind === "rate_limited_parse" && entry.blocked >= 1)).toBe(true);
      expect(summaryBody.data.top_ips[0].total).toBeGreaterThan(0);
    } finally {
      if (oldToken === undefined) delete process.env.ADMIN_TOKEN;
      else process.env.ADMIN_TOKEN = oldToken;
      if (oldLimit === undefined) delete process.env.PARSE_RATE_LIMIT_PER_MINUTE;
      else process.env.PARSE_RATE_LIMIT_PER_MINUTE = oldLimit;
    }
  });

  it("uses forwarded https origin for generated proxy urls", async () => {
    const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML) });
    const response = await app.request(`/api/v1/parse?url=${encodedUrl}`, {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "dy.devforai.cn",
      },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.download.video_proxy_url).toMatch(/^https:\/\/dy\.devforai\.cn\/api\/v1\/media\?/);
    expect(body.data.download.download_url).toMatch(/^https:\/\/dy\.devforai\.cn\/api\/v1\/download\?/);
  });

  it("rejects unsupported media proxy hosts and watermark markers", async () => {
    const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML) });
    const unsupported = await app.request("/api/v1/media?url=https%3A%2F%2Fexample.com%2Fx.mp4");
    const watermarked = await app.request("/api/v1/media?url=https%3A%2F%2Fv1.douyinvod.com%2Fplaywm%2Fx.mp4");

    expect(unsupported.status).toBe(400);
    expect((await unsupported.json()).code).toBe("INVALID_URL");
    expect(watermarked.status).toBe(422);
    expect((await watermarked.json()).code).toBe("PARSE_FAILED");
  });

  it("tracks online pings", async () => {
    const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML), onlineBaseCount: 2 });
    const response = await app.request("/api/v1/online/ping", {
      method: "POST",
      body: JSON.stringify({ client_id: "client-a" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ client_id: "client-a", active_connections: 1, online_count: 3, base_count: 2 });
  });

  it("registers activation code into a member account and exposes plan permissions", async () => {
    const store = await createMemoryVipStore(["REG-TEST-1"]);
    const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML), vipStore: store });

    const register = await app.request("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ code: "REG-TEST-1", username: "creator_demo", password: "password123" }),
    });
    const body = await register.json();

    expect(register.status).toBe(200);
    expect(body.data.member.username).toBe("creator_demo");
    expect(body.data.member.plan.id).toBe("standard");
    expect(body.data.permissions.batch_parse_limit).toBe(50);

    const me = await app.request("/api/v1/me", { headers: { authorization: `Bearer ${body.data.token}` } });
    const meBody = await me.json();
    expect(meBody.data.session_type).toBe("member");
    expect(meBody.data.permissions.ai_daily_quota).toBe(200);
  });

  it("issues a member CSRF token and protects cookie-based member mutations", async () => {
    const store = await createMemoryVipStore(["CSRF-MEMBER-1"]);
    const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML), vipStore: store, creatorStore: createMemoryCreatorStore() });

    const register = await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "CSRF-MEMBER-1", username: "csrf_member", password: "password123" }),
    });
    const body = await register.json();
    const csrf = body.data.csrf_token;
    const cookie = `vip_token=${body.data.token}; vip_csrf=${csrf}`;

    expect(register.status).toBe(200);
    expect(csrf).toBeTruthy();
    expect(register.headers.get("set-cookie")).toContain("vip_csrf=");

    const read = await app.request("/api/v1/me", { headers: { cookie } });
    expect(read.status).toBe(200);

    const blocked = await app.request("/api/v1/ai/script", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ url: "https://v.douyin.com/abc123/", mode: "script" }),
    });
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error.detail).toContain("csrf token");

    const allowed = await app.request("/api/v1/ai/script", {
      method: "POST",
      headers: { cookie, "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ url: "https://v.douyin.com/abc123/", mode: "script" }),
    });
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).data.rewritten_script).toBeTruthy();
  });

  it("lets admin manage member plans and activation codes with admin token", async () => {
    const oldToken = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = "test-admin-token";
    try {
      const store = await createMemoryVipStore([]);
      const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML), vipStore: store });

      const plan = await app.request("/api/admin/plans", {
        method: "POST",
        headers: { authorization: "Bearer test-admin-token" },
        body: JSON.stringify({
          id: "team",
          name: "Team",
          batch_parse_limit: 300,
          batch_ai_limit: 25,
          ai_daily_quota: 1200,
          concurrency: 6,
          queue_priority: 90,
          comment_export: false,
          cover_batch_download: false,
        }),
      });
      const planBody = await plan.json();
      expect(plan.status).toBe(200);
      expect(planBody.data.batch_parse_limit).toBe(300);
      expect(planBody.data.batch_ai_limit).toBe(25);
      expect(planBody.data.comment_export).toBe(false);
      expect(planBody.data.cover_batch_download).toBe(false);

      const code = await app.request("/api/admin/codes", {
        method: "POST",
        headers: { authorization: "Bearer test-admin-token" },
        body: JSON.stringify({ code: "TEAM-001", plan_id: "team", max_uses: 2 }),
      });
      expect(code.status).toBe(200);
      expect((await code.json()).data.plan_id).toBe("team");

      const audit = await app.request("/api/admin/audit-logs?limit=5", { headers: { authorization: "Bearer test-admin-token" } });
      const auditBody = await audit.json();
      expect(audit.status).toBe(200);
      expect(auditBody.data.some((entry: any) => entry.action === "activation_code_create")).toBe(true);

      const usage = await app.request("/api/admin/usage?limit=5", { headers: { authorization: "Bearer test-admin-token" } });
      expect(usage.status).toBe(200);
      expect(Array.isArray((await usage.json()).data)).toBe(true);
    } finally {
      if (oldToken === undefined) delete process.env.ADMIN_TOKEN;
      else process.env.ADMIN_TOKEN = oldToken;
    }
  });

  it("lets admin list jobs and manage member users", async () => {
    const oldToken = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = "ops-admin-token";
    try {
      const store = await createMemoryVipStore(["OPS-1"]);
      const fetcher = async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/aweme/v1/web/aweme/post/")) {
          return new Response(JSON.stringify({ total: 1, aweme_list: [{ aweme_id: "7673000000000000001" }] }), {
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/user/")) {
          return new Response('<html>{"sec_uid":"SEC_OPS","aweme_id":"7673000000000000001"}</html>', {
            headers: { "content-type": "text/html" },
          });
        }
        return new Response(VIDEO_HTML, { headers: { "content-type": "text/html" } });
      };
      const app = createApp({ fetcher, vipStore: store, creatorStore: createMemoryCreatorStore(), cacheTtlMs: 0 });
      const register = await app.request("/api/v1/auth/register", {
        method: "POST",
        body: JSON.stringify({ code: "OPS-1", username: "ops_user", password: "password123" }),
      });
      const registerBody = await register.json();
      const token = registerBody.data.token;
      const memberId = registerBody.data.member.user_id;
      const headers = { authorization: `Bearer ${token}` };

      const started = await app.request("/api/v1/batch/start", {
        method: "POST",
        headers,
        body: JSON.stringify({ url: "https://www.douyin.com/user/SEC_OPS", count: 1, concurrency: 1 }),
      });
      const taskId = (await started.json()).data.id;
      for (let index = 0; index < 20; index += 1) {
        const task = await app.request(`/api/v1/batch/${taskId}`, { headers });
        const taskBody = await task.json();
        if (taskBody.data.status === "completed" || taskBody.data.status === "failed") break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      const adminHeaders = { authorization: "Bearer ops-admin-token", "content-type": "application/json" };
      const jobs = await app.request("/api/admin/jobs?limit=10", { headers: adminHeaders });
      const jobsBody = await jobs.json();
      expect(jobs.status).toBe(200);
      expect(jobsBody.data.some((job: any) => job.id === taskId && job.progress_percent >= 0)).toBe(true);

      const retry = await app.request(`/api/admin/jobs/${taskId}/retry`, { method: "POST", headers: adminHeaders });
      expect(retry.status).toBe(200);
      expect((await retry.json()).data.owner_key).toBe("OPS-1");

      const users = await app.request("/api/admin/users?limit=10", { headers: adminHeaders });
      const usersBody = await users.json();
      expect(users.status).toBe(200);
      expect(usersBody.data.some((user: any) => user.username === "ops_user" && user.plan_id === "standard")).toBe(true);

      const plan = await app.request(`/api/admin/users/${memberId}/plan`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ plan_id: "pro" }),
      });
      expect(plan.status).toBe(200);
      expect((await plan.json()).data.plan_id).toBe("pro");

      const disabled = await app.request(`/api/admin/users/${memberId}/disable`, { method: "POST", headers: adminHeaders });
      expect(disabled.status).toBe(200);
      expect((await disabled.json()).data.status).toBe("disabled");

      const meAfterDisable = await app.request("/api/v1/me", { headers });
      expect((await meAfterDisable.json()).data.session_type).toBe("guest");
    } finally {
      if (oldToken === undefined) delete process.env.ADMIN_TOKEN;
      else process.env.ADMIN_TOKEN = oldToken;
    }
  });

  it("lets admin configure rate limits and applies them to public parsing", async () => {
    const oldToken = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = "rate-admin-token";
    try {
      const creatorStore = createMemoryCreatorStore();
      const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML), cacheTtlMs: 0, creatorStore });
      const adminHeaders = { authorization: "Bearer rate-admin-token", "content-type": "application/json" };

      const saved = await app.request("/api/admin/rate-limits", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ parse_per_minute: 1, media_per_minute: 9, batch_per_hour: 8, ai_per_day: 7, comments_per_day: 6 }),
      });
      const savedBody = await saved.json();
      expect(saved.status).toBe(200);
      expect(savedBody.data).toMatchObject({ parse_per_minute: 1, media_per_minute: 9, batch_per_hour: 8, ai_per_day: 7, comments_per_day: 6 });

      const first = await app.request(`/api/v1/parse?url=${encodedUrl}`, { headers: { "x-forwarded-for": "192.0.2.44" } });
      const second = await app.request(`/api/v1/parse?url=${encodedUrl}`, { headers: { "x-forwarded-for": "192.0.2.44" } });
      expect(first.status).toBe(200);
      expect(second.status).toBe(429);

      const audit = await app.request("/api/admin/audit-logs?limit=5", { headers: { authorization: "Bearer rate-admin-token" } });
      const auditBody = await audit.json();
      expect(auditBody.data.some((entry: any) => entry.action === "rate_limits_save")).toBe(true);
      expect(auditBody.data.some((entry: any) => entry.action === "rate_limit_block")).toBe(true);
    } finally {
      if (oldToken === undefined) delete process.env.ADMIN_TOKEN;
      else process.env.ADMIN_TOKEN = oldToken;
    }
  });

  it("lets admin configure security policies and blocks abusive public requests", async () => {
    const oldToken = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = "security-admin-token";
    try {
      const creatorStore = createMemoryCreatorStore();
      const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML), cacheTtlMs: 0, creatorStore });
      const adminHeaders = { authorization: "Bearer security-admin-token", "content-type": "application/json" };

      const saved = await app.request("/api/admin/security", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
          blocked_ips: ["203.0.113.9"],
          allowed_origin_hosts: ["dy.devforai.cn"],
          require_browser_headers: true,
          block_empty_user_agent: false,
        }),
      });
      const savedBody = await saved.json();
      expect(saved.status).toBe(200);
      expect(savedBody.data.blocked_ips).toEqual(["203.0.113.9"]);
      expect(savedBody.data.allowed_origin_hosts).toEqual(["dy.devforai.cn"]);

      const blockedIp = await app.request(`/api/v1/parse?url=${encodedUrl}`, {
        headers: { "x-forwarded-for": "203.0.113.9", origin: "https://dy.devforai.cn" },
      });
      const missingOrigin = await app.request(`/api/v1/parse?url=${encodedUrl}`, {
        headers: { "x-forwarded-for": "203.0.113.10" },
      });
      const allowed = await app.request(`/api/v1/parse?url=${encodedUrl}`, {
        headers: { "x-forwarded-for": "203.0.113.10", origin: "https://dy.devforai.cn" },
      });

      expect(blockedIp.status).toBe(403);
      expect((await blockedIp.json()).error.detail).toContain("blocked_ip");
      expect(missingOrigin.status).toBe(403);
      expect((await missingOrigin.json()).error.detail).toContain("missing_origin_or_referer");
      expect(allowed.status).toBe(200);

      const audit = await app.request("/api/admin/audit-logs?limit=10", { headers: { authorization: "Bearer security-admin-token" } });
      const auditBody = await audit.json();
      expect(auditBody.data.some((entry: any) => entry.action === "security_settings_save")).toBe(true);
      expect(auditBody.data.some((entry: any) => entry.action === "security_blocked_request" && entry.detail.includes("blocked_ip"))).toBe(true);
    } finally {
      if (oldToken === undefined) delete process.env.ADMIN_TOKEN;
      else process.env.ADMIN_TOKEN = oldToken;
    }
  });

  it("locks admin login after repeated credential failures and writes audit logs", async () => {
    const oldToken = process.env.ADMIN_TOKEN;
    const oldUser = process.env.ADMIN_USERNAME;
    const oldPassword = process.env.ADMIN_PASSWORD;
    const oldTotp = process.env.ADMIN_TOTP_SECRET;
    const oldMaxFailures = process.env.ADMIN_LOGIN_MAX_FAILURES;
    const oldLockMinutes = process.env.ADMIN_LOGIN_LOCK_MINUTES;
    process.env.ADMIN_TOKEN = "admin-lock-audit-token";
    process.env.ADMIN_USERNAME = "admin";
    process.env.ADMIN_PASSWORD = "correct-password";
    delete process.env.ADMIN_TOTP_SECRET;
    process.env.ADMIN_LOGIN_MAX_FAILURES = "2";
    process.env.ADMIN_LOGIN_LOCK_MINUTES = "1";
    try {
      const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML) });
      const headers = { "x-forwarded-for": "203.0.113.77", "content-type": "application/json" };

      const first = await app.request("/api/admin/login", {
        method: "POST",
        headers,
        body: JSON.stringify({ username: "admin", password: "bad-1" }),
      });
      const second = await app.request("/api/admin/login", {
        method: "POST",
        headers,
        body: JSON.stringify({ username: "admin", password: "bad-2" }),
      });
      const locked = await app.request("/api/admin/login", {
        method: "POST",
        headers,
        body: JSON.stringify({ username: "admin", password: "correct-password" }),
      });
      const lockedBody = await locked.json();

      expect(first.status).toBe(403);
      expect(second.status).toBe(403);
      expect(locked.status).toBe(429);
      expect(lockedBody.error.detail).toContain("temporarily locked");

      const audit = await app.request("/api/admin/audit-logs?limit=10", { headers: { authorization: "Bearer admin-lock-audit-token" } });
      const auditBody = await audit.json();
      expect(audit.status).toBe(200);
      expect(auditBody.data.some((entry: any) => entry.action === "admin_login_locked" && entry.ip === "203.0.113.77")).toBe(true);
      expect(auditBody.data.some((entry: any) => entry.action === "admin_login_failed" && entry.detail.includes('"failure_count":2'))).toBe(true);
    } finally {
      if (oldToken === undefined) delete process.env.ADMIN_TOKEN;
      else process.env.ADMIN_TOKEN = oldToken;
      if (oldUser === undefined) delete process.env.ADMIN_USERNAME;
      else process.env.ADMIN_USERNAME = oldUser;
      if (oldPassword === undefined) delete process.env.ADMIN_PASSWORD;
      else process.env.ADMIN_PASSWORD = oldPassword;
      if (oldTotp === undefined) delete process.env.ADMIN_TOTP_SECRET;
      else process.env.ADMIN_TOTP_SECRET = oldTotp;
      if (oldMaxFailures === undefined) delete process.env.ADMIN_LOGIN_MAX_FAILURES;
      else process.env.ADMIN_LOGIN_MAX_FAILURES = oldMaxFailures;
      if (oldLockMinutes === undefined) delete process.env.ADMIN_LOGIN_LOCK_MINUTES;
      else process.env.ADMIN_LOGIN_LOCK_MINUTES = oldLockMinutes;
    }
  });

  it("fetches video comments and collects them into a batch task export", async () => {
    const store = await createMemoryVipStore(["COMMENT-1"]);
    const fetcher = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/aweme/v1/web/comment/list/")) {
        return new Response(
          JSON.stringify({
            status_code: 0,
            cursor: 20,
            has_more: 0,
            total: 1,
            comments: [{ cid: "comment-1", text: "这个视频很有用", digg_count: 8, create_time: 1700000000, user: { nickname: "观众A" } }],
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/aweme/v1/web/aweme/post/")) {
        return new Response(JSON.stringify({ total: 1, aweme_list: [{ aweme_id: "7673000000000000001" }] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/user/")) {
        return new Response(`<html>{"sec_uid":"SEC_COMMENT","aweme_id":"7673000000000000001"}</html>`, {
          headers: { "content-type": "text/html" },
        });
      }
      return new Response(VIDEO_HTML, { headers: { "content-type": "text/html" } });
    };
    const app = createApp({ fetcher, vipStore: store, cacheTtlMs: 0 });
    const register = await app.request("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ code: "COMMENT-1", username: "comment_user", password: "password123" }),
    });
    const token = (await register.json()).data.token;
    const headers = { authorization: `Bearer ${token}` };

    const comments = await app.request("/api/v1/comments?aweme_id=7673000000000000001&count=10", { headers });
    const commentsBody = await comments.json();
    expect(comments.status).toBe(200);
    expect(commentsBody.data.comments[0]).toMatchObject({ cid: "comment-1", nickname: "观众A", text: "这个视频很有用", digg_count: 8 });
    expect(commentsBody.data.next_cursor).toBeNull();

    const started = await app.request("/api/v1/batch/start", {
      method: "POST",
      headers,
      body: JSON.stringify({ url: "https://www.douyin.com/user/SEC_COMMENT", count: 1, concurrency: 1 }),
    });
    const taskId = (await started.json()).data.id;
    for (let index = 0; index < 20; index += 1) {
      const task = await app.request(`/api/v1/batch/${taskId}`, { headers });
      const taskBody = await task.json();
      if (taskBody.data.status === "completed" || taskBody.data.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const collected = await app.request(`/api/v1/batch/${taskId}/comments/collect`, {
      method: "POST",
      headers,
      body: JSON.stringify({ count_per_video: 10 }),
    });
    const collectedBody = await collected.json();
    expect(collected.status).toBe(200);
    expect(collectedBody.data.collected_count).toBe(1);

    const exported = await app.request(`/api/v1/batch/${taskId}/export?type=comments`, { headers });
    const exportedBody = await exported.json();
    expect(exportedBody.comments[0].comments[0].text).toBe("这个视频很有用");
  });

  it("paginates profile works so batch can start beyond the first page", async () => {
    const store = await createMemoryVipStore(["PAGE-1"]);
    const postCursors: string[] = [];
    const makeIds = (start: number, count: number) =>
      Array.from({ length: count }, (_, index) => ({ aweme_id: String(7673000000000000000n + BigInt(start + index)) }));
    const fetcher = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/aweme/v1/web/aweme/post/")) {
        const parsed = new URL(url);
        const cursor = parsed.searchParams.get("max_cursor") ?? "0";
        postCursors.push(cursor);
        const page =
          cursor === "0"
            ? { total: 25, max_cursor: 20, has_more: 1, aweme_list: makeIds(1, 20) }
            : { total: 25, max_cursor: 25, has_more: 0, aweme_list: makeIds(21, 5) };
        return new Response(JSON.stringify(page), { headers: { "content-type": "application/json" } });
      }
      if (url.includes("/user/")) {
        return new Response(`<html>{"sec_uid":"SEC_PAGE","aweme_id":"7673000000000000001"}</html>`, {
          headers: { "content-type": "text/html" },
        });
      }
      return new Response(VIDEO_HTML, { headers: { "content-type": "text/html" } });
    };
    const app = createApp({ fetcher, vipStore: store, cacheTtlMs: 0 });
    const register = await app.request("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ code: "PAGE-1", username: "page_user", password: "password123" }),
    });
    const headers = { authorization: `Bearer ${(await register.json()).data.token}` };

    const inspect = await app.request("/api/v1/batch/inspect", {
      method: "POST",
      headers,
      body: JSON.stringify({ url: "https://www.douyin.com/user/SEC_PAGE", count: 25 }),
    });
    const inspectBody = await inspect.json();
    expect(inspect.status).toBe(200);
    expect(inspectBody.data.available_count).toBe(25);
    expect(postCursors).toEqual(["0", "20"]);

    postCursors.length = 0;
    const started = await app.request("/api/v1/batch/start", {
      method: "POST",
      headers,
      body: JSON.stringify({ url: "https://www.douyin.com/user/SEC_PAGE", count: 25, concurrency: 1 }),
    });
    const startedBody = await started.json();
    expect(started.status).toBe(200);
    expect(startedBody.data.requested_count).toBe(25);
    expect(startedBody.data.items).toHaveLength(25);
    expect(postCursors).toEqual(["0", "20"]);
  });

  it("generates batch AI scripts and exports JSON/text artifacts", async () => {
    const store = await createMemoryVipStore(["BATCH-AI-1"]);
    const fetcher = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/aweme/v1/web/aweme/post/")) {
        return new Response(JSON.stringify({ total: 1, aweme_list: [{ aweme_id: "7673000000000000001" }] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/user/")) {
        return new Response(`<html>{"sec_uid":"SEC_TEST","aweme_id":"7673000000000000001"}</html>`, {
          headers: { "content-type": "text/html" },
        });
      }
      return new Response(VIDEO_HTML, { headers: { "content-type": "text/html" } });
    };
    const app = createApp({ fetcher, vipStore: store, cacheTtlMs: 0 });
    const register = await app.request("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ code: "BATCH-AI-1", username: "batch_ai_user", password: "password123" }),
    });
    const token = (await register.json()).data.token;
    const headers = { authorization: `Bearer ${token}` };

    const started = await app.request("/api/v1/batch/start", {
      method: "POST",
      headers,
      body: JSON.stringify({ url: "https://www.douyin.com/user/SEC_TEST", count: 1, concurrency: 1 }),
    });
    const taskId = (await started.json()).data.id;
    let taskBody: any = null;
    for (let index = 0; index < 20; index += 1) {
      const task = await app.request(`/api/v1/batch/${taskId}`, { headers });
      taskBody = await task.json();
      if (taskBody.data.status === "completed" || taskBody.data.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(taskBody.data.status).toBe("completed");
    expect(taskBody.data.success_count).toBe(1);

    const ai = await app.request(`/api/v1/batch/${taskId}/ai`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt: "更口语化", count: 1 }),
    });
    const aiBody = await ai.json();
    expect(ai.status).toBe(200);
    expect(aiBody.data.generated_count).toBe(1);
    expect(aiBody.data.items[0].ai_copy.tags.length).toBeGreaterThan(0);

    const exportedJson = await app.request(`/api/v1/batch/${taskId}/export?type=json`, { headers });
    const exportedBody = await exportedJson.json();
    expect(exportedJson.headers.get("content-disposition")).toContain("attachment");
    expect(exportedBody.items[0].ai_copy).toBeTruthy();

    const scripts = await app.request(`/api/v1/batch/${taskId}/export?type=scripts`, { headers });
    const scriptText = await scripts.text();
    expect(scripts.headers.get("content-type")).toContain("text/plain");
    expect(scriptText).toContain("aweme_id: 7673000000000000001");

    const itemsCsv = await app.request(`/api/v1/batch/${taskId}/export?type=items_csv`, { headers });
    const itemsCsvText = await itemsCsv.text();
    expect(itemsCsv.headers.get("content-type")).toContain("text/csv");
    expect(itemsCsvText).toContain("aweme_id,status,title");
    expect(itemsCsvText).toContain("7673000000000000001");

    const scriptsCsv = await app.request(`/api/v1/batch/${taskId}/export?type=scripts_csv`, { headers });
    const scriptsCsvText = await scriptsCsv.text();
    expect(scriptsCsv.headers.get("content-type")).toContain("text/csv");
    expect(scriptsCsvText).toContain("rewritten_script");
    expect(scriptsCsvText).toContain("7673000000000000001");

    const coverZip = await app.request(`/api/v1/batch/${taskId}/export?type=covers_zip`, { headers });
    const coverZipBytes = new Uint8Array(await coverZip.arrayBuffer());
    expect(coverZip.status).toBe(200);
    expect(coverZip.headers.get("content-type")).toContain("application/zip");
    expect(coverZipBytes[0]).toBe(0x50);
    expect(coverZipBytes[1]).toBe(0x4b);
    expect(new TextDecoder().decode(coverZipBytes)).toContain("cover-manifest.json");

    const imported = await app.request(`/api/v1/batch/${taskId}/comments/import`, {
      method: "POST",
      headers,
      body: JSON.stringify({ aweme_id: "7673000000000000001", comments: [{ cid: "c1", nickname: "viewer", text: "nice video", digg_count: 9 }] }),
    });
    expect(imported.status).toBe(200);
    expect((await imported.json()).data.imported_count).toBe(1);

    const comments = await app.request(`/api/v1/batch/${taskId}/comments?aweme_id=7673000000000000001`, { headers });
    const commentsBody = await comments.json();
    expect(comments.status).toBe(200);
    expect(commentsBody.data.items[0].comments[0].text).toBe("nice video");

    const commentsCsv = await app.request(`/api/v1/batch/${taskId}/export?type=comments_csv`, { headers });
    const commentsCsvText = await commentsCsv.text();
    expect(commentsCsv.headers.get("content-type")).toContain("text/csv");
    expect(commentsCsvText).toContain("comment_id,nickname,text");
    expect(commentsCsvText).toContain("nice video");
  });

  it("isolates member batch tasks and exposes own task history", async () => {
    const store = await createMemoryVipStore(["OWNER-A-1", "OWNER-B-1"]);
    const fetcher = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/aweme/v1/web/aweme/post/")) {
        return new Response(JSON.stringify({ total: 1, aweme_list: [{ aweme_id: "7673000000000000001" }] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/user/")) {
        return new Response(`<html>{"sec_uid":"SEC_OWNER","aweme_id":"7673000000000000001"}</html>`, {
          headers: { "content-type": "text/html" },
        });
      }
      return new Response(VIDEO_HTML, { headers: { "content-type": "text/html" } });
    };
    const app = createApp({ fetcher, vipStore: store, cacheTtlMs: 0 });
    const registerA = await app.request("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ code: "OWNER-A-1", username: "owner_a_user", password: "password123" }),
    });
    const registerB = await app.request("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ code: "OWNER-B-1", username: "owner_b_user", password: "password123" }),
    });
    const headersA = { authorization: `Bearer ${(await registerA.json()).data.token}` };
    const headersB = { authorization: `Bearer ${(await registerB.json()).data.token}` };

    const started = await app.request("/api/v1/batch/start", {
      method: "POST",
      headers: headersA,
      body: JSON.stringify({ url: "https://www.douyin.com/user/SEC_OWNER", count: 1, concurrency: 1 }),
    });
    const taskId = (await started.json()).data.id;

    const ownList = await app.request("/api/v1/batch/tasks", { headers: headersA });
    const ownListBody = await ownList.json();
    expect(ownList.status).toBe(200);
    expect(ownListBody.data.some((task: any) => task.id === taskId)).toBe(true);

    const otherList = await app.request("/api/v1/batch/tasks", { headers: headersB });
    const otherListBody = await otherList.json();
    expect(otherList.status).toBe(200);
    expect(otherListBody.data.some((task: any) => task.id === taskId)).toBe(false);

    const otherStatus = await app.request(`/api/v1/batch/${taskId}`, { headers: headersB });
    expect(otherStatus.status).toBe(403);

    const ownStatus = await app.request(`/api/v1/batch/${taskId}`, { headers: headersA });
    expect(ownStatus.status).toBe(200);
  });

  it("previews profile works and returns queue status for member plans", async () => {
    const store = await createMemoryVipStore(["PREVIEW-1"]);
    const fetcher = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/aweme/v1/web/aweme/post/")) {
        return new Response(JSON.stringify({ total: 2, aweme_list: [{ aweme_id: "7673000000000000001" }, { aweme_id: "7673000000000000002" }] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/user/")) {
        return new Response(`<html>{"sec_uid":"SEC_PREVIEW","aweme_id":"7673000000000000001"}</html>`, {
          headers: { "content-type": "text/html" },
        });
      }
      return new Response(VIDEO_HTML, { headers: { "content-type": "text/html" } });
    };
    const app = createApp({ fetcher, vipStore: store, cacheTtlMs: 0 });
    const register = await app.request("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ code: "PREVIEW-1", username: "preview_user", password: "password123" }),
    });
    const token = (await register.json()).data.token;
    const headers = { authorization: `Bearer ${token}` };

    const preview = await app.request("/api/v1/profile/preview", {
      method: "POST",
      headers,
      body: JSON.stringify({ url: "https://www.douyin.com/user/SEC_PREVIEW", count: 1 }),
    });
    const previewBody = await preview.json();
    expect(preview.status).toBe(200);
    expect(previewBody.data.preview_count).toBe(1);
    expect(previewBody.data.items[0].download_url).toContain("/api/v1/download");

    const queue = await app.request("/api/v1/batch/queue/status", { headers });
    const queueBody = await queue.json();
    expect(queue.status).toBe(200);
    expect(queueBody.data.max_active_tasks).toBeGreaterThan(0);
  });
});
