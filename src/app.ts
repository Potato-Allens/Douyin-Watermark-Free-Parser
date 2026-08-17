import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  DouyinServiceError,
  cancelBatchTask,
  fetchDouyinComments,
  generateAiCopy,
  getBatchQueueSnapshot,
  getBatchTask,
  getCreatorStore,
  getVipStore,
  inspectBatchHomepage,
  listBatchTasks,
  makeErrorResponse,
  parseDouyinUrl,
  proxyMediaUrl,
  saveBatchTask,
  startBatchTask,
  testLlmSettings,
  toServiceError,
} from "./core/index.ts";
import type { ApiSuccessResponse, BatchComment, BatchItem, BatchTask, CreatorStore, FetchLike, MemberSession, ParseOptions, ParsedDouyinInfo, SecuritySettings, VipSession, VipStore } from "./core/index.ts";
import { renderAdminPage } from "./admin-ui.ts";
import { renderDesignsPage } from "./designs-ui.ts";
import { renderHomePage } from "./ui.ts";

export interface CreateAppOptions {
  parserOptions?: ParseOptions;
  fetcher?: FetchLike;
  cacheTtlMs?: number;
  vipStore?: VipStore;
  creatorStore?: CreatorStore;
  onlineBaseCount?: number;
  onlineTtlMs?: number;
}

