import { DouyinServiceError } from "./errors.ts";

const MEDIA_ALLOWED_HOSTS = ["douyinvod.com", "douyinpic.com", "byteimg.com", "pstatp.com", "snssdk.com", "amemv.com"];
const MEDIA_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

export type MediaDisposition = "inline" | "attachment";

export async function proxyMediaUrl(inputUrl: string, request: Request, disposition: MediaDisposition, filename?: string | null): Promise<Response> {
  const target = normalizeMediaUrl(inputUrl);
  const upstreamHeaders: Record<string, string> = {
    "User-Agent": MEDIA_USER_AGENT,
    Accept: "video/mp4,video/*,image/*,*/*",
    Referer: "https://www.douyin.com/",
  };
  const range = request.headers.get("range");
  if (range) upstreamHeaders.Range = range;

  const upstream = await fetch(target.toString(), {
    method: "GET",
    headers: upstreamHeaders,
    redirect: "follow",
  });

  const headers = new Headers();
  copyHeader(upstream.headers, headers, "content-type");
  copyHeader(upstream.headers, headers, "content-length");
  copyHeader(upstream.headers, headers, "content-range");
  copyHeader(upstream.headers, headers, "accept-ranges");
  copyHeader(upstream.headers, headers, "cache-control");
  headers.set("access-control-allow-origin", "*");
  headers.set("cross-origin-resource-policy", "cross-origin");
  if (disposition === "attachment") {
    headers.set("content-disposition", buildContentDisposition(filename ?? "douyin-video.mp4"));
  } else {
    headers.set("content-disposition", "inline");
  }

  if (!upstream.ok && upstream.status !== 206) {
    throw new DouyinServiceError("FETCH_FAILED", `media upstream status ${upstream.status}`);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export function normalizeMediaUrl(inputUrl: string): URL {
  let target: URL;
  try {
    target = new URL(inputUrl);
  } catch {
    throw new DouyinServiceError("INVALID_URL", "invalid media url");
  }
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new DouyinServiceError("INVALID_URL", "media url must be http(s)");
  }
  const host = target.hostname.toLowerCase();
  if (!MEDIA_ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
    throw new DouyinServiceError("INVALID_URL", `unsupported media host: ${target.hostname}`);
  }
  if (/playwm|watermark=1|logo_name=/i.test(target.toString())) {
    throw new DouyinServiceError("PARSE_FAILED", "media url contains watermark marker");
  }
  return target;
}

function copyHeader(from: Headers, to: Headers, key: string): void {
  const value = from.get(key);
  if (value) to.set(key, value);
}

function buildContentDisposition(filename: string): string {
  const safe = filename.replace(/[\\/\r\n"]/g, "_").slice(0, 120) || "douyin-video.mp4";
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
