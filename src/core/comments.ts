import { DouyinServiceError } from "./errors.ts";
import type { BatchComment } from "./batch.ts";
import type { FetchLike, ParseOptions } from "./types.ts";

const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";

export interface DouyinCommentFetchOptions extends ParseOptions {
  cursor?: number;
  count?: number;
}

export interface DouyinCommentFetchResult {
  aweme_id: string;
  source_url: string;
  cursor: number;
  next_cursor: number | null;
  has_more: boolean;
  total: number | null;
  comments: BatchComment[];
}

export async function fetchDouyinComments(awemeId: string, options: DouyinCommentFetchOptions = {}): Promise<DouyinCommentFetchResult> {
  const normalizedAwemeId = normalizeAwemeId(awemeId);
  const cursor = clamp(Math.floor(options.cursor ?? 0), 0, Number.MAX_SAFE_INTEGER);
  const count = clamp(Math.floor(options.count ?? 20), 1, 100);
  const endpoint = buildCommentListUrl(normalizedAwemeId, cursor, count);
  const fetcher: FetchLike = options.fetcher ?? globalThis.fetch;
  if (!fetcher) throw new DouyinServiceError("FETCH_FAILED", "fetch is not available");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    const response = await fetcher(endpoint, {
      method: "GET",
      headers: {
        "User-Agent": options.userAgent ?? DESKTOP_USER_AGENT,
        Accept: "application/json,text/plain,*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        Referer: `https://www.douyin.com/video/${normalizedAwemeId}`,
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) throw new DouyinServiceError("FETCH_FAILED", `comment api status ${response.status}`);
    const text = await response.text();
    if (!text.trim()) throw new DouyinServiceError("FETCH_FAILED", "comment api returned an empty body");
    let data: unknown;
    try {
      data = JSON.parse(text) as unknown;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new DouyinServiceError("PARSE_FAILED", `comment api returned non-json body: ${detail}`);
    }

    const statusCode = readNumber(data, ["status_code"]);
    if (statusCode !== null && statusCode !== 0) {
      const statusMsg = readString(data, ["status_msg"]) ?? "comment api returned non-zero status";
      throw new DouyinServiceError("FETCH_FAILED", `${statusCode}: ${statusMsg}`);
    }

    const comments = uniqueComments(readArray(data, ["comments"]).map(normalizeComment).filter(isPresent));
    const hasMore = Boolean(readBoolean(data, ["has_more"]) ?? readNumber(data, ["has_more"]));
    const returnedCursor = readNumber(data, ["cursor"]) ?? cursor + comments.length;
    return {
      aweme_id: normalizedAwemeId,
      source_url: endpoint,
      cursor,
      next_cursor: hasMore ? returnedCursor : null,
      has_more: hasMore,
      total: readNumber(data, ["total"]),
      comments,
    };
  } catch (error) {
    if (error instanceof DouyinServiceError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new DouyinServiceError("FETCH_FAILED", detail);
  } finally {
    clearTimeout(timer);
  }
}

function buildCommentListUrl(awemeId: string, cursor: number, count: number): string {
  const endpoint = new URL("https://www.douyin.com/aweme/v1/web/comment/list/");
  endpoint.searchParams.set("device_platform", "webapp");
  endpoint.searchParams.set("aid", "6383");
  endpoint.searchParams.set("channel", "channel_pc_web");
  endpoint.searchParams.set("aweme_id", awemeId);
  endpoint.searchParams.set("cursor", String(cursor));
  endpoint.searchParams.set("count", String(count));
  endpoint.searchParams.set("item_type", "0");
  endpoint.searchParams.set("insert_ids", "");
  endpoint.searchParams.set("whale_cut_token", "");
  endpoint.searchParams.set("cut_version", "1");
  endpoint.searchParams.set("rcFT", "");
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
  return endpoint.toString();
}

function normalizeAwemeId(value: string): string {
  const awemeId = value.trim();
  if (!/^\d{10,}$/.test(awemeId)) throw new DouyinServiceError("INVALID_URL", "aweme_id must be a numeric douyin video id");
  return awemeId;
}

function normalizeComment(value: unknown): BatchComment | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const text = readLooseString(record, "text") ?? readLooseString(record, "comment_text") ?? readLooseString(record, "content");
  if (!text) return null;
  const cid = readLooseString(record, "cid") ?? readLooseString(record, "comment_id") ?? readLooseString(record, "id");
  const user = typeof record.user === "object" && record.user ? (record.user as Record<string, unknown>) : null;
  const nickname = readLooseString(user, "nickname") ?? readLooseString(user, "unique_id") ?? readLooseString(user, "short_id");
  return {
    cid: cid ?? stableCommentId(text, nickname),
    nickname,
    text,
    digg_count: readLooseNumber(record, "digg_count") ?? readLooseNumber(record, "like_count"),
    create_time: normalizeCreateTime(readLooseNumber(record, "create_time") ?? readLooseString(record, "create_time")),
  };
}

function normalizeCreateTime(value: string | number | null): string | null {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    return new Date(milliseconds).toISOString();
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return normalizeCreateTime(numeric);
  return trimmed;
}

function stableCommentId(text: string, nickname: string | null): string {
  let hash = 0;
  const raw = `${nickname ?? ""}:${text}`;
  for (let index = 0; index < raw.length; index += 1) hash = (hash * 31 + raw.charCodeAt(index)) >>> 0;
  return `comment-${hash.toString(16)}`;
}

function uniqueComments(values: BatchComment[]): BatchComment[] {
  const map = new Map<string, BatchComment>();
  for (const value of values) map.set(value.cid, value);
  return [...map.values()];
}

function readArray(value: unknown, path: string[]): unknown[] {
  const found = readPath(value, path);
  return Array.isArray(found) ? found : [];
}

function readString(value: unknown, path: string[]): string | null {
  const found = readPath(value, path);
  return typeof found === "string" && found.trim() ? found : null;
}

function readNumber(value: unknown, path: string[]): number | null {
  const found = readPath(value, path);
  return typeof found === "number" && Number.isFinite(found) ? found : typeof found === "string" && Number.isFinite(Number(found)) ? Number(found) : null;
}

function readBoolean(value: unknown, path: string[]): boolean | null {
  const found = readPath(value, path);
  return typeof found === "boolean" ? found : null;
}

function readPath(value: unknown, path: string[]): unknown {
  let cursor = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return null;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

function readLooseString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function readLooseNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && Number.isFinite(Number(value)) ? Number(value) : null;
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