export function createApp(options: CreateAppOptions = {}) {
  const app = new Hono();

  const parserOptions: ParseOptions = {
    ...options.parserOptions,
    fetcher: options.fetcher ?? options.parserOptions?.fetcher,
  };
  const cache = new Map<string, { expiresAt: number; value: ParsedDouyinInfo }>();
  const cacheTtlMs = options.cacheTtlMs ?? 60_000;
  const vipStorePromise = options.vipStore ? Promise.resolve(options.vipStore) : null;
  const onlineSessions = new Map<string, number>();
  const onlineTtlMs = options.onlineTtlMs ?? 45_000;
  const onlineBaseCount = options.onlineBaseCount ?? parsePositiveInt(getRuntimeEnv().ONLINE_BASE_COUNT, 0);
  const creatorStorePromise = options.creatorStore ? Promise.resolve(options.creatorStore) : getCreatorStore();
  const adminSessions = new Map<string, number>();
  const adminLoginFailures = new Map<string, { count: number; resetAt: number; lockedUntil: number }>();
  const rateBuckets = new Map<string, { resetAt: number; count: number }>();
  const parseRateLimit = parsePositiveInt(getRuntimeEnv().PARSE_RATE_LIMIT_PER_MINUTE, 60);
  const mediaRateLimit = parsePositiveInt(getRuntimeEnv().MEDIA_RATE_LIMIT_PER_MINUTE, 120);
  const batchRateLimit = parsePositiveInt(getRuntimeEnv().BATCH_RATE_LIMIT_PER_HOUR, 30);
  const aiRateLimit = parsePositiveInt(getRuntimeEnv().AI_RATE_LIMIT_PER_DAY, 1000);
  const commentsRateLimit = parsePositiveInt(getRuntimeEnv().COMMENTS_RATE_LIMIT_PER_DAY, 200);
  const adminLoginMaxFailures = parsePositiveInt(getRuntimeEnv().ADMIN_LOGIN_MAX_FAILURES, 5);
  const adminLoginWindowMs = parsePositiveInt(getRuntimeEnv().ADMIN_LOGIN_WINDOW_MINUTES, 15) * 60 * 1000;
  const adminLoginLockMs = parsePositiveInt(getRuntimeEnv().ADMIN_LOGIN_LOCK_MINUTES, 15) * 60 * 1000;

  const recordUsage = async (input: { kind: string; user_key?: string; ip: string; path: string; status: number; detail?: string | null }) => {
    try {
      await (await creatorStorePromise).recordUsage({
        kind: input.kind,
        user_key: input.user_key ?? "guest",
        ip: input.ip,
        path: input.path,
        status: input.status,
        detail: input.detail ?? null,
      });
    } catch {
      // Usage logging must never break the user-facing parsing flow.
    }
  };

  const enforcePublicRateLimit = (kind: string, c: Context, limit: number, windowMs = 60_000, cost = 1) => {
    enforceRateLimit(rateBuckets, `${kind}:${getClientIp(c)}`, limit, windowMs, cost);
  };

  const adminLoginKey = (ip: string, username: string | null) => `admin-login:${ip}:${username ?? "unknown"}`;

  const assertAdminLoginAllowed = (key: string) => {
    const now = Date.now();
    const failure = adminLoginFailures.get(key);
    if (!failure) return;
    if (failure.lockedUntil > now) {
      throw new DouyinServiceError("UNSUPPORTED_CONTENT", `admin login is temporarily locked until ${new Date(failure.lockedUntil).toISOString()}`, 429);
    }
    if (failure.resetAt <= now) adminLoginFailures.delete(key);
  };

  const recordAdminLoginFailure = (key: string) => {
    const now = Date.now();
    const current = adminLoginFailures.get(key);
    const failure =
      !current || current.resetAt <= now
        ? { count: 0, resetAt: now + adminLoginWindowMs, lockedUntil: 0 }
        : current;
    failure.count += 1;
    if (failure.count >= adminLoginMaxFailures) failure.lockedUntil = now + adminLoginLockMs;
    adminLoginFailures.set(key, failure);
    return {
      failure_count: failure.count,
      locked_until: failure.lockedUntil ? new Date(failure.lockedUntil).toISOString() : null,
      reset_at: new Date(failure.resetAt).toISOString(),
    };
  };

  const clearAdminLoginFailure = (key: string) => {
    adminLoginFailures.delete(key);
  };

  const getEffectiveRateLimits = async () => {
    const stored = await (await creatorStorePromise).getRateLimitSettings();
    if (stored.updated_at) return stored;
    return {
      ...stored,
      parse_per_minute: parseRateLimit,
      media_per_minute: mediaRateLimit,
      batch_per_hour: batchRateLimit,
      ai_per_day: aiRateLimit,
      comments_per_day: commentsRateLimit,
    };
  };

  const getEffectiveSecuritySettings = async () => (await creatorStorePromise).getSecuritySettings();

  const guardPublicAccess = async (c: Context, kind: string) => {
    const settings = await getEffectiveSecuritySettings();
    const reason = securityDenyReason(c, settings);
    if (!reason) return;
    const ip = getClientIp(c);
    const path = new URL(c.req.url).pathname;
    const detail = JSON.stringify({
      kind,
      path,
      reason,
      origin: c.req.header("origin") ?? null,
      referer: c.req.header("referer") ?? null,
      user_agent: c.req.header("user-agent") ?? null,
    });
    await recordUsage({ kind: `blocked_${kind}`, ip, path, status: 403, detail });
    await (await creatorStorePromise).recordAudit({ actor: "system", action: "security_blocked_request", ip, detail });
    throw new DouyinServiceError("UNSUPPORTED_CONTENT", `request blocked by security policy: ${reason}`, 403);
  };

  const cleanupOnlineSessions = () => {
    const now = Date.now();
    for (const [id, expiresAt] of onlineSessions.entries()) {
      if (expiresAt <= now) onlineSessions.delete(id);
    }
  };

  const onlineStats = () => {
    cleanupOnlineSessions();
    const activeConnections = onlineSessions.size;
    return {
      online_count: onlineBaseCount + activeConnections,
      active_connections: activeConnections,
      base_count: onlineBaseCount,
      ttl_seconds: Math.ceil(onlineTtlMs / 1000),
    };
  };

  const touchOnline = (clientId: string) => {
    cleanupOnlineSessions();
    onlineSessions.set(clientId, Date.now() + onlineTtlMs);
    return onlineStats();
  };

  const parseForRequest = async (inputUrl: string) => {
    if (cacheTtlMs > 0) {
      const cached = cache.get(inputUrl);
      if (cached && cached.expiresAt > Date.now()) return cached.value;
      if (cached) cache.delete(inputUrl);
    }
    const parsed = await parseDouyinUrl(inputUrl, parserOptions);
    if (cacheTtlMs > 0) cache.set(inputUrl, { expiresAt: Date.now() + cacheTtlMs, value: parsed });
    return parsed;
  };

  const getStore = () => vipStorePromise ?? getVipStore();

  app.get("/", async (c) => {
    const requestUrl = new URL(c.req.url);
    if (!requestUrl.searchParams.has("url")) return c.html(renderHomePage());
    return handleCompat(c.req.url, parseForRequest, {
      before: async () => {
        await guardPublicAccess(c, "compat_parse");
        enforcePublicRateLimit("compat_parse", c, (await getEffectiveRateLimits()).parse_per_minute);
      },
      after: (status, detail) => recordUsage({ kind: "compat_parse", ip: getClientIp(c), path: "/", status, detail }),
    });
  });

  app.get("/admin", (c) => c.html(renderAdminPage()));

  app.get("/designs", (c) => c.html(renderDesignsPage()));

  app.get("/api/hello", async (c) => {
    return handleCompat(c.req.url, parseForRequest, {
      before: async () => {
        await guardPublicAccess(c, "compat_parse");
        enforcePublicRateLimit("compat_parse", c, (await getEffectiveRateLimits()).parse_per_minute);
      },
      after: (status, detail) => recordUsage({ kind: "compat_parse", ip: getClientIp(c), path: "/api/hello", status, detail }),
    });
  });

  app.get("/api/v1/parse", async (c) => {
    const requestUrl = new URL(c.req.url);
    const inputUrl = requestUrl.searchParams.get("url");
    if (!inputUrl) {
      await recordUsage({ kind: "parse", ip: getClientIp(c), path: "/api/v1/parse", status: 400, detail: "missing url" });
      return c.json(makeErrorResponse(new DouyinServiceError("MISSING_URL")), 400);
    }

    try {
      await guardPublicAccess(c, "parse");
      enforcePublicRateLimit("parse", c, (await getEffectiveRateLimits()).parse_per_minute);
      const parsed = decorateParsedInfo(await parseForRequest(inputUrl), getPublicRequestUrl(c));
      await recordUsage({ kind: "parse", ip: getClientIp(c), path: "/api/v1/parse", status: 200, detail: JSON.stringify({ aweme_id: parsed.source.aweme_id, type: parsed.media.type }) });
      return c.json(success(parsed));
    } catch (error) {
      await recordUsage({ kind: "parse", ip: getClientIp(c), path: "/api/v1/parse", status: error instanceof DouyinServiceError ? error.status : 500, detail: error instanceof Error ? error.message : String(error) });
      return jsonError(c, error);
    }
  });

  app.get("/api/v1/media", async (c) => {
    const requestUrl = new URL(c.req.url);
    const mediaUrl = requestUrl.searchParams.get("url");
    if (!mediaUrl) {
      await recordUsage({ kind: "media_proxy", ip: getClientIp(c), path: "/api/v1/media", status: 400, detail: "missing url" });
      return c.json(makeErrorResponse(new DouyinServiceError("MISSING_URL")), 400);
    }
    try {
      await guardPublicAccess(c, "media_proxy");
      enforcePublicRateLimit("media_proxy", c, (await getEffectiveRateLimits()).media_per_minute);
      const response = await proxyMediaUrl(mediaUrl, c.req.raw, "inline", requestUrl.searchParams.get("filename"));
      await recordUsage({ kind: "media_proxy", ip: getClientIp(c), path: "/api/v1/media", status: response.status, detail: safeUsageUrlDetail(mediaUrl) });
      return response;
    } catch (error) {
      await recordUsage({ kind: "media_proxy", ip: getClientIp(c), path: "/api/v1/media", status: error instanceof DouyinServiceError ? error.status : 500, detail: error instanceof Error ? error.message : String(error) });
      return jsonError(c, error);
    }
  });

  app.get("/api/v1/download", async (c) => {
    const requestUrl = new URL(c.req.url);
    const mediaUrl = requestUrl.searchParams.get("url");
    if (!mediaUrl) {
      await recordUsage({ kind: "download_proxy", ip: getClientIp(c), path: "/api/v1/download", status: 400, detail: "missing url" });
      return c.json(makeErrorResponse(new DouyinServiceError("MISSING_URL")), 400);
    }
    try {
      await guardPublicAccess(c, "download_proxy");
      enforcePublicRateLimit("download_proxy", c, (await getEffectiveRateLimits()).media_per_minute);
      const response = await proxyMediaUrl(mediaUrl, c.req.raw, "attachment", requestUrl.searchParams.get("filename"));
      await recordUsage({ kind: "download_proxy", ip: getClientIp(c), path: "/api/v1/download", status: response.status, detail: safeUsageUrlDetail(mediaUrl) });
      return response;
    } catch (error) {
      await recordUsage({ kind: "download_proxy", ip: getClientIp(c), path: "/api/v1/download", status: error instanceof DouyinServiceError ? error.status : 500, detail: error instanceof Error ? error.message : String(error) });
      return jsonError(c, error);
    }
  });

  app.get("/api/v1/online", (c) => c.json(success(onlineStats())));

  app.post("/api/v1/online/ping", async (c) => {
    try {
      const body = await readJsonBody(c);
      const clientId = asString(body.client_id) ?? randomId();
      return c.json(success({ client_id: clientId, ...touchOnline(clientId) }));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/api/v1/vip/activate", async (c) => {
    try {
      const body = await readJsonBody(c);
      const code = asString(body.code);
      if (!code) throw new DouyinServiceError("UNSUPPORTED_CONTENT", "activation code is required", 400);
      const session = await (await getStore()).activate(code);
      if (!session) throw new DouyinServiceError("UNSUPPORTED_CONTENT", "activation code is invalid or already used", 403);
      const maxAge = Math.max(1, Math.floor((session.expires_at - Date.now()) / 1000));
      c.header("set-cookie", buildVipCookie(session.token, maxAge, getPublicRequestUrl(c)));
      return c.json(
        success({
          activated: true,
          token: session.token,
          code: session.code,
          expires_at: new Date(session.expires_at).toISOString(),
        }),
      );
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/api/v1/vip/status", async (c) => {
    try {
      const session = await (await getStore()).verify(readVipToken(c.req.raw));
      return c.json(
        success({
          activated: Boolean(session),
          code: session?.code ?? null,
          expires_at: session ? new Date(session.expires_at).toISOString() : null,
          member: isMemberSession(session)
            ? {
                user_id: session.user_id,
                username: session.username,
                plan: session.plan,
              }
            : null,
        }),
      );
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/api/v1/plans", async (c) => {
    try {
      return c.json(success(await (await getStore()).listPlans()));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/api/v1/auth/register", async (c) => {
    try {
      const body = await readJsonBody(c);
      const code = asString(body.code);
      const username = asString(body.username);
      const password = asString(body.password);
      if (!code) throw new DouyinServiceError("UNSUPPORTED_CONTENT", "activation code is required", 400);
      if (!username) throw new DouyinServiceError("UNSUPPORTED_CONTENT", "username is required", 400);
      if (!password) throw new DouyinServiceError("UNSUPPORTED_CONTENT", "password is required", 400);
      const session = await (await getStore()).registerWithCode({ code, username, password });
      if (!session) throw new DouyinServiceError("UNSUPPORTED_CONTENT", "activation code is invalid or already used", 403);
      const maxAge = Math.max(1, Math.floor((session.expires_at - Date.now()) / 1000));
      c.header("set-cookie", buildVipCookie(session.token, maxAge, getPublicRequestUrl(c)));
      return c.json(success(memberSessionPayload(session)));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/api/v1/auth/login", async (c) => {
    try {
      const body = await readJsonBody(c);
      const username = asString(body.username);
      const password = asString(body.password);
      if (!username) throw new DouyinServiceError("UNSUPPORTED_CONTENT", "username is required", 400);
      if (!password) throw new DouyinServiceError("UNSUPPORTED_CONTENT", "password is required", 400);
      const session = await (await getStore()).login({ username, password });
      if (!session) throw new DouyinServiceError("UNSUPPORTED_CONTENT", "username or password is invalid", 403);
      const maxAge = Math.max(1, Math.floor((session.expires_at - Date.now()) / 1000));
      c.header("set-cookie", buildVipCookie(session.token, maxAge, getPublicRequestUrl(c)));
      return c.json(success(memberSessionPayload(session)));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/api/v1/auth/logout", (c) => {
    c.header("set-cookie", clearVipCookie(getPublicRequestUrl(c)));
    return c.json(success({ logged_out: true }));
  });

  app.get("/api/v1/me", async (c) => {
    try {
      const session = await (await getStore()).verify(readVipToken(c.req.raw));
      return c.json(
        success({
          activated: Boolean(session),
          session_type: isMemberSession(session) ? "member" : session ? "legacy_vip" : "guest",
          code: session?.code ?? null,
          expires_at: session ? new Date(session.expires_at).toISOString() : null,
          member: isMemberSession(session) ? memberSessionPayload(session).member : null,
          permissions: permissionsForSession(session),
        }),
      );
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/api/v1/batch/inspect", async (c) => {
    let sessionKey = "unknown";
    try {
      await guardPublicAccess(c, "batch_inspect");
      const session = await requireVip(c, await getStore());
      sessionKey = session.code;
      const body = await readJsonBody(c);
      const homepageUrl = asString(body.url) ?? asString(body.homepage_url);
      if (!homepageUrl) throw new DouyinServiceError("MISSING_URL");
      const maxItems = Math.min(parsePositiveInt(body.count ?? body.max_items, getBatchParseLimit(session)), getBatchParseLimit(session));
      enforceRateLimit(rateBuckets, `batch-inspect:${session.code}:${getClientIp(c)}`, (await getEffectiveRateLimits()).batch_per_hour, 60 * 60 * 1000);
      const data = await inspectBatchHomepage(homepageUrl, { ...parserOptions, maxItems });
      await recordUsage({ kind: "batch_inspect", user_key: session.code, ip: getClientIp(c), path: "/api/v1/batch/inspect", status: 200, detail: JSON.stringify({ requested_count: maxItems, available_count: data.available_count, total_count: data.total_count }) });
      return c.json(success(data));
    } catch (error) {
      await recordUsage({ kind: "batch_inspect", user_key: sessionKey, ip: getClientIp(c), path: "/api/v1/batch/inspect", status: error instanceof DouyinServiceError ? error.status : 500, detail: error instanceof Error ? error.message : String(error) });
      return jsonError(c, error);
    }
  });

  app.post("/api/v1/profile/preview", async (c) => {
    let sessionKey = "unknown";
    try {
      await guardPublicAccess(c, "profile_preview");
      const session = await requireVip(c, await getStore());
      sessionKey = session.code;
      const body = await readJsonBody(c);
      const homepageUrl = asString(body.url) ?? asString(body.homepage_url);
      if (!homepageUrl) throw new DouyinServiceError("MISSING_URL");
      const previewLimit = Math.min(parsePositiveInt(body.count, 8), getBatchParseLimit(session), 24);
      enforceRateLimit(rateBuckets, `profile-preview:${session.code}:${getClientIp(c)}`, Math.max(20, (await getEffectiveRateLimits()).batch_per_hour), 60 * 60 * 1000);
      const inspect = await inspectBatchHomepage(homepageUrl, { ...parserOptions, maxItems: previewLimit });
      const ids = inspect.aweme_ids.slice(0, previewLimit);
      const publicRequestUrl = getPublicRequestUrl(c);
      const items = [];
      for (const awemeId of ids) {
        try {
          const parsed = decorateParsedInfo(await parseForRequest(`https://www.douyin.com/video/${awemeId}`), publicRequestUrl);
          items.push(profilePreviewItem(awemeId, parsed));
        } catch (error) {
          items.push({
            aweme_id: awemeId,
            status: "failed",
            page_url: `https://www.douyin.com/video/${awemeId}`,
            title: null,
            author_nickname: null,
            cover_url: null,
            video_url: null,
            download_url: null,
            music_title: null,
            stats: { comment_count: null, digg_count: null, share_count: null, collect_count: null },
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      await recordUsage({ kind: "profile_preview", user_key: session.code, ip: getClientIp(c), path: "/api/v1/profile/preview", status: 200, detail: JSON.stringify({ preview_count: items.length, total_count: inspect.total_count }) });
      return c.json(success({ ...inspect, preview_count: items.length, items }));
    } catch (error) {
      await recordUsage({ kind: "profile_preview", user_key: sessionKey, ip: getClientIp(c), path: "/api/v1/profile/preview", status: error instanceof DouyinServiceError ? error.status : 500, detail: error instanceof Error ? error.message : String(error) });
      return jsonError(c, error);
    }
  });

  app.post("/api/v1/batch/start", async (c) => {
    let sessionKey = "unknown";
    try {
      await guardPublicAccess(c, "batch_start");
      const session = await requireVip(c, await getStore());
      sessionKey = session.code;
      const body = await readJsonBody(c);
      const homepageUrl = asString(body.url) ?? asString(body.homepage_url);
      if (!homepageUrl) throw new DouyinServiceError("MISSING_URL");
      const count = parsePositiveInt(body.count, 1);
      const maxCount = getBatchParseLimit(session);
      if (count > maxCount) throw new DouyinServiceError("UNSUPPORTED_CONTENT", `current plan allows up to ${maxCount} works per batch`, 403);
      const concurrency = Math.min(parsePositiveInt(body.concurrency, 3), getConcurrencyLimit(session));
      enforceRateLimit(rateBuckets, `batch-start:${session.code}:${getClientIp(c)}`, (await getEffectiveRateLimits()).batch_per_hour, 60 * 60 * 1000);
      const publicRequestUrl = getPublicRequestUrl(c);
      const permissions = permissionsForSession(session);
      const task = await startBatchTask({
        homepageUrl,
        count,
        concurrency,
        parseOptions: parserOptions,
        parseByAwemeId: async (awemeId) => parseForRequest(`https://www.douyin.com/video/${awemeId}`),
        makeDownloadUrl: (parsed) => decorateParsedInfo(parsed, publicRequestUrl).download.download_url,
        ownerKey: session.code,
        queuePriority: permissions.queue_priority,
      });
      await recordUsage({ kind: "batch_start", user_key: session.code, ip: getClientIp(c), path: "/api/v1/batch/start", status: 200, detail: JSON.stringify({ task_id: task.id, requested_count: task.requested_count, concurrency: task.concurrency, queue_priority: task.queue_priority }) });
      return c.json(success(task));
    } catch (error) {
      await recordUsage({ kind: "batch_start", user_key: sessionKey, ip: getClientIp(c), path: "/api/v1/batch/start", status: error instanceof DouyinServiceError ? error.status : 500, detail: error instanceof Error ? error.message : String(error) });
      return jsonError(c, error);
    }
  });

  app.get("/api/v1/batch/:id", async (c) => {
    try {
      await guardPublicAccess(c, "batch_status");
      await requireVip(c, await getStore());
      const task = await getBatchTask(c.req.param("id"));
      if (!task) throw new DouyinServiceError("PARSE_FAILED", "batch task not found", 404);
      return c.json(success(task));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/api/v1/batch/queue/status", async (c) => {
    try {
      await guardPublicAccess(c, "batch_queue");
      await requireVip(c, await getStore());
      return c.json(success(await getBatchQueueSnapshot()));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/api/v1/batch/:id/ai", async (c) => {
    const store = await creatorStorePromise;
    try {
      await guardPublicAccess(c, "batch_ai");
      const session = await requireVip(c, await getStore());
      const task = await getBatchTask(c.req.param("id"));
      if (!task) throw new DouyinServiceError("PARSE_FAILED", "batch task not found", 404);
      const body = await readJsonBody(c);
      const prompt = asString(body.prompt);
      const mode = asString(body.mode) ?? "batch_script";
      const limit = Math.min(parsePositiveInt(body.count, task.items.length), getBatchAiLimit(session));
      const items = task.items.filter((item) => item.status === "success").slice(0, limit);
      if (items.length === 0) throw new DouyinServiceError("UNSUPPORTED_CONTENT", "batch task has no successful video item for AI copywriting", 409);
      if (items.length > getBatchAiLimit(session)) throw new DouyinServiceError("UNSUPPORTED_CONTENT", `current plan allows up to ${getBatchAiLimit(session)} AI scripts per batch`, 403);
      const aiQuota = Math.min(getAiDailyQuota(session), (await getEffectiveRateLimits()).ai_per_day);
      if (aiQuota <= 0) throw new DouyinServiceError("UNSUPPORTED_CONTENT", "current plan does not include AI copywriting", 403);
      enforceRateLimit(rateBuckets, `batch-ai:${session.code}:${getClientIp(c)}`, Math.max(1, Math.floor(aiQuota / 2)), 24 * 60 * 60 * 1000, items.length);

      const results = [];
      for (const item of items) {
        const parsed = parsedFromBatchItem(task, item);
        const ai = await generateAiCopy({ parsed, prompt, mode, store, fetcher: parserOptions.fetcher });
        item.ai_copy = ai;
        results.push({ aweme_id: item.aweme_id, title: item.title, ai_copy: ai });
      }
      await saveBatchTask(task);
      await store.recordUsage({ kind: `batch_ai_${mode}`, user_key: session.code, ip: getClientIp(c), path: `/api/v1/batch/${task.id}/ai`, status: 200, detail: JSON.stringify({ count: results.length }) });
      return c.json(success({ task_id: task.id, generated_count: results.length, items: results }));
    } catch (error) {
      await store.recordUsage({ kind: "batch_ai", user_key: "unknown", ip: getClientIp(c), path: `/api/v1/batch/${c.req.param("id")}/ai`, status: error instanceof DouyinServiceError ? error.status : 500, detail: error instanceof Error ? error.message : String(error) });
      return jsonError(c, error);
    }
  });

  app.get("/api/v1/batch/:id/export", async (c) => {
    try {
      await guardPublicAccess(c, "batch_export");
      const session = await requireVip(c, await getStore());
      const task = await getBatchTask(c.req.param("id"));
      if (!task) throw new DouyinServiceError("PARSE_FAILED", "batch task not found", 404);
      const requestUrl = new URL(c.req.url);
      const type = requestUrl.searchParams.get("type") ?? "json";
      if (type === "comments" && isMemberSession(session) && !session.plan.comment_export) {
        throw new DouyinServiceError("UNSUPPORTED_CONTENT", "current plan does not include comment export", 403);
      }
      if (type === "covers" && isMemberSession(session) && !session.plan.cover_batch_download) {
        throw new DouyinServiceError("UNSUPPORTED_CONTENT", "current plan does not include cover export", 403);
      }
      return batchExportResponse(task, type);
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/api/v1/batch/:id/comments", async (c) => {
    try {
      await guardPublicAccess(c, "batch_comments");
      const session = await requireVip(c, await getStore());
      if (isMemberSession(session) && !session.plan.comment_export) {
        throw new DouyinServiceError("UNSUPPORTED_CONTENT", "current plan does not include comment export", 403);
      }
      const requestUrl = new URL(c.req.url);
      const awemeId = requestUrl.searchParams.get("aweme_id");
      const task = await getBatchTask(c.req.param("id"));
      if (!task) throw new DouyinServiceError("PARSE_FAILED", "batch task not found", 404);
      const items = awemeId ? task.items.filter((item) => item.aweme_id === awemeId) : task.items;
      return c.json(success({ task_id: task.id, aweme_id: awemeId ?? null, items: items.map((item) => ({ aweme_id: item.aweme_id, title: item.title, comments: item.comments })) }));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/api/v1/batch/:id/comments/import", async (c) => {
    try {
      await guardPublicAccess(c, "batch_comments_import");
      const session = await requireVip(c, await getStore());
      if (isMemberSession(session) && !session.plan.comment_export) {
        throw new DouyinServiceError("UNSUPPORTED_CONTENT", "current plan does not include comment import/export", 403);
      }
      const task = await getBatchTask(c.req.param("id"));
      if (!task) throw new DouyinServiceError("PARSE_FAILED", "batch task not found", 404);
      const body = await readJsonBody(c);
      const payloads = normalizeCommentImportPayload(body);
      let imported = 0;
      for (const payload of payloads) {
        const item = task.items.find((entry) => entry.aweme_id === payload.aweme_id);
        if (!item) continue;
        const merged = new Map(item.comments.map((comment) => [comment.cid, comment]));
        for (const comment of payload.comments) {
          merged.set(comment.cid, comment);
          imported += 1;
        }
        item.comments = [...merged.values()];
      }
      await saveBatchTask(task);
      return c.json(success({ task_id: task.id, imported_count: imported, items: task.items.map((item) => ({ aweme_id: item.aweme_id, comment_count: item.comments.length })) }));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/api/v1/ai/script", async (c) => {
    const store = await creatorStorePromise;
    try {
      await guardPublicAccess(c, "ai_script");
      const session = await requireVip(c, await getStore());
      const aiQuota = Math.min(getAiDailyQuota(session), (await getEffectiveRateLimits()).ai_per_day);
      if (aiQuota <= 0) throw new DouyinServiceError("UNSUPPORTED_CONTENT", "current plan does not include AI copywriting", 403);
      enforceRateLimit(rateBuckets, `ai:${session.code}:${getClientIp(c)}`, aiQuota, 24 * 60 * 60 * 1000);
      const body = await readJsonBody(c);
      const inputUrl = asString(body.url);
      if (!inputUrl) throw new DouyinServiceError("MISSING_URL");
      const prompt = asString(body.prompt);
      const mode = asString(body.mode) ?? "script";
      const parsed = decorateParsedInfo(await parseForRequest(inputUrl), getPublicRequestUrl(c));
      const data = await generateAiCopy({ parsed, prompt, mode, store, fetcher: parserOptions.fetcher });
      await store.recordUsage({ kind: `ai_${mode}`, user_key: session.code, ip: getClientIp(c), path: "/api/v1/ai/script", status: 200 });
      return c.json(success(data));
    } catch (error) {
      await store.recordUsage({ kind: "ai_script", user_key: "unknown", ip: getClientIp(c), path: "/api/v1/ai/script", status: error instanceof DouyinServiceError ? error.status : 500, detail: error instanceof Error ? error.message : String(error) });
      return jsonError(c, error);
    }
  });

  app.get("/api/v1/comments", async (c) => {
    const store = await creatorStorePromise;
    try {
      await guardPublicAccess(c, "comments_fetch");
      const session = await requireVip(c, await getStore());
      if (isMemberSession(session) && !session.plan.comment_export) {
        throw new DouyinServiceError("UNSUPPORTED_CONTENT", "current plan does not include comment export", 403);
      }
      const requestUrl = new URL(c.req.url);
      const awemeId = requestUrl.searchParams.get("aweme_id");
      const inputUrl = requestUrl.searchParams.get("url");
      const taskId = requestUrl.searchParams.get("task_id");
      if (taskId) {
        const task = await getBatchTask(taskId);
        if (!task) throw new DouyinServiceError("PARSE_FAILED", "batch task not found", 404);
        const items = awemeId ? task.items.filter((item) => item.aweme_id === awemeId) : task.items;
        return c.json(success({ task_id: task.id, aweme_id: awemeId ?? null, items: items.map((item) => ({ aweme_id: item.aweme_id, title: item.title, comments: item.comments })) }));
      }
      let targetAwemeId = awemeId;
      if (!targetAwemeId && inputUrl) {
        const parsed = await parseForRequest(inputUrl);
        targetAwemeId = parsed.source.aweme_id;
      }
      if (!targetAwemeId) throw new DouyinServiceError("MISSING_URL", "aweme_id or url query parameter is required");
      const count = Math.min(parsePositiveInt(requestUrl.searchParams.get("count") ?? requestUrl.searchParams.get("limit"), 20), 100);
      const cursor = parsePositiveInt(requestUrl.searchParams.get("cursor"), 0);
      enforceRateLimit(rateBuckets, `comments:${session.code}:${getClientIp(c)}`, (await getEffectiveRateLimits()).comments_per_day, 24 * 60 * 60 * 1000);
      const data = await fetchDouyinComments(targetAwemeId, { ...parserOptions, count, cursor });
      await store.recordUsage({ kind: "comments_fetch", user_key: session.code, ip: getClientIp(c), path: "/api/v1/comments", status: 200, detail: JSON.stringify({ aweme_id: targetAwemeId, count: data.comments.length }) });
      return c.json(success({ ...data, input_url: inputUrl ?? null }));
    } catch (error) {
      await store.recordUsage({ kind: "comments_fetch", user_key: "unknown", ip: getClientIp(c), path: "/api/v1/comments", status: error instanceof DouyinServiceError ? error.status : 500, detail: error instanceof Error ? error.message : String(error) });
      return jsonError(c, error);
    }
  });

  app.post("/api/admin/login", async (c) => {
    const store = await creatorStorePromise;
    const ip = getClientIp(c);
    let username: string | null = null;
    let loginKey = adminLoginKey(ip, null);
    try {
      const body = await readJsonBody(c);
      username = asString(body.username);
      const password = asString(body.password);
      const totp = asString(body.totp);
      loginKey = adminLoginKey(ip, username);
      assertAdminLoginAllowed(loginKey);
      const env = getRuntimeEnv();
      const expectedUser = env.ADMIN_USERNAME ?? "admin";
      const expectedPassword = env.ADMIN_PASSWORD;
      if (!expectedPassword) throw new DouyinServiceError("UNSUPPORTED_CONTENT", "admin password is not configured", 503);
      if (username !== expectedUser || password !== expectedPassword) {
        throw new DouyinServiceError("UNSUPPORTED_CONTENT", "admin credentials are invalid", 403);
      }
      if (env.ADMIN_TOTP_SECRET && !(await verifyTotpCode(env.ADMIN_TOTP_SECRET, totp))) {
        throw new DouyinServiceError("UNSUPPORTED_CONTENT", "admin totp code is invalid", 403);
      }
      clearAdminLoginFailure(loginKey);
      const token = randomId();
      const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
      adminSessions.set(token, expiresAt);
      c.header("set-cookie", buildAdminCookie(token, 8 * 60 * 60, getPublicRequestUrl(c)));
      await store.recordAudit({ actor: username, action: "admin_login", ip, detail: "success" });
      return c.json(success({ token, expires_at: new Date(expiresAt).toISOString(), totp_enabled: Boolean(env.ADMIN_TOTP_SECRET) }));
    } catch (error) {
      const serviceError = toServiceError(error);
      const loginFailed = serviceError.status === 403 && /credentials|totp/.test(serviceError.detail);
      const locked = serviceError.status === 429 && serviceError.detail.includes("temporarily locked");
      const failure = loginFailed ? recordAdminLoginFailure(loginKey) : null;
      await store.recordAudit({
        actor: username ?? "admin",
        action: locked ? "admin_login_locked" : "admin_login_failed",
        ip,
        detail: JSON.stringify({
          detail: serviceError.detail,
          status: serviceError.status,
          failure_count: failure?.failure_count ?? null,
          locked_until: failure?.locked_until ?? null,
        }),
      });
      return jsonError(c, error);
    }
  });

  app.get("/api/admin/settings/llm", async (c) => {
    try {
      requireAdmin(c, adminSessions);
      return c.json(success(await (await creatorStorePromise).getLlmSettings()));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/api/admin/settings/llm", async (c) => {
    const store = await creatorStorePromise;
    try {
      requireAdmin(c, adminSessions);
      const body = await readJsonBody(c);
      const data = await store.saveLlmSettings(body);
      await store.recordAudit({ actor: "admin", action: "llm_settings_save", ip: getClientIp(c), detail: JSON.stringify({ base_url: data.base_url, model: data.model, enabled: data.enabled }) });
      return c.json(success(data));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/api/admin/settings/llm/test", async (c) => {
    const store = await creatorStorePromise;
    try {
      requireAdmin(c, adminSessions);
      const body = await readJsonBody(c);
      const data = await testLlmSettings(body, store, parserOptions.fetcher);
      await store.recordAudit({ actor: "admin", action: "llm_settings_test", ip: getClientIp(c), detail: JSON.stringify({ base_url: data.base_url, model: data.model, latency_ms: data.latency_ms }) });
      return c.json(success(data));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/api/admin/rate-limits", async (c) => {
    try {
      requireAdmin(c, adminSessions);
      return c.json(success(await getEffectiveRateLimits()));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/api/admin/rate-limits", async (c) => {
    const store = await creatorStorePromise;
    try {
      requireAdmin(c, adminSessions);
      const body = await readJsonBody(c);
      const data = await store.saveRateLimitSettings({
        parse_per_minute: body.parse_per_minute as number | undefined,
        media_per_minute: body.media_per_minute as number | undefined,
        batch_per_hour: body.batch_per_hour as number | undefined,
        ai_per_day: body.ai_per_day as number | undefined,
        comments_per_day: body.comments_per_day as number | undefined,
      });
      await store.recordAudit({ actor: "admin", action: "rate_limits_save", ip: getClientIp(c), detail: JSON.stringify(data) });
      return c.json(success(data));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/api/admin/security", async (c) => {
    try {
      requireAdmin(c, adminSessions);
      return c.json(success(await (await creatorStorePromise).getSecuritySettings()));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/api/admin/security", async (c) => {
    const store = await creatorStorePromise;
    try {
      requireAdmin(c, adminSessions);
      const body = await readJsonBody(c);
      const data = await store.saveSecuritySettings({
        blocked_ips: (body.blocked_ips as string[] | string | undefined) ?? undefined,
        allowed_origin_hosts: (body.allowed_origin_hosts as string[] | string | undefined) ?? undefined,
        require_browser_headers: typeof body.require_browser_headers === "boolean" ? body.require_browser_headers : undefined,
        block_empty_user_agent: typeof body.block_empty_user_agent === "boolean" ? body.block_empty_user_agent : undefined,
      });
      await store.recordAudit({ actor: "admin", action: "security_settings_save", ip: getClientIp(c), detail: JSON.stringify(data) });
      return c.json(success(data));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/api/admin/block-ip", async (c) => {
    const store = await creatorStorePromise;
    try {
      requireAdmin(c, adminSessions);
      const body = await readJsonBody(c);
      const ip = asString(body.ip);
      if (!ip) throw new DouyinServiceError("UNSUPPORTED_CONTENT", "ip is required", 400);
      const current = await store.getSecuritySettings();
      const data = await store.saveSecuritySettings({ blocked_ips: [...new Set([...current.blocked_ips, ip])] });
      await store.recordAudit({ actor: "admin", action: "security_block_ip", ip: getClientIp(c), detail: JSON.stringify({ blocked_ip: ip, reason: asString(body.reason), blocked_count: data.blocked_ips.length }) });
      return c.json(success(data));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/api/admin/metrics", async (c) => {
    try {
      requireAdmin(c, adminSessions);
      return c.json(success({ ...(await (await creatorStorePromise).getMetrics()), online: onlineStats() }));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/api/v1/batch/:id/comments/collect", async (c) => {
    const store = await creatorStorePromise;
    try {
      await guardPublicAccess(c, "batch_comments_collect");
      const session = await requireVip(c, await getStore());
      if (isMemberSession(session) && !session.plan.comment_export) {
        throw new DouyinServiceError("UNSUPPORTED_CONTENT", "current plan does not include comment collection", 403);
      }
      const task = await getBatchTask(c.req.param("id"));
      if (!task) throw new DouyinServiceError("PARSE_FAILED", "batch task not found", 404);
      const body = await readJsonBody(c);
      const countPerVideo = Math.min(parsePositiveInt(body.count_per_video ?? body.count, 20), 100);
      const requestedIds = readAwemeIdSet(body.aweme_ids);
      const maxItems = Math.min(parsePositiveInt(body.video_count, task.items.length), task.items.length, getBatchParseLimit(session));
      const items = task.items.filter((item) => requestedIds.size === 0 || requestedIds.has(item.aweme_id)).slice(0, maxItems);
      enforceRateLimit(rateBuckets, `batch-comments:${session.code}:${getClientIp(c)}`, (await getEffectiveRateLimits()).comments_per_day, 24 * 60 * 60 * 1000, Math.max(1, items.length));
      let collectedCount = 0;
      const results = [];
      for (const item of items) {
        try {
          const fetched = await fetchDouyinComments(item.aweme_id, { ...parserOptions, count: countPerVideo });
          item.comments = mergeComments(item.comments, fetched.comments);
          collectedCount += fetched.comments.length;
          results.push({ aweme_id: item.aweme_id, title: item.title, collected_count: fetched.comments.length, total_comments: item.comments.length, next_cursor: fetched.next_cursor, has_more: fetched.has_more, error: null });
        } catch (error) {
          results.push({ aweme_id: item.aweme_id, title: item.title, collected_count: 0, total_comments: item.comments.length, next_cursor: null, has_more: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
      await saveBatchTask(task);
      await store.recordUsage({ kind: "batch_comments_collect", user_key: session.code, ip: getClientIp(c), path: `/api/v1/batch/${task.id}/comments/collect`, status: 200, detail: JSON.stringify({ video_count: items.length, collected_count: collectedCount }) });
      return c.json(success({ task_id: task.id, video_count: items.length, collected_count: collectedCount, items: results }));
    } catch (error) {
      await store.recordUsage({ kind: "batch_comments_collect", user_key: "unknown", ip: getClientIp(c), path: `/api/v1/batch/${c.req.param("id")}/comments/collect`, status: error instanceof DouyinServiceError ? error.status : 500, detail: error instanceof Error ? error.message : String(error) });
      return jsonError(c, error);
    }
  });

  app.get("/api/admin/usage", async (c) => {
    try {
      requireAdmin(c, adminSessions);
      const requestUrl = new URL(c.req.url);
      const limit = parsePositiveInt(requestUrl.searchParams.get("limit"), 50);
      return c.json(success(await (await creatorStorePromise).listUsage(limit)));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/api/admin/audit-logs", async (c) => {
    try {
      requireAdmin(c, adminSessions);
      const requestUrl = new URL(c.req.url);
      const limit = parsePositiveInt(requestUrl.searchParams.get("limit"), 50);
      return c.json(success(await (await creatorStorePromise).listAudit(limit)));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/api/admin/jobs", async (c) => {
    try {
      requireAdmin(c, adminSessions);
      const requestUrl = new URL(c.req.url);
      const limit = parsePositiveInt(requestUrl.searchParams.get("limit"), 50);
      const tasks = await listBatchTasks(limit);
      return c.json(success(tasks.map(adminTaskSummary)));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/api/admin/jobs/:id/cancel", async (c) => {
    const store = await creatorStorePromise;
    try {
      requireAdmin(c, adminSessions);
      const task = await cancelBatchTask(c.req.param("id"));
      if (!task) throw new DouyinServiceError("PARSE_FAILED", "batch task not found", 404);
      await store.recordAudit({ actor: "admin", action: "batch_job_cancel", ip: getClientIp(c), detail: JSON.stringify({ task_id: task.id, owner_key: task.owner_key, status: task.status }) });
      return c.json(success(adminTaskSummary(task)));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/api/admin/jobs/:id/retry", async (c) => {
    const store = await creatorStorePromise;
    try {
      requireAdmin(c, adminSessions);
      const original = await getBatchTask(c.req.param("id"));
      if (!original) throw new DouyinServiceError("PARSE_FAILED", "batch task not found", 404);
      const publicRequestUrl = getPublicRequestUrl(c);
      const task = await startBatchTask({
        homepageUrl: original.homepage_url,
        count: original.requested_count,
        concurrency: original.concurrency,
        parseOptions: parserOptions,
        parseByAwemeId: async (awemeId) => parseForRequest(`https://www.douyin.com/video/${awemeId}`),
        makeDownloadUrl: (parsed) => decorateParsedInfo(parsed, publicRequestUrl).download.download_url,
        ownerKey: original.owner_key,
        queuePriority: original.queue_priority,
      });
      await store.recordAudit({ actor: "admin", action: "batch_job_retry", ip: getClientIp(c), detail: JSON.stringify({ original_task_id: original.id, new_task_id: task.id, owner_key: task.owner_key }) });
      return c.json(success(adminTaskSummary(task)));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/api/admin/users", async (c) => {
    try {
      requireAdmin(c, adminSessions);
      const requestUrl = new URL(c.req.url);
      const limit = parsePositiveInt(requestUrl.searchParams.get("limit"), 100);
      return c.json(success(await (await getStore()).listMembers(limit)));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/api/admin/users/:id/plan", async (c) => {
    const store = await creatorStorePromise;
    try {
      requireAdmin(c, adminSessions);
      const body = await readJsonBody(c);
      const planId = asString(body.plan_id);
      if (!planId) throw new DouyinServiceError("UNSUPPORTED_CONTENT", "plan_id is required", 400);
      const user = await (await getStore()).updateMember(c.req.param("id"), { plan_id: planId, status: asString(body.status) ?? undefined });
      if (!user) throw new DouyinServiceError("PARSE_FAILED", "member user not found", 404);
      await store.recordAudit({ actor: "admin", action: "member_plan_update", ip: getClientIp(c), detail: JSON.stringify({ user_id: user.id, username: user.username, plan_id: user.plan_id, status: user.status }) });
      return c.json(success(user));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/api/admin/users/:id/disable", async (c) => {
    const store = await creatorStorePromise;
    try {
      requireAdmin(c, adminSessions);
      const user = await (await getStore()).updateMember(c.req.param("id"), { status: "disabled" });
      if (!user) throw new DouyinServiceError("PARSE_FAILED", "member user not found", 404);
      await store.recordAudit({ actor: "admin", action: "member_disable", ip: getClientIp(c), detail: JSON.stringify({ user_id: user.id, username: user.username }) });
      return c.json(success(user));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/api/admin/plans", async (c) => {
    try {
      requireAdmin(c, adminSessions);
      return c.json(success(await (await getStore()).listPlans()));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/api/admin/plans", async (c) => {
    const store = await creatorStorePromise;
    try {
      requireAdmin(c, adminSessions);
      const body = await readJsonBody(c);
      const plan = await (await getStore()).savePlan({
        id: asString(body.id) ?? "standard",
        name: asString(body.name) ?? undefined,
        queue_priority: body.queue_priority as number | undefined,
        batch_parse_limit: body.batch_parse_limit as number | undefined,
        batch_ai_limit: body.batch_ai_limit as number | undefined,
        comment_export: typeof body.comment_export === "boolean" ? body.comment_export : undefined,
        cover_batch_download: typeof body.cover_batch_download === "boolean" ? body.cover_batch_download : undefined,
        ai_daily_quota: body.ai_daily_quota as number | undefined,
        concurrency: body.concurrency as number | undefined,
      });
      await store.recordAudit({ actor: "admin", action: "member_plan_save", ip: getClientIp(c), detail: JSON.stringify({ id: plan.id, name: plan.name }) });
      return c.json(success(plan));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/api/admin/codes", async (c) => {
    try {
      requireAdmin(c, adminSessions);
      const requestUrl = new URL(c.req.url);
      const limit = parsePositiveInt(requestUrl.searchParams.get("limit"), 100);
      return c.json(success(await (await getStore()).listActivationCodes(limit)));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/api/admin/codes", async (c) => {
    const store = await creatorStorePromise;
    try {
      requireAdmin(c, adminSessions);
      const body = await readJsonBody(c);
      const code = asString(body.code);
      if (!code) throw new DouyinServiceError("UNSUPPORTED_CONTENT", "activation code is required", 400);
      const info = await (await getStore()).createActivationCode({
        code,
        plan_id: asString(body.plan_id) ?? "standard",
        max_uses: body.max_uses as number | undefined,
        expires_at: (body.expires_at as string | number | null | undefined) ?? null,
      });
      await store.recordAudit({ actor: "admin", action: "activation_code_create", ip: getClientIp(c), detail: JSON.stringify({ code: info.code, plan_id: info.plan_id }) });
      return c.json(success(info));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/favicon.svg", (c) =>
    c.body(FAVICON_SVG, 200, {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=86400",
    }),
  );

  app.get("/favicon.ico", (c) =>
    c.body(FAVICON_SVG, 200, {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=86400",
    }),
  );

  app.get("/healthz", (c) => c.json({ ok: true, code: "OK", message: "healthy" }));

  return app;
}

async function handleCompat(
  requestUrl: string,
  parseForRequest: (inputUrl: string) => Promise<ParsedDouyinInfo>,
  hooks: { before?: () => void | Promise<void>; after?: (status: number, detail: string | null) => void | Promise<void> } = {},
): Promise<Response> {
  const url = new URL(requestUrl);
  const inputUrl = url.searchParams.get("url");
  if (!inputUrl) {
    await hooks.after?.(400, "missing url");
    return new Response("请提供url参数", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  try {
    await hooks.before?.();
    const parsed = await parseForRequest(inputUrl);
    if (url.searchParams.has("data")) {
      await hooks.after?.(200, JSON.stringify({ aweme_id: parsed.source.aweme_id, mode: "data", type: parsed.media.type }));
      return new Response(JSON.stringify(parsed.compat), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    if (!parsed.media.video_url) {
      throw new DouyinServiceError("UNSUPPORTED_CONTENT", "video_url is not available for image content");
    }

    await hooks.after?.(200, JSON.stringify({ aweme_id: parsed.source.aweme_id, mode: "text", type: parsed.media.type }));
    return new Response(parsed.media.video_url, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  } catch (error) {
    const serviceError = toServiceError(error);
    await hooks.after?.(serviceError.status, serviceError.message);
    return new Response(serviceError.message, {
      status: serviceError.status,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

function decorateParsedInfo(parsed: ParsedDouyinInfo, requestUrl: string): ParsedDouyinInfo {
  const copy = JSON.parse(JSON.stringify(parsed)) as ParsedDouyinInfo;
  if (!copy.media.video_url) return copy;
  const filename = copy.download.filename ?? buildFilename(copy);
  copy.download.filename = filename;
  copy.download.video_proxy_url = makeRouteUrl(requestUrl, "/api/v1/media", { url: copy.media.video_url, filename });
  copy.download.download_url = makeRouteUrl(requestUrl, "/api/v1/download", { url: copy.media.video_url, filename });
  return copy;
}

function parsedFromBatchItem(task: BatchTask, item: BatchItem): ParsedDouyinInfo {
  return {
    source: {
      input_url: `https://www.douyin.com/video/${item.aweme_id}`,
      resolved_url: task.homepage_url,
      aweme_id: item.aweme_id,
    },
    author: {
      nickname: item.author_nickname,
      signature: null,
    },
    stats: {
      comment_count: item.stats.comment_count,
      digg_count: item.stats.digg_count,
      share_count: item.stats.share_count,
      collect_count: item.stats.collect_count,
    },
    content: {
      desc: item.title,
      create_timestamp: null,
      created_at: null,
    },
    media: {
      type: item.video_url ? "video" : "unknown",
      video_url: item.video_url,
      cover_url: item.cover_url,
      image_url_list: [],
    },
    music: {
      title: item.music_title,
      author: item.music_author,
      cover_url: null,
      play_url: null,
    },
    download: {
      video_proxy_url: null,
      download_url: item.download_url,
      filename: `douyin-${item.aweme_id}.mp4`,
    },
    compat: {
      aweme_id: item.aweme_id,
      comment_count: item.stats.comment_count,
      digg_count: item.stats.digg_count,
      share_count: item.stats.share_count,
      collect_count: item.stats.collect_count,
      nickname: item.author_nickname,
      signature: null,
      desc: item.title,
      create_time: null,
      video_url: item.video_url,
      cover_url: item.cover_url,
      music_title: item.music_title,
      music_author: item.music_author,
      type: item.video_url ? "video" : null,
      image_url_list: [],
    },
  };
}

function profilePreviewItem(awemeId: string, parsed: ParsedDouyinInfo) {
  return {
    aweme_id: awemeId,
    status: "success",
    page_url: `https://www.douyin.com/video/${awemeId}`,
    title: parsed.content.desc,
    author_nickname: parsed.author.nickname,
    cover_url: parsed.media.cover_url,
    video_url: parsed.download.video_proxy_url ?? parsed.media.video_url,
    download_url: parsed.download.download_url ?? parsed.media.video_url,
    music_title: parsed.music.title,
    stats: { ...parsed.stats },
    error: null,
  };
}

function adminTaskSummary(task: BatchTask) {
  return {
    id: task.id,
    homepage_url: task.homepage_url,
    owner_key: task.owner_key,
    requested_count: task.requested_count,
    concurrency: task.concurrency,
    queue_priority: task.queue_priority,
    queue_position: task.queue_position,
    total_detected: task.total_detected,
    status: task.status,
    created_at: task.created_at,
    updated_at: task.updated_at,
    started_at: task.started_at,
    finished_at: task.finished_at,
    completed_count: task.completed_count,
    success_count: task.success_count,
    failed_count: task.failed_count,
    progress_percent: task.requested_count ? Math.round((task.completed_count / task.requested_count) * 100) : 0,
    items_preview: task.items.slice(0, 20).map((item) => ({
      aweme_id: item.aweme_id,
      status: item.status,
      title: item.title,
      cover_url: item.cover_url,
      download_url: item.download_url,
      error: item.error,
    })),
  };
}

function normalizeCommentImportPayload(body: Record<string, unknown>): Array<{ aweme_id: string; comments: BatchComment[] }> {
  const items = Array.isArray(body.items)
    ? body.items
    : asString(body.aweme_id)
      ? [{ aweme_id: body.aweme_id, comments: body.comments }]
      : [];
  return items
    .map((value) => {
      if (!value || typeof value !== "object") return null;
      const record = value as Record<string, unknown>;
      const awemeId = asString(record.aweme_id);
      if (!awemeId) return null;
      const comments = Array.isArray(record.comments) ? record.comments.map(normalizeCommentInput).filter(isPresent) : [];
      return { aweme_id: awemeId, comments };
    })
    .filter(isPresent);
}

function normalizeCommentInput(value: unknown): BatchComment | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const text = asString(record.text);
  if (!text) return null;
  return {
    cid: asString(record.cid) ?? randomId(),
    nickname: asString(record.nickname),
    text,
    digg_count: typeof record.digg_count === "number" && Number.isFinite(record.digg_count) ? record.digg_count : null,
    create_time: asString(record.create_time),
  };
}

function readAwemeIdSet(value: unknown): Set<string> {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return new Set(
    values
      .map((item) => (typeof item === "string" || typeof item === "number" ? String(item).trim() : ""))
      .filter((item) => /^\d{10,}$/.test(item)),
  );
}

function mergeComments(existing: BatchComment[], incoming: BatchComment[]): BatchComment[] {
  const merged = new Map(existing.map((comment) => [comment.cid, comment]));
  for (const comment of incoming) merged.set(comment.cid, comment);
  return [...merged.values()];
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function batchExportResponse(task: BatchTask, type: string): Response {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (type === "scripts") {
    const lines = task.items
      .filter((item) => item.ai_copy)
      .map((item, index) =>
        [
          `# ${index + 1}. ${item.ai_copy?.title ?? item.title ?? item.aweme_id}`,
          `aweme_id: ${item.aweme_id}`,
          `title: ${item.ai_copy?.title ?? ""}`,
          "",
          item.ai_copy?.rewritten_script ?? "",
          "",
          `description: ${item.ai_copy?.description ?? ""}`,
          `tags: ${(item.ai_copy?.tags ?? []).map((tag) => `#${tag}`).join(" ")}`,
          "",
        ].join("\n"),
      )
      .join("\n---\n");
    return new Response(lines || "No AI scripts generated yet.", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="batch-${task.id}-scripts-${timestamp}.txt"`,
      },
    });
  }
  if (type === "covers") {
    return jsonAttachment(
      {
        task_id: task.id,
        homepage_url: task.homepage_url,
        covers: task.items.filter((item) => item.cover_url).map((item) => ({ aweme_id: item.aweme_id, title: item.title, cover_url: item.cover_url })),
      },
      `batch-${task.id}-covers-${timestamp}.json`,
    );
  }
  if (type === "comments") {
    return jsonAttachment(
      {
        task_id: task.id,
        homepage_url: task.homepage_url,
        note: "comments are exported from collected task data; empty arrays mean no comment source has been collected for that item yet",
        comments: task.items.map((item) => ({ aweme_id: item.aweme_id, title: item.title, comments: item.comments })),
      },
      `batch-${task.id}-comments-${timestamp}.json`,
    );
  }
  return jsonAttachment(
    {
      task_id: task.id,
      homepage_url: task.homepage_url,
      status: task.status,
      requested_count: task.requested_count,
      completed_count: task.completed_count,
      success_count: task.success_count,
      failed_count: task.failed_count,
      items: task.items.map((item) => ({
        aweme_id: item.aweme_id,
        status: item.status,
        title: item.title,
        author_nickname: item.author_nickname,
        cover_url: item.cover_url,
        video_url: item.video_url,
        download_url: item.download_url,
        music_title: item.music_title,
        music_author: item.music_author,
        stats: item.stats,
        ai_copy: item.ai_copy,
        comments: item.comments,
        error: item.error,
      })),
    },
    `batch-${task.id}-full-${timestamp}.json`,
  );
}

function jsonAttachment(value: unknown, filename: string): Response {
  return new Response(JSON.stringify(value, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

function buildFilename(parsed: ParsedDouyinInfo): string {
  return `douyin-${parsed.source.aweme_id ?? "video"}.mp4`;
}

function makeRouteUrl(requestUrl: string, pathname: string, params: Record<string, string | null | undefined>): string {
  const url = new URL(requestUrl);
  url.pathname = pathname;
  url.search = "";
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

function getPublicRequestUrl(c: Context): string {
  const url = new URL(c.req.url);
  const forwardedProto = firstForwardedHeader(c.req.header("x-forwarded-proto"));
  const forwardedHost = firstForwardedHeader(c.req.header("x-forwarded-host"));
  const host = forwardedHost ?? c.req.header("host");
  if (forwardedProto && /^[a-z][a-z0-9+.-]*$/i.test(forwardedProto)) url.protocol = `${forwardedProto}:`;
  if (host) url.host = host;
  return url.toString();
}

function firstForwardedHeader(value: string | undefined): string | null {
  const first = value?.split(",")[0]?.trim();
  return first || null;
}

function success<T>(data: T): ApiSuccessResponse<T> {
  return { ok: true, code: "OK", message: "success", data };
}

function jsonError(c: Context, error: unknown): Response {
  const serviceError = toServiceError(error);
  return c.json(makeErrorResponse(serviceError), serviceError.status as ContentfulStatusCode);
}

async function readJsonBody(c: Context): Promise<Record<string, unknown>> {
  const text = await c.req.text();
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new DouyinServiceError("PARSE_FAILED", `invalid json body: ${detail}`, 400);
  }
}

async function requireVip(c: Context, store: VipStore): Promise<VipSession | MemberSession> {
  const session = await store.verify(readVipToken(c.req.raw));
  if (!session) throw new DouyinServiceError("UNSUPPORTED_CONTENT", "membership activation is required for batch parsing", 403);
  return session;
}

function isMemberSession(session: VipSession | MemberSession | null | undefined): session is MemberSession {
  return Boolean(session && "user_id" in session && "plan" in session);
}

function memberSessionPayload(session: MemberSession) {
  return {
    activated: true,
    token: session.token,
    code: session.code,
    expires_at: new Date(session.expires_at).toISOString(),
    member: {
      user_id: session.user_id,
      username: session.username,
      plan: session.plan,
    },
    permissions: permissionsForSession(session),
  };
}

function permissionsForSession(session: VipSession | MemberSession | null | undefined) {
  if (isMemberSession(session)) {
    return {
      batch_parse_limit: session.plan.batch_parse_limit,
      batch_ai_limit: session.plan.batch_ai_limit,
      ai_daily_quota: session.plan.ai_daily_quota,
      comment_export: session.plan.comment_export,
      cover_batch_download: session.plan.cover_batch_download,
      concurrency: session.plan.concurrency,
      queue_priority: session.plan.queue_priority,
    };
  }
  if (session) {
    return {
      batch_parse_limit: 50,
      batch_ai_limit: 30,
      ai_daily_quota: 30,
      comment_export: true,
      cover_batch_download: true,
      concurrency: 3,
      queue_priority: 40,
    };
  }
  return {
    batch_parse_limit: 1,
    batch_ai_limit: 0,
    ai_daily_quota: 0,
    comment_export: false,
    cover_batch_download: false,
    concurrency: 1,
    queue_priority: 0,
  };
}

function getBatchParseLimit(session: VipSession | MemberSession): number {
  return permissionsForSession(session).batch_parse_limit;
}

function getConcurrencyLimit(session: VipSession | MemberSession): number {
  return permissionsForSession(session).concurrency;
}

function getAiDailyQuota(session: VipSession | MemberSession): number {
  return permissionsForSession(session).ai_daily_quota;
}

function getBatchAiLimit(session: VipSession | MemberSession): number {
  return permissionsForSession(session).batch_ai_limit;
}

function readVipToken(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim();
  if (bearer) return bearer;
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === "vip_token") return decodeURIComponent(rawValue.join("="));
  }
  return null;
}

function requireAdmin(c: Context, sessions: Map<string, number>): void {
  const envToken = getRuntimeEnv().ADMIN_TOKEN;
  const token = readAdminToken(c.req.raw);
  if (envToken && token === envToken) return;
  if (token) {
    const expiresAt = sessions.get(token);
    if (expiresAt && expiresAt > Date.now()) return;
    if (expiresAt) sessions.delete(token);
  }
  throw new DouyinServiceError("UNSUPPORTED_CONTENT", "admin login is required", 403);
}

function readAdminToken(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim();
  if (bearer) return bearer;
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === "admin_token") return decodeURIComponent(rawValue.join("="));
  }
  return null;
}

function buildVipCookie(token: string, maxAge: number, requestUrl: string): string {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `vip_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function clearVipCookie(requestUrl: string): string {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `vip_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function buildAdminCookie(token: string, maxAge: number, requestUrl: string): string {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `admin_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function getClientIp(c: Context): string {
  return firstForwardedHeader(c.req.header("x-forwarded-for")) ?? c.req.header("x-real-ip") ?? "0.0.0.0";
}

function securityDenyReason(c: Context, settings: SecuritySettings): string | null {
  const ip = getClientIp(c);
  if (settings.blocked_ips.includes(ip)) return "blocked_ip";
  const userAgent = c.req.header("user-agent")?.trim() ?? "";
  if (settings.block_empty_user_agent && !userAgent) return "empty_user_agent";
  const allowedHosts = settings.allowed_origin_hosts.map((host) => host.toLowerCase()).filter(Boolean);
  if (!allowedHosts.length) return null;
  const originHost = headerUrlHost(c.req.header("origin"));
  const refererHost = headerUrlHost(c.req.header("referer"));
  if (!originHost && !refererHost) return settings.require_browser_headers ? "missing_origin_or_referer" : null;
  if ((originHost && isAllowedOriginHost(originHost, allowedHosts)) || (refererHost && isAllowedOriginHost(refererHost, allowedHosts))) return null;
  return "origin_or_referer_not_allowed";
}

function headerUrlHost(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isAllowedOriginHost(host: string, allowedHosts: string[]): boolean {
  const normalized = host.toLowerCase();
  return allowedHosts.some((allowed) => normalized === allowed || (allowed.startsWith("*.") && normalized.endsWith(allowed.slice(1))));
}

function enforceRateLimit(buckets: Map<string, { resetAt: number; count: number }>, key: string, limit: number, windowMs: number, cost = 1): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { resetAt: now + windowMs, count: cost });
    if (cost > limit) {
      throw new DouyinServiceError("UNSUPPORTED_CONTENT", "rate limit exceeded, please wait and retry", 429);
    }
    return;
  }
  bucket.count += cost;
  if (bucket.count > limit) {
    throw new DouyinServiceError("UNSUPPORTED_CONTENT", "rate limit exceeded, please wait and retry", 429);
  }
}

async function verifyTotpCode(secret: string, code: string | null): Promise<boolean> {
  if (!/^\d{6}$/.test(code ?? "")) return false;
  const nowStep = Math.floor(Date.now() / 30_000);
  for (const offset of [-1, 0, 1]) {
    if ((await generateTotpCode(secret, nowStep + offset)) === code) return true;
  }
  return false;
}

async function generateTotpCode(secret: string, step: number): Promise<string> {
  const key = base32Decode(secret);
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(step));
  const crypto = await import("node:crypto");
  const hmac = crypto.createHmac("sha1", Buffer.from(key));
  hmac.update(Buffer.from(counter));
  const digest = hmac.digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function base32Decode(input: string): Uint8Array {
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
  return new Uint8Array(bytes);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeUsageUrlDetail(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return JSON.stringify({ host: url.hostname, pathname: url.pathname.slice(0, 96) });
  } catch {
    return "invalid url";
  }
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function randomId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getRuntimeEnv(): Record<string, string | undefined> {
  return ((globalThis as any).process?.env ?? {}) as Record<string, string | undefined>;
}

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
<defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#25f4ee"/><stop offset="1" stop-color="#fe2c55"/></linearGradient></defs>
<rect width="96" height="96" rx="24" fill="#050506"/>
<path d="M58 18v38.5c0 13.8-10.3 22-22.2 22C25.2 78.5 17 72 17 62.7c0-9.9 8.6-16.1 18.9-16.1 2.3 0 4.4.3 6.1 1V18h16z" fill="url(#g)"/>
<path d="M58 20c4.4 10.7 12.4 17.3 22 18.3v14.3c-8.4-.2-15.6-3.1-22-8.6V20z" fill="#fff" opacity=".9"/>
</svg>`;

const app = createApp();

export default app;
