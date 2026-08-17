import { DouyinServiceError } from "./errors.ts";
import type { FetchLike, ParseOptions } from "./types.ts";

const PROFILE_ALLOWED_HOSTS = ["douyin.com", "iesdouyin.com", "amemv.com"];
const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";

export interface ProfileInspectResult {
  input_url: string;
  resolved_url: string;
  sec_user_id: string | null;
  total_count: number | null;
  available_count: number;
  aweme_ids: string[];
}

export async function inspectDouyinProfile(input: string, options: ParseOptions = {}): Promise<ProfileInspectResult> {
  const normalizedUrl = normalizeProfileInput(input);
  const page = await fetchProfileText(normalizedUrl, options);
  const secUserId = extractSecUserId(page.url) ?? extractSecUserId(page.text);
  const htmlIds = extractAwemeIds(page.text);
  const totalFromHtml = extractTotalCount(page.text);
  let apiIds: string[] = [];
  let apiTotal: number | null = null;

  if (secUserId) {
    try {
      const api = await fetchProfilePostList(secUserId, options);
      apiIds = api.awemeIds;
      apiTotal = api.totalCount;
    } catch {
      // HTML extraction is kept as fallback. The caller receives a clear error only when no ids/count can be found.
    }
  }

  const awemeIds = unique([...apiIds, ...htmlIds]);
  const totalCount = apiTotal ?? totalFromHtml ?? (awemeIds.length > 0 ? awemeIds.length : null);
  if (!secUserId && awemeIds.length === 0 && totalCount === null) {
    throw new DouyinServiceError("PARSE_FAILED", "profile page did not expose sec_user_id or aweme ids");
  }

  return {
    input_url: input,
    resolved_url: page.url,
    sec_user_id: secUserId,
    total_count: totalCount,
    available_count: awemeIds.length,
    aweme_ids: awemeIds,
  };
}

async function fetchProfileText(url: string, options: ParseOptions): Promise<{ text: string; url: string }> {
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (!fetcher) throw new DouyinServiceError("FETCH_FAILED", "fetch is not available");
  const response = await fetcher(url, {
    headers: {
      "User-Agent": options.userAgent ?? DESKTOP_USER_AGENT,
      Accept: "text/html,application/xhtml+xml,*/*",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
    redirect: "follow",
  });
  if (!response.ok) throw new DouyinServiceError("FETCH_FAILED", `profile upstream status ${response.status}`);
  return { text: await response.text(), url: response.url || url };
}

async function fetchProfilePostList(secUserId: string, options: ParseOptions): Promise<{ awemeIds: string[]; totalCount: number | null }> {
  const fetcher: FetchLike = options.fetcher ?? globalThis.fetch;
  if (!fetcher) throw new DouyinServiceError("FETCH_FAILED", "fetch is not available");
  const endpoint = new URL("https://www.douyin.com/aweme/v1/web/aweme/post/");
  endpoint.searchParams.set("device_platform", "webapp");
  endpoint.searchParams.set("aid", "6383");
  endpoint.searchParams.set("channel", "channel_pc_web");
  endpoint.searchParams.set("sec_user_id", secUserId);
  endpoint.searchParams.set("max_cursor", "0");
  endpoint.searchParams.set("locate_query", "false");
  endpoint.searchParams.set("show_live_replay_strategy", "1");
  endpoint.searchParams.set("count", "20");
  endpoint.searchParams.set("publish_video_strategy_type", "2");
  endpoint.searchParams.set("pc_client_type", "1");
  endpoint.searchParams.set("version_code", "170400");
  endpoint.searchParams.set("version_name", "17.4.0");
  endpoint.searchParams.set("cookie_enabled", "true");
  endpoint.searchParams.set("screen_width", "1365");
  endpoint.searchParams.set("screen_height", "768");
  endpoint.searchParams.set("browser_language", "zh-CN");
  endpoint.searchParams.set("browser_platform", "Win32");
  endpoint.searchParams.set("browser_name", "Chrome");
  endpoint.searchParams.set("browser_version", "130.0.0.0");
  endpoint.searchParams.set("browser_online", "true");
  endpoint.searchParams.set("engine_name", "Blink");
  endpoint.searchParams.set("engine_version", "130.0.0.0");
  endpoint.searchParams.set("os_name", "Windows");
  endpoint.searchParams.set("os_version", "10");

  const response = await fetcher(endpoint.toString(), {
    headers: {
      "User-Agent": DESKTOP_USER_AGENT,
      Accept: "application/json,text/plain,*/*",
      Referer: `https://www.douyin.com/user/${encodeURIComponent(secUserId)}`,
    },
    redirect: "follow",
  });
  if (!response.ok) throw new DouyinServiceError("FETCH_FAILED", `profile post api status ${response.status}`);
  const text = await response.text();
  const data = JSON.parse(text) as unknown;
  const ids = extractAwemeIds(JSON.stringify(data));
  const total = readNumber(data, ["total"]) ?? readNumber(data, ["max_count"]);
  return { awemeIds: ids, totalCount: total };
}

function normalizeProfileInput(input: string): string {
  const match = input.trim().match(/https?:\/\/[^\s"'<>??????]+/i);
  const raw = match?.[0] ?? input.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DouyinServiceError("INVALID_URL", "invalid profile url");
  }
  const host = url.hostname.toLowerCase();
  if (!PROFILE_ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
    throw new DouyinServiceError("INVALID_URL", `unsupported profile host: ${url.hostname}`);
  }
  return url.toString();
}

function extractSecUserId(text: string): string | null {
  const patterns = [
    /\/user\/([^/?#]+)/,
    /\/share\/user\/([^/?#]+)/,
    /"sec_uid"\s*:\s*"([^"]+)"/,
    /"secUid"\s*:\s*"([^"]+)"/,
    /sec_user_id=([^&#"]+)/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return decodeURIComponent(match[1]).replace(/\\u002F/g, "/");
  }
  return null;
}

function extractAwemeIds(text: string): string[] {
  const ids: string[] = [];
  const patterns = [/"aweme_id"\s*:\s*"(\d{10,})"/g, /"awemeId"\s*:\s*"(\d{10,})"/g, /\/video\/(\d{10,})/g, /\/note\/(\d{10,})/g];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (match[1] && !ids.includes(match[1])) ids.push(match[1]);
    }
  }
  return ids;
}

function extractTotalCount(text: string): number | null {
  const patterns = [
    /"aweme_count"\s*:\s*(\d+)/,
    /"awemeCount"\s*:\s*(\d+)/,
    /"total"\s*:\s*(\d+)/,
    /作品\s*(\d+)/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return Number(match[1]);
  }
  return null;
}

function readNumber(value: unknown, path: string[]): number | null {
  let cursor = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return null;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === "number" && Number.isFinite(cursor) ? cursor : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
