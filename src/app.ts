import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  DouyinServiceError,
  getBatchTask,
  getVipStore,
  inspectBatchHomepage,
  makeErrorResponse,
  parseDouyinUrl,
  proxyMediaUrl,
  startBatchTask,
  toServiceError,
} from "./core/index.ts";
import type { ApiSuccessResponse, FetchLike, ParseOptions, ParsedDouyinInfo, VipStore } from "./core/index.ts";
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
      const parsed = decorateParsedInfo(await parseForRequest(inputUrl), c.req.url);
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
      c.header("set-cookie", buildVipCookie(session.token, maxAge, c.req.url));
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
      const task = await startBatchTask({
        homepageUrl,
        count,
        concurrency,
        parseOptions: parserOptions,
        parseByAwemeId: async (awemeId) => parseForRequest(`https://www.douyin.com/video/${awemeId}`),
        makeDownloadUrl: (parsed) => decorateParsedInfo(parsed, c.req.url).download.download_url,
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

async function requireVip(c: Context, store: VipStore): Promise<void> {
  const session = await store.verify(readVipToken(c.req.raw));
  if (!session) throw new DouyinServiceError("UNSUPPORTED_CONTENT", "membership activation is required for batch parsing", 403);
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

function buildVipCookie(token: string, maxAge: number, requestUrl: string): string {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `vip_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
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

const app = createApp();

export default app;
