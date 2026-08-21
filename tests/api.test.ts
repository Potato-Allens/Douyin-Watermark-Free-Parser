import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { createApp } from "../src/app.ts";
import { createMemoryCreatorStore, createMemoryVipStore } from "../src/core/index.ts";
import { IMAGE_HTML, makeFixtureFetcher, VIDEO_HTML } from "./fixtures.ts";

const encodedUrl = encodeURIComponent("https://v.douyin.com/abc123/");

function currentTotpCode(secret: string, step = Math.floor(Date.now() / 30_000)): string {
  const key = testBase32Decode(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function testBase32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

describe("api routes", () => {
  it("renders the Douyin-style UI on root without url", async () => {
    const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML) });
    const response = await app.request("/");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    const publicScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(publicScript).toBeTruthy();
    expect(() => new Function(publicScript as string)).not.toThrow();
    expect(html).toContain("抖音视频解析");
    expect(html).toContain('id="onlineCount"');
    expect(html).toContain('rel="manifest" href="/site.webmanifest"');
    expect(html).toContain('rel="apple-touch-icon" href="/apple-touch-icon.svg"');
    expect(html).toContain('id="profilePreviewList"');
    expect(html).toContain('id="loadMoreProfileBtn"');
    expect(html).toContain('id="profileFetchProgress"');
    expect(html).toContain('id="profileProgressBar"');
    expect(html).toContain("/api/v1/profile/preview/stream");
    expect(html).toContain('id="queuePosition"');
    expect(html).toContain('id="queuePriority"');
    expect(html).toContain('id="centerDownloadBtn"');
    expect(html).toContain('id="commentsBtn"');
    expect(html).toContain('id="commentsBtn" class="btn hidden"');
    expect(html).toContain('id="commentWorkspace" class="comment-workspace hidden"');
    expect(html).toContain("const COMMENTS_FEATURE_ENABLED = false");
    expect(html).toContain('id="commentsList"');
    expect(html).toContain('id="exportCurrentCommentsJsonBtn"');
    expect(html).toContain('id="exportCurrentCommentsCsvBtn"');
    expect(html).toContain('id="collectCurrentCommentsBtn"');
    expect(html).toContain('id="commentProgressBar"');
    expect(html).toContain('id="commentCollectionList"');
    expect(html).toContain('id="commentSearchInput"');
    expect(html).toContain('id="selectAllCommentsBtn"');
    expect(html).toContain('id="exportSelectedCommentsCsvBtn"');
    expect(html).toContain("/api/v1/comments/collection/");
    expect(html).toContain('id="aiTranscriptBtn"');
    expect(html).toContain('id="aiTagsBtn"');
    expect(html).toContain("/api/v1/ai/transcript");
    expect(html).toContain("/api/v1/ai/rewrite");
    expect(html).toContain("/api/v1/ai/tags");
    expect(html).toContain("/api/v1/ai/batch");
    expect(html).toContain('id="collectBatchCommentsBtn"');
    expect(html).toContain('id="viewBatchCommentsBtn"');
    expect(html).toContain("/comments/fetch");
    expect(html).toContain('id="collectMini"');
    expect(html).toContain('downloadExport("covers_zip")');
    expect(html).toContain('downloadExport("items_csv")');
    expect(html).toContain('downloadExport("scripts_csv")');
    expect(html).toContain('downloadExport("comments_csv")');
    expect(html).toContain("/api/v1/batch/tasks?limit=12");
    expect(html).toContain('profilePreviewBtn:$("inspectBtn")');
    expect(html).toContain('class="side-stack"');
    expect(html).toContain("任务队列");
    expect(html).not.toContain("底部任务队列");
    expect(html).not.toContain("membership activation is required");
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

  it("hides and disables public AI copywriting when the feature switch is off", async () => {
    const app = createApp({
      fetcher: makeFixtureFetcher(VIDEO_HTML),
      creatorStore: createMemoryCreatorStore(),
      publicAiFeaturesEnabled: false,
    });

    const page = await app.request("/");
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain('class="ai-feature hidden"');
    expect(html).toContain('id="centerAiBtn" class="btn hidden"');
    expect(html).toContain('id="batchAiBtn" class="btn btn-primary hidden"');
    expect(html).toContain('id="exportScriptsBtn" class="btn hidden"');
    expect(html).toContain('id="commentsBtn" class="btn hidden"');
    expect(html).toContain('id="commentWorkspace" class="comment-workspace hidden"');
    expect(html).toContain('id="collectBatchCommentsBtn" class="btn hidden"');
    expect(html).toContain('id="viewBatchCommentsBtn" class="btn hidden"');
    expect(html).toContain('id="exportCommentsBtn" class="btn hidden"');
    expect(html).toContain('id="exportCommentsCsvBtn" class="btn hidden"');
    expect(html).toContain("COMMENTS_FEATURE_ENABLED?'<button class=\"btn tiny\" data-comment=");
    expect(html).toContain("filter(isVisiblePostJob)");
    expect(html).toContain("解析、预览和下载都围绕这条视频展开。");
    expect(html).toContain("const AI_FEATURE_ENABLED = false;");
    expect(html).toContain("const COMMENTS_FEATURE_ENABLED = false;");

    const transcript = await app.request("/api/v1/ai/transcript", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://v.douyin.com/abc123/" }),
    });
    const transcriptBody = await transcript.json();
    expect(transcript.status).toBe(404);
    expect(transcriptBody.ok).toBe(false);
    expect(transcriptBody.error.detail).toBe("AI 口播文案功能当前已关闭");

    const script = await app.request("/api/v1/ai/script", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://v.douyin.com/abc123/" }),
    });
    expect(script.status).toBe(404);
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

  it("serves only the dedicated login entry before admin authentication", async () => {
    const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML), creatorStore: createMemoryCreatorStore() });
    const response = await app.request("/admin");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(html).toContain('id="loginForm"');
    expect(html).toContain("/api/admin/login");
    expect(html).toContain("/api/admin/totp/bootstrap");
    expect(html).toContain('id="totpQr"');
    expect(html).not.toContain('class="tab-nav"');
    expect(html).not.toContain('id="mQueue"');
    expect(html).not.toContain("/api/admin/dashboard");
    expect(html).not.toContain("/api/admin/jobs");
    expect(html).not.toContain("/api/admin/security");
    expect(html).not.toContain("/api/admin/settings/llm");
    const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(inlineScript).toBeTruthy();
    expect(() => new Function(inlineScript!)).not.toThrow();
    expect(html).not.toContain("???");
  });

  it("clears stale admin cookies and rejects malformed or oversized login bodies", async () => {
    const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML), creatorStore: createMemoryCreatorStore() });
    const stale = await app.request("/admin", { headers: { cookie: "admin_token=stale; admin_csrf=stale-csrf" } });
    const staleHtml = await stale.text();
    expect(stale.status).toBe(200);
    expect(staleHtml).toContain('id="loginForm"');
    expect(stale.headers.get("set-cookie")).toContain("admin_token=;");
    expect(stale.headers.get("set-cookie")).toContain("Max-Age=0");

    const wrongType = await app.request("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ username: "admin", password: "x" }),
    });
    expect(wrongType.status).toBe(415);
    expect(wrongType.headers.get("cache-control")).toContain("no-store");

    const oversized = await app.request("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "x".repeat(9 * 1024) }),
    });
    expect(oversized.status).toBe(413);
  });

  it("serves the admin workspace only after a valid cookie login", async () => {
    const oldToken = process.env.ADMIN_TOKEN;
    const oldUser = process.env.ADMIN_USERNAME;
    const oldPassword = process.env.ADMIN_PASSWORD;
    const oldTotp = process.env.ADMIN_TOTP_SECRET;
    delete process.env.ADMIN_TOKEN;
    process.env.ADMIN_USERNAME = "admin";
    process.env.ADMIN_PASSWORD = "workspace-admin-password";
    delete process.env.ADMIN_TOTP_SECRET;
    try {
      const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML), creatorStore: createMemoryCreatorStore() });
      const login = await app.request("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "workspace-admin-password" }),
      });
      const loginBody = await login.json();
      const cookie = `admin_token=${loginBody.data.token}; admin_csrf=${loginBody.data.csrf_token}`;
      const response = await app.request("/admin", { headers: { cookie } });
      const html = await response.text();

      expect(login.status).toBe(200);
      expect(response.status).toBe(200);
      expect(html).toContain("&#25238;&#26144;&#28789;&#24863;&#21488;&#21518;&#21488;");
      expect(html).toContain("/api/admin/rate-limits");
      expect(html).toContain("/api/admin/totp/setup");
      expect(html).not.toContain("/api/admin/totp/bootstrap");
      expect(html).toContain("/api/admin/dashboard");
      expect(html).toContain("/api/admin/codes");
      expect(html).toContain("/api/admin/usage/summary");
      expect(html).toContain("/api/admin/security");
      expect(html).toContain("/api/admin/jobs");
      expect(html).toContain("/post-jobs/");
      expect(html).toContain("data-post-cancel");
      expect(html).toContain("/api/admin/users");
      expect(html).toContain('id="usageSummaryList"');
      expect(html).toContain('rel="manifest" href="/site.webmanifest"');
      expect(html).toContain('id="planBatchAi"');
      expect(html).toContain('id="planCommentExport"');
      expect(html).toContain('id="planCoverDownload"');
      expect(html).toContain('id="llmTimeout"');
      expect(html).toContain('id="llmMaxTokens"');
      expect(html).toContain('id="llmTemperature"');
      expect(html).toContain('id="llmAsrBase"');
      expect(html).toContain('id="llmAsrModel"');
      expect(html).toContain('id="testAsrBtn"');
      expect(html).toContain("/api/admin/settings/llm/test-asr");
      expect(html).toContain('id="mQueue"');
      expect(html).toContain('id="mCapacity"');
      expect(html).toContain('class="tab-nav"');
      expect(html).toContain('data-tab="overview"');
      expect(html).toContain('data-tab="auth"');
      expect(html).toContain('data-tab="members"');
      expect(html).not.toContain('data-tab="plans"');
      expect(html).toContain('data-member-view="users"');
      expect(html).toContain('data-member-view="codes"');
      expect(html).toContain('data-member-view="plans"');
      expect(html).toContain('id="memberPlan"');
      expect(html).toContain('id="codePlan"');
      expect(html).toContain('id="tab-security" class="tab-panel"');
      expect(html).toContain("function switchTab(name)");
      expect(html).toContain("/api/admin/logout");
      expect(html).not.toContain('id="loginForm"');
      expect(html).not.toContain("localStorage.getItem('admin_token')");
      expect(html).not.toContain('<div class="card">');
      const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
      expect(inlineScript).toBeTruthy();
      expect(() => new Function(inlineScript!)).not.toThrow();
      expect(html).not.toContain("???");
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

  it("supports documented admin activation-code aliases", async () => {
    const oldToken = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = "codes-alias-admin-token";
    try {
      const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML), vipStore: await createMemoryVipStore([]), creatorStore: createMemoryCreatorStore() });
      const headers = { authorization: "Bearer codes-alias-admin-token", "content-type": "application/json" };

      const created = await app.request("/api/admin/activation-codes", {
        method: "POST",
        headers,
        body: JSON.stringify({ code: "ALIAS-CODE-1", plan_id: "standard", max_uses: 1 }),
      });
      const listed = await app.request("/api/admin/activation-codes?limit=5", { headers: { authorization: "Bearer codes-alias-admin-token" } });
      const listedBody = await listed.json();

      expect(created.status).toBe(200);
      expect(listed.status).toBe(200);
      expect(listedBody.data.some((entry: any) => entry.code === "ALIAS-CODE-1")).toBe(true);
    } finally {
      if (oldToken === undefined) delete process.env.ADMIN_TOKEN;
      else process.env.ADMIN_TOKEN = oldToken;
    }
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
          asr_base_url: "https://api.xiaomimimo.com/v1/",
          asr_model: "mimo-v2.5-asr",
          asr_language: "zh",
          asr_timeout_ms: 180_000,
          asr_enabled: true,
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
        asr_base_url: "https://api.xiaomimimo.com/v1",
        asr_model: "mimo-v2.5-asr",
        asr_language: "zh",
        asr_timeout_ms: 180_000,
        asr_enabled: true,
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

      const logoutWithoutCsrf = await app.request("/api/admin/logout", {
        method: "POST",
        headers: { cookie },
      });
      expect(logoutWithoutCsrf.status).toBe(403);

      const logout = await app.request("/api/admin/logout", {
        method: "POST",
        headers: { cookie, "x-csrf-token": csrf },
      });
      expect(logout.status).toBe(200);
      expect(logout.headers.get("set-cookie")).toContain("admin_token=; ");
      expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");

      const afterLogout = await app.request("/admin", { headers: { cookie } });
      const afterLogoutHtml = await afterLogout.text();
      expect(afterLogout.status).toBe(200);
      expect(afterLogoutHtml).toContain('id="loginForm"');
      expect(afterLogoutHtml).not.toContain('class="tab-nav"');

      const revokedApi = await app.request("/api/admin/rate-limits", { headers: { cookie } });
      expect(revokedApi.status).toBe(403);
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

  it("lets admin set up Google Authenticator TOTP and requires it on login", async () => {
    const oldToken = process.env.ADMIN_TOKEN;
    const oldUser = process.env.ADMIN_USERNAME;
    const oldPassword = process.env.ADMIN_PASSWORD;
    const oldTotp = process.env.ADMIN_TOTP_SECRET;
    process.env.ADMIN_TOKEN = "totp-admin-token";
    process.env.ADMIN_USERNAME = "admin";
    process.env.ADMIN_PASSWORD = "totp-password";
    delete process.env.ADMIN_TOTP_SECRET;
    try {
      const creatorStore = createMemoryCreatorStore();
      const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML), creatorStore });
      const adminHeaders = { authorization: "Bearer totp-admin-token", "content-type": "application/json" };

      const initial = await app.request("/api/admin/totp", { headers: adminHeaders });
      const initialBody = await initial.json();
      expect(initial.status).toBe(200);
      expect(initialBody.data).toMatchObject({ enabled: false, source: "store", configurable: true });

      const setup = await app.request("/api/admin/totp/setup", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ issuer: "抖映灵感台", account: "admin" }),
      });
      const setupBody = await setup.json();
      expect(setup.status).toBe(200);
      expect(setupBody.data.secret.length).toBeGreaterThanOrEqual(16);
      expect(setupBody.data.otpauth_uri).toContain("otpauth://totp/");
      expect(setupBody.data.qr_svg).toContain("<svg");
      const validTotp = currentTotpCode(setupBody.data.secret);
      const wrongTotp = validTotp === "000000" ? "000001" : "000000";

      const wrong = await app.request("/api/admin/totp/verify", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ secret: setupBody.data.secret, code: wrongTotp }),
      });
      expect(wrong.status).toBe(403);

      const enabled = await app.request("/api/admin/totp/verify", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ secret: setupBody.data.secret, code: validTotp, issuer: "抖映灵感台", account: "admin" }),
      });
      const enabledBody = await enabled.json();
      expect(enabled.status).toBe(200);
      expect(enabledBody.data.enabled).toBe(true);
      expect(enabledBody.data.secret_masked).toContain("****");
      expect(enabledBody.data.qr_svg).toBeNull();

      const loadedAfterEnable = await app.request("/api/admin/totp", { headers: adminHeaders });
      const loadedAfterEnableBody = await loadedAfterEnable.json();
      expect(loadedAfterEnableBody.data.otpauth_uri).toBeNull();
      expect(loadedAfterEnableBody.data.qr_svg).toBeNull();

      const setupStatus = await app.request("/api/admin/totp/bootstrap/status");
      expect((await setupStatus.json()).data.setup_available).toBe(false);

      const exposedWithoutSecondFactor = await app.request("/api/admin/totp/bootstrap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "totp-password" }),
      });
      const exposedWithoutSecondFactorText = await exposedWithoutSecondFactor.text();
      expect(exposedWithoutSecondFactor.status).toBe(409);
      expect(exposedWithoutSecondFactorText).not.toContain(setupBody.data.secret);
      expect(exposedWithoutSecondFactorText).not.toContain("otpauth://totp/");

      const existingQrWithSecondFactor = await app.request("/api/admin/totp/bootstrap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "totp-password", totp: currentTotpCode(setupBody.data.secret) }),
      });
      expect(existingQrWithSecondFactor.status).toBe(409);

      const secondSetup = await app.request("/api/admin/totp/setup", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ issuer: "抖映灵感台", account: "admin" }),
      });
      expect(secondSetup.status).toBe(409);

      const loginWithoutTotp = await app.request("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "totp-password" }),
      });
      expect(loginWithoutTotp.status).toBe(403);

      const loginWithTotp = await app.request("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "totp-password", totp: currentTotpCode(setupBody.data.secret) }),
      });
      const loginWithTotpBody = await loginWithTotp.json();
      expect(loginWithTotp.status).toBe(200);
      expect(loginWithTotpBody.data).toMatchObject({ totp_enabled: true, totp_source: "store" });

      const disabled = await app.request("/api/admin/totp/verify", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ enabled: false }),
      });
      expect(disabled.status).toBe(409);

      const audit = await app.request("/api/admin/audit-logs?limit=10", { headers: adminHeaders });
      const auditBody = await audit.json();
      expect(auditBody.data.some((entry: any) => entry.action === "admin_totp_enable")).toBe(true);
      expect(auditBody.data.some((entry: any) => entry.action === "admin_totp_disable")).toBe(false);
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

  it("bootstraps an admin TOTP QR before login with admin password", async () => {
    const oldToken = process.env.ADMIN_TOKEN;
    const oldUser = process.env.ADMIN_USERNAME;
    const oldPassword = process.env.ADMIN_PASSWORD;
    const oldTotp = process.env.ADMIN_TOTP_SECRET;
    delete process.env.ADMIN_TOKEN;
    process.env.ADMIN_USERNAME = "admin";
    process.env.ADMIN_PASSWORD = "bootstrap-password";
    delete process.env.ADMIN_TOTP_SECRET;
    try {
      const creatorStore = createMemoryCreatorStore();
      const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML), creatorStore });

      const setup = await app.request("/api/admin/totp/bootstrap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "bootstrap-password", issuer: "抖映灵感台", account: "admin" }),
      });
      const setupBody = await setup.json();
      expect(setup.status).toBe(200);
      expect(setupBody.data.enabled).toBe(false);
      expect(setupBody.data.secret.length).toBeGreaterThanOrEqual(16);
      expect(setupBody.data.otpauth_uri).toContain("otpauth://totp/");
      expect(setupBody.data.qr_svg).toContain("<svg");

      const verify = await app.request("/api/admin/totp/bootstrap/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "bootstrap-password", secret: setupBody.data.secret, code: currentTotpCode(setupBody.data.secret), issuer: "抖映灵感台", account: "admin" }),
      });
      const verifyBody = await verify.json();
      expect(verify.status).toBe(200);
      expect(verifyBody.data.totp_enabled).toBe(true);
      expect(verifyBody.data.token).toBeTruthy();
      expect(verify.headers.get("set-cookie")).toContain("admin_csrf=");

      const dashboard = await app.request("/api/admin/dashboard", { headers: { authorization: `Bearer ${verifyBody.data.token}` } });
      expect(dashboard.status).toBe(200);
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

      const dashboard = await app.request("/api/admin/dashboard?limit=20", { headers: { authorization: "Bearer usage-admin-token" } });
      const dashboardBody = await dashboard.json();
      expect(dashboard.status).toBe(200);
      expect(dashboardBody.data.metrics.usage_total).toBeGreaterThanOrEqual(2);
      expect(dashboardBody.data.online.online_count).toBeGreaterThanOrEqual(0);
      expect(dashboardBody.data.queue.adaptive.max_active_tasks).toBeGreaterThanOrEqual(1);
      expect(dashboardBody.data.usage_summary.by_kind.some((entry: any) => entry.kind === "parse")).toBe(true);
      expect(dashboardBody.data.rate_limits.parse_per_minute).toBe(1);
      expect(dashboardBody.data.security.blocked_ip_count).toBe(0);
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

    const rewrite = await app.request("/api/v1/ai/rewrite", {
      method: "POST",
      headers: { cookie, "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ url: "https://v.douyin.com/abc123/", prompt: "更口语化" }),
    });
    const rewriteBody = await rewrite.json();
    expect(rewrite.status).toBe(200);
    expect(rewriteBody.data.mode).toBe("custom_rewrite");
    expect(rewriteBody.data.title).toBeTruthy();

    const tags = await app.request("/api/v1/ai/tags", {
      method: "POST",
      headers: { cookie, "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ url: "https://v.douyin.com/abc123/" }),
    });
    const tagsBody = await tags.json();
    expect(tags.status).toBe(200);
    expect(tagsBody.data.tags.length).toBeGreaterThan(0);
    expect(tagsBody.data.rewritten_script).toBeUndefined();

    const transcript = await app.request("/api/v1/ai/transcript", {
      method: "POST",
      headers: { cookie, "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ url: "https://v.douyin.com/abc123/" }),
    });
    const transcriptBody = await transcript.json();
    expect(transcript.status).toBe(200);
    expect(transcriptBody.data.provider).toBe("metadata_draft");
    expect(transcriptBody.data.transcript).toBeTruthy();
    expect(transcriptBody.data.next.rewrite_endpoint).toBe("/api/v1/ai/script");
  });

  it("uses configured Xiaomi ASR for a real transcript and forwards it to rewriting", async () => {
    const creatorStore = createMemoryCreatorStore();
    await creatorStore.saveLlmSettings({ api_key: "sk-real-asr", asr_enabled: true, asr_model: "mimo-v2.5-asr", asr_language: "zh" });
    let transcriberCalls = 0;
    const app = createApp({
      fetcher: makeFixtureFetcher(VIDEO_HTML),
      creatorStore,
      transcriber: async ({ apiKey, settings, parsed }) => {
        transcriberCalls += 1;
        expect(apiKey).toBe("sk-real-asr");
        expect(settings.asr_model).toBe("mimo-v2.5-asr");
        expect(parsed.source.aweme_id).toBe("7673000000000000001");
        return {
          provider: "xiaomi_asr",
          transcript: "这是从视频声音识别出来的真实口播",
          model: "mimo-v2.5-asr",
          language: "zh",
          duration_seconds: 12,
          media_bytes: 1000,
          audio_bytes: 500,
          queue_wait_ms: 3,
          usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18, audio_tokens: 9 },
        };
      },
    });

    const transcript = await app.request("/api/v1/ai/transcript", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://v.douyin.com/abc123/" }),
    });
    const transcriptBody = await transcript.json();
    expect(transcript.status).toBe(200);
    expect(transcriptBody.data.provider).toBe("xiaomi_asr");
    expect(transcriptBody.data.degraded).toBe(false);
    expect(transcriptBody.data.transcript).toBe("这是从视频声音识别出来的真实口播");
    expect(transcriptBody.data.duration_seconds).toBe(12);
    expect(transcriberCalls).toBe(1);

    const rewritten = await app.request("/api/v1/ai/rewrite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://v.douyin.com/abc123/", transcript: transcriptBody.data.transcript, prompt: "更口语化" }),
    });
    const rewrittenBody = await rewritten.json();
    expect(rewritten.status).toBe(200);
    expect(rewrittenBody.data.transcript).toBe("这是从视频声音识别出来的真实口播");
  });

  it("allows single-video AI copywriting locally without member activation", async () => {
    const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML), creatorStore: createMemoryCreatorStore() });

    const transcript = await app.request("/api/v1/ai/transcript", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://v.douyin.com/abc123/" }),
    });
    const transcriptBody = await transcript.json();
    expect(transcript.status).toBe(200);
    expect(transcriptBody.data.provider).toBe("metadata_draft");
    expect(transcriptBody.data.transcript).toBeTruthy();

    const script = await app.request("/api/v1/ai/script", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://v.douyin.com/abc123/", prompt: "更口语化", mode: "script" }),
    });
    const scriptBody = await script.json();
    expect(script.status).toBe(200);
    expect(scriptBody.data.provider).toBe("local_template");
    expect(scriptBody.data.rewritten_script).toContain("更口语化");

    const tags = await app.request("/api/v1/ai/tags", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://v.douyin.com/abc123/" }),
    });
    const tagsBody = await tags.json();
    expect(tags.status).toBe(200);
    expect(tagsBody.data.provider).toBe("local_template");
    expect(tagsBody.data.tags.length).toBeGreaterThan(0);
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
    const oldPostJobMax = process.env.POST_JOB_MAX_ACTIVE;
    process.env.ADMIN_TOKEN = "ops-admin-token";
    process.env.POST_JOB_MAX_ACTIVE = "1";
    try {
      const store = await createMemoryVipStore(["OPS-1"]);
      const fetcher = async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/aweme/v1/web/aweme/post/")) {
          return new Response(JSON.stringify({ total: 1, aweme_list: [{ aweme_id: "7673000000000000001" }] }), {
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/aweme/v1/web/comment/list/")) {
          await new Promise((resolve) => setTimeout(resolve, 120));
          return new Response(
            JSON.stringify({
              status_code: 0,
              total: 1,
              comments: [{ cid: "ops-comment-1", text: "queued comment", digg_count: 3, create_time: 1800000000, user: { nickname: "viewer" } }],
            }),
            { headers: { "content-type": "application/json" } },
          );
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

      const asyncComments = await app.request(`/api/v1/batch/${taskId}/comments/fetch`, {
        method: "POST",
        headers,
        body: JSON.stringify({ count_per_video: 1, video_count: 1, async: true }),
      });
      expect(asyncComments.status).toBe(202);

      const asyncAi = await app.request(`/api/v1/batch/${taskId}/ai`, {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt: "admin queue", count: 1, async: true }),
      });
      const asyncAiBody = await asyncAi.json();
      expect(asyncAi.status).toBe(202);
      const aiJobId = asyncAiBody.data.job.id;

      const jobsWithPost = await app.request("/api/admin/jobs?limit=10", { headers: adminHeaders });
      const jobsWithPostBody = await jobsWithPost.json();
      expect(jobsWithPostBody.data.find((job: any) => job.id === taskId).post_jobs.some((job: any) => job.id === aiJobId)).toBe(true);

      const cancelledPostJob = await app.request(`/api/admin/jobs/${taskId}/post-jobs/${aiJobId}/cancel`, { method: "POST", headers: adminHeaders });
      const cancelledPostJobBody = await cancelledPostJob.json();
      expect(cancelledPostJob.status).toBe(200);
      expect(cancelledPostJobBody.data.post_jobs.find((job: any) => job.id === aiJobId).status).toBe("cancelled");

      const auditAfterPostCancel = await app.request("/api/admin/audit-logs?limit=10", { headers: adminHeaders });
      const auditAfterPostCancelBody = await auditAfterPostCancel.json();
      expect(auditAfterPostCancelBody.data.some((entry: any) => entry.action === "batch_post_job_cancel")).toBe(true);

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
      if (oldPostJobMax === undefined) delete process.env.POST_JOB_MAX_ACTIVE;
      else process.env.POST_JOB_MAX_ACTIVE = oldPostJobMax;
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

  it("fetches, views, and exports video comments without posting comments", async () => {
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
      if (url.includes("/aweme/v1/web/comment/list/")) {
        return new Response(
          JSON.stringify({
            status_code: 0,
            total: 1,
            has_more: 0,
            comments: [{ cid: "c-async", text: "async queued comment", user: { nickname: "queued_viewer" }, digg_count: 3, create_time: 1710000100 }],
          }),
          { headers: { "content-type": "application/json" } },
        );
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

    const guestComments = await app.request("/api/v1/comments?aweme_id=7673000000000000001&count=10");
    const guestCommentsBody = await guestComments.json();
    expect(guestComments.status).toBe(200);
    expect(guestCommentsBody.data.comments[0].text).toBe("这个视频很有用");

    const guestExport = await app.request("/api/v1/comments/export?aweme_id=7673000000000000001&type=json&count=10");
    const guestExportBody = await guestExport.json();
    expect(guestExport.status).toBe(200);
    expect(guestExportBody.comments[0].text).toBe("这个视频很有用");

    const comments = await app.request("/api/v1/comments?aweme_id=7673000000000000001&count=10", { headers });
    const commentsBody = await comments.json();
    expect(comments.status).toBe(200);
    expect(commentsBody.data.comments[0]).toMatchObject({ cid: "comment-1", nickname: "观众A", text: "这个视频很有用", digg_count: 8 });
    expect(commentsBody.data.next_cursor).toBeNull();

    const exportedSingleJson = await app.request("/api/v1/comments/export?aweme_id=7673000000000000001&type=json&count=10", { headers });
    const exportedSingleJsonBody = await exportedSingleJson.json();
    expect(exportedSingleJson.status).toBe(200);
    expect(exportedSingleJson.headers.get("content-disposition")).toContain("comments-7673000000000000001");
    expect(exportedSingleJsonBody.comments[0].text).toBe("这个视频很有用");

    const exportedSingleCsv = await app.request("/api/v1/comments/export?aweme_id=7673000000000000001&type=csv&count=10", { headers });
    const exportedSingleCsvText = await exportedSingleCsv.text();
    expect(exportedSingleCsv.status).toBe(200);
    expect(exportedSingleCsv.headers.get("content-type")).toContain("text/csv");
    expect(exportedSingleCsvText).toContain("comment_id,nickname,text");
    expect(exportedSingleCsvText).toContain("这个视频很有用");

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

    const collected = await app.request(`/api/v1/batch/${taskId}/comments/fetch`, {
      method: "POST",
      headers,
      body: JSON.stringify({ count_per_video: 10 }),
    });
    const collectedBody = await collected.json();
    expect(collected.status).toBe(200);
    expect(collectedBody.data.collected_count).toBe(1);
    expect(collectedBody.data.fetched_count).toBe(1);

    const viewed = await app.request(`/api/v1/batch/${taskId}/comments`, { headers });
    const viewedBody = await viewed.json();
    expect(viewed.status).toBe(200);
    expect(viewedBody.data.items[0].comments[0].text).toBe("这个视频很有用");

    const exported = await app.request(`/api/v1/batch/${taskId}/export?type=comments`, { headers });
    const exportedBody = await exported.json();
    expect(exportedBody.comments[0].comments[0].text).toBe("这个视频很有用");

    const exportedDirect = await app.request(`/api/v1/batch/${taskId}/comments/export?type=json`, { headers });
    const exportedDirectBody = await exportedDirect.json();
    expect(exportedDirect.status).toBe(200);
    expect(exportedDirect.headers.get("content-disposition")).toContain(`comments-${taskId}`);
    expect(exportedDirectBody.items[0].comments[0].text).toBe("这个视频很有用");

    const exportedTaskCommentsCsv = await app.request(`/api/v1/comments/export?task_id=${taskId}&type=csv`, { headers });
    const exportedTaskCommentsCsvText = await exportedTaskCommentsCsv.text();
    expect(exportedTaskCommentsCsv.status).toBe(200);
    expect(exportedTaskCommentsCsvText).toContain("7673000000000000001");
    expect(exportedTaskCommentsCsvText).toContain("这个视频很有用");
  });

  it("collects comments incrementally, persists replies, searches, selects, and exports", async () => {
    const store = await createMemoryVipStore(["COMMENT-FULL-1"]);
    const fetcher = async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/aweme/v1/web/comment/list/reply/")) {
        return new Response(
          JSON.stringify({
            status_code: 0,
            cursor: 2,
            has_more: 0,
            total: 2,
            comments: [
              { cid: "reply-full-1", text: "二级回复：支持搜索", user: { nickname: "回复甲" }, reply_to_username: "主评论用户" },
              { cid: "reply-full-2", text: "二级回复：支持导出", user: { nickname: "回复乙" } },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (url.pathname.includes("/aweme/v1/web/comment/list/")) {
        return new Response(
          JSON.stringify({
            status_code: 0,
            cursor: 2,
            has_more: 0,
            total: 2,
            comments: [
              { cid: "comment-full-1", text: "主评论关键词", reply_comment_total: 2, user: { nickname: "主评论用户" } },
              { cid: "comment-full-2", text: "另一条主评论", reply_comment_total: 0, user: { nickname: "用户乙" } },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      return makeFixtureFetcher(VIDEO_HTML)();
    };
    const app = createApp({ fetcher, vipStore: store, cacheTtlMs: 0 });
    const register = await app.request("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ code: "COMMENT-FULL-1", username: "comment_full_user", password: "password123" }),
    });
    const registerBody = await register.json();
    const headers = { authorization: `Bearer ${registerBody.data.token}`, "x-csrf-token": registerBody.data.csrf_token };

    const collected = await app.request("/api/v1/comments/collect", {
      method: "POST",
      headers,
      body: JSON.stringify({ url: "https://v.douyin.com/abc123/", target_count: 2, include_replies: true, async: false, delay_ms: 0 }),
    });
    const collectedBody = await collected.json();
    expect(collected.status).toBe(200);
    expect(collectedBody.data.items[0]).toMatchObject({ top_level_count: 2, reply_count: 2, total_comments: 4 });
    const taskId = collectedBody.data.task_id;

    const searched = await app.request(`/api/v1/comments/collection/${taskId}?q=${encodeURIComponent("二级回复")}&limit=10`, { headers });
    const searchedBody = await searched.json();
    expect(searched.status).toBe(200);
    expect(searchedBody.data.filtered_count).toBe(2);
    expect(searchedBody.data.comments.every((comment: any) => comment.level === 2 && comment.parent_cid === "comment-full-1")).toBe(true);
    expect(searchedBody.data.collections[0].state.collected_count).toBe(4);

    const selected = await app.request(`/api/v1/comments/collection/${taskId}/export`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ type: "json", cids: ["reply-full-1"] }),
    });
    const selectedBody = await selected.json();
    expect(selected.status).toBe(200);
    expect(selectedBody.selected_count).toBe(1);
    expect(selectedBody.items[0].comments[0].text).toContain("支持搜索");

    const filteredCsv = await app.request(`/api/v1/comments/collection/${taskId}/export`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ type: "csv", select_all: true, keyword: "二级回复" }),
    });
    const csv = await filteredCsv.text();
    expect(filteredCsv.status).toBe(200);
    expect(csv).toContain("parent_comment_id,level,reply_to_nickname,reply_count");
    expect(csv).toContain("reply-full-1");
    expect(csv).toContain("reply-full-2");
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
    const profileInspect = await app.request("/api/v1/profile/inspect", {
      method: "POST",
      headers,
      body: JSON.stringify({ url: "https://www.douyin.com/user/SEC_PAGE", count: 25 }),
    });
    const profileInspectBody = await profileInspect.json();
    expect(profileInspect.status).toBe(200);
    expect(profileInspectBody.data.available_count).toBe(25);
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

  it("supports documented job aliases for batch creation, items and JSON export", async () => {
    const store = await createMemoryVipStore(["JOB-ALIAS-1"]);
    const fetcher = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/aweme/v1/web/aweme/post/")) {
        return new Response(JSON.stringify({ total: 1, aweme_list: [{ aweme_id: "7673000000000000001" }] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/user/")) {
        return new Response(`<html>{"sec_uid":"SEC_ALIAS","aweme_id":"7673000000000000001"}</html>`, {
          headers: { "content-type": "text/html" },
        });
      }
      return new Response(VIDEO_HTML, { headers: { "content-type": "text/html" } });
    };
    const app = createApp({ fetcher, vipStore: store, cacheTtlMs: 0 });
    const register = await app.request("/api/v1/auth/activate-register", {
      method: "POST",
      body: JSON.stringify({ code: "JOB-ALIAS-1", username: "job_alias_user", password: "password123" }),
    });
    const token = (await register.json()).data.token;
    const headers = { authorization: `Bearer ${token}` };

    const started = await app.request("/api/v1/jobs/start", {
      method: "POST",
      headers,
      body: JSON.stringify({ url: "https://www.douyin.com/user/SEC_ALIAS", count: 1, concurrency: 1 }),
    });
    const taskId = (await started.json()).data.id;
    expect(started.status).toBe(200);

    const status = await app.request(`/api/v1/jobs/${taskId}`, { headers });
    const statusBody = await status.json();
    expect(status.status).toBe(200);
    expect(statusBody.data.id).toBe(taskId);

    const items = await app.request(`/api/v1/jobs/${taskId}/items`, { headers });
    const itemsBody = await items.json();
    expect(items.status).toBe(200);
    expect(itemsBody.data.task_id).toBe(taskId);
    expect(itemsBody.data.items).toHaveLength(1);

    const exported = await app.request(`/api/v1/jobs/${taskId}/export.json`, { headers });
    const exportedBody = await exported.json();
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-disposition")).toContain(`batch-${taskId}-full-`);
    expect(exportedBody.task_id).toBe(taskId);
    expect(exportedBody.items).toHaveLength(1);
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
      if (url.includes("/aweme/v1/web/comment/list/")) {
        return new Response(
          JSON.stringify({
            status_code: 0,
            total: 1,
            has_more: 0,
            comments: [{ cid: "c-async", text: "async queued comment", user: { nickname: "queued_viewer" }, digg_count: 3, create_time: 1710000100 }],
          }),
          { headers: { "content-type": "application/json" } },
        );
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

    const aiBatchAlias = await app.request("/api/v1/ai/batch", {
      method: "POST",
      headers,
      body: JSON.stringify({ task_id: taskId, prompt: "批量别名入口", count: 1 }),
    });
    const aiBatchAliasBody = await aiBatchAlias.json();
    expect(aiBatchAlias.status).toBe(200);
    expect(aiBatchAliasBody.data.task_id).toBe(taskId);
    expect(aiBatchAliasBody.data.generated_count).toBe(1);

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

    const asyncAi = await app.request(`/api/v1/batch/${taskId}/ai`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt: "队列化", count: 1, async: true }),
    });
    const asyncAiBody = await asyncAi.json();
    expect(asyncAi.status).toBe(202);
    expect(asyncAiBody.data.job.type).toBe("ai");
    expect(asyncAiBody.data.job.requested_count).toBe(1);

    const asyncComments = await app.request(`/api/v1/batch/${taskId}/comments/collect`, {
      method: "POST",
      headers,
      body: JSON.stringify({ count_per_video: 1, video_count: 1, async: true }),
    });
    const asyncCommentsBody = await asyncComments.json();
    expect(asyncComments.status).toBe(202);
    expect(asyncCommentsBody.data.job.type).toBe("comments");

    let postJobTask: any = null;
    for (let index = 0; index < 30; index += 1) {
      const task = await app.request(`/api/v1/batch/${taskId}`, { headers });
      postJobTask = await task.json();
      if (postJobTask.data.post_jobs.length >= 2 && postJobTask.data.post_jobs.every((job: any) => job.status === "completed")) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(postJobTask.data.post_jobs.some((job: any) => job.type === "ai" && job.completed_count === 1)).toBe(true);
    expect(postJobTask.data.post_jobs.some((job: any) => job.type === "comments" && job.completed_count === 1)).toBe(true);
    expect(postJobTask.data.items[0].comments.some((comment: any) => comment.text === "async queued comment")).toBe(true);

    const jobs = await app.request(`/api/v1/batch/${taskId}/jobs`, { headers });
    const jobsBody = await jobs.json();
    expect(jobs.status).toBe(200);
    expect(jobsBody.data.jobs.length).toBeGreaterThanOrEqual(2);
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
      if (url.includes("/aweme/v1/web/comment/list/")) {
        return new Response(
          JSON.stringify({
            status_code: 0,
            total: 1,
            has_more: 0,
            comments: [{ cid: "c-async", text: "async queued comment", user: { nickname: "queued_viewer" }, digg_count: 3, create_time: 1710000100 }],
          }),
          { headers: { "content-type": "application/json" } },
        );
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
    const guestPreview = await app.request("/api/v1/profile/preview", {
      method: "POST",
      body: JSON.stringify({ url: "https://www.douyin.com/user/SEC_PREVIEW", count: 1 }),
    });
    const guestPreviewBody = await guestPreview.json();
    expect(guestPreview.status).toBe(200);
    expect(guestPreviewBody.data.preview_count).toBe(1);
    expect(guestPreviewBody.data.items[0].download_url).toContain("/api/v1/download");

    const streamedPreview = await app.request("/api/v1/profile/preview/stream", {
      method: "POST",
      body: JSON.stringify({ url: "https://www.douyin.com/user/SEC_PREVIEW", count: 2 }),
    });
    const streamEvents = (await streamedPreview.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(streamedPreview.status).toBe(200);
    expect(streamedPreview.headers.get("content-type")).toContain("application/x-ndjson");
    expect(streamEvents.map((event) => event.type)).toEqual(["phase", "inspect", "item", "item", "done"]);
    expect(streamEvents.find((event) => event.type === "inspect").target_count).toBe(2);
    expect(streamEvents.find((event) => event.type === "done").data.preview_count).toBe(2);

    const guestVideos = await app.request("/api/v1/profile/SEC_PREVIEW/videos?count=1");
    const guestVideosBody = await guestVideos.json();
    expect(guestVideos.status).toBe(200);
    expect(guestVideosBody.data.profile_id).toBe("SEC_PREVIEW");
    expect(guestVideosBody.data.preview_count).toBe(1);

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
    expect(previewBody.data.offset).toBe(0);
    expect(previewBody.data.has_more).toBe(true);
    expect(previewBody.data.next_offset).toBe(1);
    expect(previewBody.data.preview_count).toBe(1);
    expect(previewBody.data.items[0].download_url).toContain("/api/v1/download");

    const morePreview = await app.request("/api/v1/profile/preview", {
      method: "POST",
      headers,
      body: JSON.stringify({ url: "https://www.douyin.com/user/SEC_PREVIEW", count: 1, offset: 1 }),
    });
    const morePreviewBody = await morePreview.json();
    expect(morePreview.status).toBe(200);
    expect(morePreviewBody.data.offset).toBe(1);
    expect(morePreviewBody.data.has_more).toBe(false);
    expect(morePreviewBody.data.items[0].aweme_id).toBe("7673000000000000002");

    const videos = await app.request("/api/v1/profile/SEC_PREVIEW/videos?count=1&offset=1", { headers });
    const videosBody = await videos.json();
    expect(videos.status).toBe(200);
    expect(videosBody.data.profile_id).toBe("SEC_PREVIEW");
    expect(videosBody.data.offset).toBe(1);
    expect(videosBody.data.preview_count).toBe(1);
    expect(videosBody.data.items[0].download_url).toContain("/api/v1/download");

    for (let index = 0; index < 5; index += 1) {
      await app.request("/api/v1/online/ping", {
        method: "POST",
        body: JSON.stringify({ client_id: `queue-client-${index}` }),
      });
    }
    const queue = await app.request("/api/v1/batch/queue/status", { headers });
    const queueBody = await queue.json();
    expect(queue.status).toBe(200);
    expect(queueBody.data.adaptive.active_connections).toBe(5);
    expect(queueBody.data.adaptive.pressure_level).toBe(1);
    expect(queueBody.data.max_active_tasks).toBe(1);
    expect(queueBody.data.max_global_concurrency).toBe(3);
  });

  it("does not report a successful empty profile when the upstream post api is blocked", async () => {
    const fetcher = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/aweme/v1/web/aweme/post/")) {
        return new Response("", { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response('<html>{"sec_uid":"SEC_EMPTY"}</html>', {
        headers: { "content-type": "text/html" },
      });
    };
    const app = createApp({ fetcher, cacheTtlMs: 0 });
    const response = await app.request("/api/v1/profile/preview", {
      method: "POST",
      body: JSON.stringify({ url: "https://www.douyin.com/user/SEC_EMPTY", count: 8 }),
    });
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("FETCH_FAILED");
    expect(body.error.detail).toContain("empty body");
  });
});
