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
  try {
    return await fetchDouyinCommentsViaHttp(normalizedAwemeId, cursor, count, options);
  } catch (primaryError) {
    if (options.fetcher) throw primaryError;
    try {
      return await fetchDouyinCommentsViaHttp(normalizedAwemeId, cursor, count, options, buildLegacyCommentListUrl(normalizedAwemeId, cursor, count));
    } catch (legacyError) {
      if (!shouldUseBrowserFallback(options, legacyError)) throw legacyError;
      return await fetchDouyinCommentsViaBrowser(normalizedAwemeId, cursor, count, options);
    }
  }
}

async function fetchDouyinCommentsViaHttp(
  normalizedAwemeId: string,
  cursor: number,
  count: number,
  options: DouyinCommentFetchOptions,
  endpointOverride?: string,
): Promise<DouyinCommentFetchResult> {
  const endpoint = endpointOverride ?? buildCommentListUrl(normalizedAwemeId, cursor, count);
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

    const comments = uniqueComments(readArray(data, ["comments"]).map(normalizeComment).filter(isPresent)).slice(0, count);
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

async function fetchDouyinCommentsViaBrowser(
  normalizedAwemeId: string,
  cursor: number,
  count: number,
  options: DouyinCommentFetchOptions,
): Promise<DouyinCommentFetchResult> {
  const totalTimeoutMs = clamp(options.timeoutMs ?? 25_000, 8_000, 60_000);
  const executablePath = await findChromiumExecutable();
  let browser: any = null;
  const collected = new Map<string, BatchComment>();
  let sourceUrl = `https://www.douyin.com/video/${normalizedAwemeId}`;
  let nextCursor: number | null = null;
  let hasMore = false;
  let total: number | null = null;
  let lastAcceptedAt = 0;

  try {
    const playwrightModule = "playwright" + "-core";
    const mod: any = await import(playwrightModule);
    browser = await mod.chromium.launch({
      executablePath,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
      ],
    });
    const context = await browser.newContext({
      userAgent: options.userAgent ?? DESKTOP_USER_AGENT,
      locale: "zh-CN",
      viewport: { width: 1365, height: 900 },
    });
    const page = await context.newPage();
    const acceptPayload = (url: string, data: unknown) => {
      const urlCursor = readCursorFromUrl(url);
      const rawComments = readArray(data, ["comments"]).map(normalizeComment).filter(isPresent);
      if (rawComments.length === 0) return;
      const pageStart = urlCursor ?? cursor;
      const pageEnd = pageStart + rawComments.length;
      if (pageEnd <= cursor) return;

      const offset = Math.max(0, cursor - pageStart);
      for (const comment of rawComments.slice(offset)) {
        if (collected.size >= count) break;
        collected.set(comment.cid, comment);
      }
      sourceUrl = url;
      total = readNumber(data, ["total"]);
      hasMore = Boolean(readBoolean(data, ["has_more"]) ?? readNumber(data, ["has_more"]));
      nextCursor = hasMore ? readNumber(data, ["cursor"]) ?? pageStart + rawComments.length : null;
      lastAcceptedAt = Date.now();
    };

    page.on("response", async (response: any) => {
      const url = response.url();
      if (!url.includes("/aweme/v1/web/comment/list/")) return;
      try {
        const text = await response.text();
        if (!text.trim()) return;
        acceptPayload(url, JSON.parse(text));
      } catch {
        // Ignore unrelated anti-bot / partial responses; the final result below decides success.
      }
    });

    await page.goto(`https://www.douyin.com/video/${normalizedAwemeId}`, {
      waitUntil: "domcontentloaded",
      timeout: totalTimeoutMs,
    });

    const deadline = Date.now() + totalTimeoutMs;
    while (Date.now() < deadline && collected.size < count && (collected.size === 0 || hasMore)) {
      await Promise.race([
        page.waitForTimeout(1_200),
        page.waitForResponse((response: any) => response.url().includes("/aweme/v1/web/comment/list/"), { timeout: 1_500 }).catch(() => null),
      ]);
      if (collected.size >= count) break;
      await scrollCommentSurface(page);
      if (collected.size > 0 && !hasMore) break;
      if (collected.size > 0 && Date.now() - lastAcceptedAt > 6_000) break;
    }

    const comments = [...collected.values()].slice(0, count);
    if (comments.length === 0) throw new DouyinServiceError("FETCH_FAILED", "browser comment collector did not receive comments");
    return {
      aweme_id: normalizedAwemeId,
      source_url: sourceUrl,
      cursor,
      next_cursor: hasMore ? nextCursor : null,
      has_more: hasMore,
      total,
      comments,
    };
  } catch (error) {
    if (error instanceof DouyinServiceError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new DouyinServiceError("FETCH_FAILED", `browser comment collector failed: ${detail}`);
  } finally {
    if (browser) await Promise.race([browser.close().catch(() => undefined), sleep(2_500)]);
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

function buildLegacyCommentListUrl(awemeId: string, cursor: number, count: number): string {
  const endpoint = new URL("https://www.iesdouyin.com/web/api/v2/comment/list/");
  endpoint.searchParams.set("aweme_id", awemeId);
  endpoint.searchParams.set("cursor", String(cursor));
  endpoint.searchParams.set("count", String(count));
  return endpoint.toString();
}

function shouldUseBrowserFallback(options: DouyinCommentFetchOptions, error: unknown): boolean {
  if (options.fetcher) return false;
  if (!isNodeRuntime()) return false;
  const env = readProcessEnv();
  if (env.DOUYIN_COMMENTS_BROWSER === "0" || env.DOUYIN_COMMENTS_BROWSER?.toLowerCase() === "false") return false;
  if (!(error instanceof DouyinServiceError)) return false;
  return error.code === "FETCH_FAILED" || error.code === "PARSE_FAILED";
}

function isNodeRuntime(): boolean {
  return typeof process !== "undefined" && Boolean(process.versions?.node);
}

function readProcessEnv(): Record<string, string | undefined> {
  return isNodeRuntime() ? process.env : {};
}

async function findChromiumExecutable(): Promise<string | undefined> {
  const env = readProcessEnv();
  const configured = env.DOUYIN_CHROMIUM_PATH || env.CHROMIUM_PATH || env.CHROME_PATH;
  if (configured) return configured;
  const candidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          `${env.LOCALAPPDATA ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
          "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
          "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        ]
      : ["/usr/bin/chromium-browser", "/usr/bin/chromium", "/usr/bin/google-chrome-stable", "/usr/bin/google-chrome"];
  const fs = await import("node:fs");
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function readCursorFromUrl(url: string): number | null {
  try {
    const value = new URL(url).searchParams.get("cursor");
    const parsed = value === null ? NaN : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function scrollCommentSurface(page: any): Promise<void> {
  await page.mouse.wheel(0, 1_400).catch(() => undefined);
  await page.keyboard.press("PageDown").catch(() => undefined);
  await Promise.race([
    page
      .evaluate(() => {
        const scrollables = [...document.querySelectorAll<HTMLElement>("div,section,main")].filter((node) => {
          const style = window.getComputedStyle(node);
          return /(auto|scroll)/.test(`${style.overflow}${style.overflowY}`) && node.scrollHeight > node.clientHeight + 80;
        });
        for (const node of scrollables.slice(0, 8)) node.scrollTop = node.scrollHeight;
      })
      .catch(() => undefined),
    sleep(1_500),
  ]);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
