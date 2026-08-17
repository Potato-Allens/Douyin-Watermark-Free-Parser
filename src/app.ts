import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { DouyinServiceError, makeErrorResponse, parseDouyinUrl, toServiceError } from "./core/index.ts";
import type { ApiSuccessResponse, FetchLike, ParseOptions, ParsedDouyinInfo } from "./core/index.ts";

export interface CreateAppOptions {
  parserOptions?: ParseOptions;
  fetcher?: FetchLike;
  cacheTtlMs?: number;
}

export function createApp(options: CreateAppOptions = {}) {
  const app = new Hono();

  const parserOptions: ParseOptions = {
    ...options.parserOptions,
    fetcher: options.fetcher ?? options.parserOptions?.fetcher,
  };
  const cache = new Map<string, { expiresAt: number; value: ParsedDouyinInfo }>();
  const cacheTtlMs = options.cacheTtlMs ?? 60_000;
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

  app.get("/", async (c) => {
    return handleCompat(c.req.url, parseForRequest);
  });

  app.get("/api/hello", async (c) => {
    return handleCompat(c.req.url, parseForRequest);
  });

  app.get("/api/v1/parse", async (c) => {
    const requestUrl = new URL(c.req.url);
    const inputUrl = requestUrl.searchParams.get("url");

    if (!inputUrl) {
      return c.json(makeErrorResponse(new DouyinServiceError("MISSING_URL")), 400);
    }

    try {
      const parsed = await parseForRequest(inputUrl);
      const response: ApiSuccessResponse<ParsedDouyinInfo> = {
        ok: true,
        code: "OK",
        message: "success",
        data: parsed,
      };
      return c.json(response);
    } catch (error) {
      const serviceError = toServiceError(error);
      return c.json(makeErrorResponse(serviceError), serviceError.status as ContentfulStatusCode);
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

const app = createApp();

export default app;
