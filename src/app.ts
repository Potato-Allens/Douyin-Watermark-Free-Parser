import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  DouyinServiceError,
  generateAiCopy,
  getBatchTask,
  getCreatorStore,
  getVipStore,
  inspectBatchHomepage,
  makeErrorResponse,
  parseDouyinUrl,
  proxyMediaUrl,
  startBatchTask,
  testLlmSettings,
  toServiceError,
} from "./core/index.ts";
import type { ApiSuccessResponse, FetchLike, ParseOptions, ParsedDouyinInfo, VipSession, VipStore } from "./core/index.ts";
import { renderHomePage } from "./ui.ts";

export interface CreateAppOptions {
  parserOptions?: ParseOptions;
  fetcher?: FetchLike;
  cacheTtlMs?: number;
  vipStore?: VipStore;
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
  const creatorStorePromise = getCreatorStore();
  const adminSessions = new Map<string, number>();
  const rateBuckets = new Map<string, { resetAt: number; count: number }>();

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
    return handleCompat(c.req.url, parseForRequest);
  });

  app.get("/api/hello", async (c) => {
    return handleCompat(c.req.url, parseForRequest);
  });

  app.get("/api/v1/parse", async (c) => {
    const requestUrl = new URL(c.req.url);
    const inputUrl = requestUrl.searchParams.get("url");
    if (!inputUrl) return c.json(makeErrorResponse(new DouyinServiceError("MISSING_URL")), 400);

    try {
      const parsed = decorateParsedInfo(await parseForRequest(inputUrl), getPublicRequestUrl(c));
      return c.json(success(parsed));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/api/v1/media", async (c) => {
    const requestUrl = new URL(c.req.url);
    const mediaUrl = requestUrl.searchParams.get("url");
    if (!mediaUrl) return c.json(makeErrorResponse(new DouyinServiceError("MISSING_URL")), 400);
    try {
      return await proxyMediaUrl(mediaUrl, c.req.raw, "inline", requestUrl.searchParams.get("filename"));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/api/v1/download", async (c) => {
    const requestUrl = new URL(c.req.url);
    const mediaUrl = requestUrl.searchParams.get("url");
    if (!mediaUrl) return c.json(makeErrorResponse(new DouyinServiceError("MISSING_URL")), 400);
    try {
      return await proxyMediaUrl(mediaUrl, c.req.raw, "attachment", requestUrl.searchParams.get("filename"));
    } catch (error) {
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
        }),
      );
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/api/v1/batch/inspect", async (c) => {
    try {
      await requireVip(c, await getStore());
      const body = await readJsonBody(c);
      const homepageUrl = asString(body.url) ?? asString(body.homepage_url);
      if (!homepageUrl) throw new DouyinServiceError("MISSING_URL");
      const data = await inspectBatchHomepage(homepageUrl, parserOptions);
      return c.json(success(data));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/api/v1/batch/start", async (c) => {
    try {
      await requireVip(c, await getStore());
      const body = await readJsonBody(c);
      const homepageUrl = asString(body.url) ?? asString(body.homepage_url);
      if (!homepageUrl) throw new DouyinServiceError("MISSING_URL");
      const count = parsePositiveInt(body.count, 1);
      const concurrency = parsePositiveInt(body.concurrency, 3);
      const publicRequestUrl = getPublicRequestUrl(c);
      const task = await startBatchTask({
        homepageUrl,
        count,
        concurrency,
        parseOptions: parserOptions,
        parseByAwemeId: async (awemeId) => parseForRequest(`https://www.douyin.com/video/${awemeId}`),
        makeDownloadUrl: (parsed) => decorateParsedInfo(parsed, publicRequestUrl).download.download_url,
      });
      return c.json(success(task));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/api/v1/batch/:id", async (c) => {
    try {
      await requireVip(c, await getStore());
      const task = getBatchTask(c.req.param("id"));
      if (!task) throw new DouyinServiceError("PARSE_FAILED", "batch task not found", 404);
      return c.json(success(task));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/api/v1/ai/script", async (c) => {
    const store = await creatorStorePromise;
    try {
      const session = await requireVip(c, await getStore());
      enforceRateLimit(rateBuckets, `ai:${session.code}:${getClientIp(c)}`, 30, 60 * 60 * 1000);
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
    try {
      await requireVip(c, await getStore());
      const requestUrl = new URL(c.req.url);
      const awemeId = requestUrl.searchParams.get("aweme_id");
      const inputUrl = requestUrl.searchParams.get("url");
      return c.json(
        success({
          aweme_id: awemeId ?? null,
          input_url: inputUrl ?? null,
          comments: [],
          next_cursor: null,
          note: "评论采集队列接口已预留，后续接入真实评论源后会写入批量任务导出。",
        }),
      );
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/api/admin/login", async (c) => {
    const store = await creatorStorePromise;
    try {
      const body = await readJsonBody(c);
      const username = asString(body.username);
      const password = asString(body.password);
      const totp = asString(body.totp);
      const env = getRuntimeEnv();
      const expectedUser = env.ADMIN_USERNAME ?? "admin";
      const expectedPassword = env.ADMIN_PASSWORD ?? "admin-change-me";
      if (username !== expectedUser || password !== expectedPassword) {
        throw new DouyinServiceError("UNSUPPORTED_CONTENT", "admin credentials are invalid", 403);
      }
      if (env.ADMIN_TOTP_SECRET && !(await verifyTotpCode(env.ADMIN_TOTP_SECRET, totp))) {
        throw new DouyinServiceError("UNSUPPORTED_CONTENT", "admin totp code is invalid", 403);
      }
      const token = randomId();
      const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
      adminSessions.set(token, expiresAt);
      c.header("set-cookie", buildAdminCookie(token, 8 * 60 * 60, getPublicRequestUrl(c)));
      await store.recordAudit({ actor: username, action: "admin_login", ip: getClientIp(c), detail: "success" });
      return c.json(success({ token, expires_at: new Date(expiresAt).toISOString(), totp_enabled: Boolean(env.ADMIN_TOTP_SECRET) }));
    } catch (error) {
      await store.recordAudit({ actor: "admin", action: "admin_login_failed", ip: getClientIp(c), detail: error instanceof Error ? error.message : String(error) });
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

  app.get("/api/admin/metrics", async (c) => {
    try {
      requireAdmin(c, adminSessions);
      return c.json(success({ ...(await (await creatorStorePromise).getMetrics()), online: onlineStats() }));
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

  app.get("/healthz", (c) => c.json({ ok: true, code: "OK", message: "healthy" }));

  return app;
}

async function handleCompat(requestUrl: string, parseForRequest: (inputUrl: string) => Promise<ParsedDouyinInfo>): Promise<Response> {
  const url = new URL(requestUrl);
  const inputUrl = url.searchParams.get("url");
  if (!inputUrl) {
    return new Response("请提供url参数", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  try {
    const parsed = await parseForRequest(inputUrl);
    if (url.searchParams.has("data")) {
      return new Response(JSON.stringify(parsed.compat), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    if (!parsed.media.video_url) {
      throw new DouyinServiceError("UNSUPPORTED_CONTENT", "video_url is not available for image content");
    }

    return new Response(parsed.media.video_url, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  } catch (error) {
    const serviceError = toServiceError(error);
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

async function requireVip(c: Context, store: VipStore): Promise<VipSession> {
  const session = await store.verify(readVipToken(c.req.raw));
  if (!session) throw new DouyinServiceError("UNSUPPORTED_CONTENT", "membership activation is required for batch parsing", 403);
  return session;
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

function buildAdminCookie(token: string, maxAge: number, requestUrl: string): string {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `admin_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function getClientIp(c: Context): string {
  return firstForwardedHeader(c.req.header("x-forwarded-for")) ?? c.req.header("x-real-ip") ?? "0.0.0.0";
}

function enforceRateLimit(buckets: Map<string, { resetAt: number; count: number }>, key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { resetAt: now + windowMs, count: 1 });
    return;
  }
  bucket.count += 1;
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
