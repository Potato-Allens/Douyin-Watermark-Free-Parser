import { DouyinServiceError } from "./errors.ts";
import type { FetchLike, ParseOptions } from "./types.ts";

const PROFILE_ALLOWED_HOSTS = ["douyin.com", "iesdouyin.com", "amemv.com"];
const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";
const MOBILE_PROFILE_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
let profileBrowserQueue: Promise<void> = Promise.resolve();

export interface ProfileInspectResult {
  input_url: string;
  resolved_url: string;
  sec_user_id: string | null;
  total_count: number | null;
  available_count: number;
  has_more: boolean;
  aweme_ids: string[];
}

export interface ProfileInspectOptions extends ParseOptions {
  maxItems?: number;
  pageSize?: number;
  maxPages?: number;
}

export async function inspectDouyinProfile(input: string, options: ProfileInspectOptions = {}): Promise<ProfileInspectResult> {
  const normalizedUrl = normalizeProfileInput(input);
  const page = await fetchProfileText(normalizedUrl, options);
  const secUserId = extractSecUserId(page.url) ?? extractSecUserId(page.text);
  const htmlIds = extractAwemeIds(page.text);
  const totalFromHtml = extractTotalCount(page.text);
  let apiIds: string[] = [];
  let apiTotal: number | null = null;
  let apiHasMore: boolean | null = null;
  let apiError: unknown = null;

  if (secUserId) {
    try {
      const api = await fetchProfilePostList(secUserId, options);
      apiIds = api.awemeIds;
      apiTotal = api.totalCount;
      apiHasMore = api.hasMore;
    } catch (error) {
      apiError = error;
      if (shouldUseProfileBrowserFallback(options, error)) {
        try {
          const browserApi = await fetchProfilePostListViaBrowser(secUserId, page.url, options);
          apiIds = browserApi.awemeIds;
          apiTotal = browserApi.totalCount;
          apiHasMore = browserApi.hasMore;
          apiError = null;
        } catch (browserError) {
          apiError = browserError;
        }
      }
    }
  }

  const awemeIds = unique([...apiIds, ...htmlIds]);
  const totalCount = apiTotal ?? totalFromHtml ?? (awemeIds.length > 0 ? awemeIds.length : null);
  if (awemeIds.length === 0 && totalCount === null) {
    if (apiError instanceof DouyinServiceError) throw apiError;
    throw new DouyinServiceError("PARSE_FAILED", "profile page did not expose sec_user_id or aweme ids");
  }

  return {
    input_url: input,
    resolved_url: page.url,
    sec_user_id: secUserId,
    total_count: totalCount,
    available_count: awemeIds.length,
    has_more: apiHasMore ?? (typeof totalCount === "number" && awemeIds.length < totalCount),
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

async function fetchProfilePostList(
  secUserId: string,
  options: ProfileInspectOptions,
): Promise<{ awemeIds: string[]; totalCount: number | null; hasMore: boolean }> {
  const fetcher: FetchLike = options.fetcher ?? globalThis.fetch;
  if (!fetcher) throw new DouyinServiceError("FETCH_FAILED", "fetch is not available");
  const maxItems = clampInt(options.maxItems ?? 20, 1, 1000);
  const pageSize = clampInt(options.pageSize ?? Math.min(35, maxItems), 1, 50);
  const maxPages = clampInt(options.maxPages ?? Math.ceil(maxItems / pageSize) + 2, 1, 100);
  const awemeIds: string[] = [];
  let totalCount: number | null = null;
  let cursor = 0;
  let page = 0;
  let hasMore = true;
  let resultHasMore = false;

  while (awemeIds.length < maxItems && hasMore && page < maxPages) {
    const pageCount = Math.min(pageSize, maxItems - awemeIds.length);
    const data = await fetchProfilePostPage(secUserId, cursor, pageCount, fetcher, options);
    totalCount ??= data.totalCount;
    const beforeCount = awemeIds.length;
    for (const id of data.awemeIds) {
      if (!awemeIds.includes(id)) awemeIds.push(id);
      if (awemeIds.length >= maxItems) break;
    }
    page += 1;
    const nextCursor = data.nextCursor ?? cursor;
    const progressed = nextCursor !== cursor || awemeIds.length > beforeCount;
    const responseWasTruncated = data.awemeIds.length > awemeIds.length - beforeCount;
    resultHasMore = responseWasTruncated || (Boolean(data.hasMore) && progressed);
    hasMore = resultHasMore && awemeIds.length < maxItems;
    cursor = nextCursor;
  }

  if (awemeIds.length === 0 && totalCount === null) {
    throw new DouyinServiceError("PARSE_FAILED", "profile post api returned no works metadata");
  }
  if (awemeIds.length >= maxItems && totalCount !== null && awemeIds.length < totalCount) resultHasMore = true;
  return { awemeIds, totalCount, hasMore: resultHasMore };
}

async function fetchProfilePostPage(
  secUserId: string,
  cursor: number,
  count: number,
  fetcher: FetchLike,
  options: ProfileInspectOptions,
): Promise<{ awemeIds: string[]; totalCount: number | null; nextCursor: number | null; hasMore: boolean }> {
  const endpoint = new URL("https://www.douyin.com/aweme/v1/web/aweme/post/");
  endpoint.searchParams.set("device_platform", "webapp");
  endpoint.searchParams.set("aid", "6383");
  endpoint.searchParams.set("channel", "channel_pc_web");
  endpoint.searchParams.set("sec_user_id", secUserId);
  endpoint.searchParams.set("max_cursor", String(cursor));
  endpoint.searchParams.set("locate_query", "false");
  endpoint.searchParams.set("show_live_replay_strategy", "1");
  endpoint.searchParams.set("count", String(count));
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
  if (!text.trim()) throw new DouyinServiceError("FETCH_FAILED", "profile post api returned an empty body");
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new DouyinServiceError("PARSE_FAILED", `profile post api returned non-json body: ${detail}`);
  }
  const statusCode = readNumber(data, ["status_code"]);
  if (statusCode !== null && statusCode !== 0) {
    throw new DouyinServiceError("FETCH_FAILED", `${statusCode}: profile post api returned non-zero status`);
  }
  const awemeList = readArray(data, ["aweme_list"]);
  const ids = extractAwemeIds(JSON.stringify(awemeList.length > 0 ? awemeList : data));
  const total = readNumber(data, ["total"]) ?? readNumber(data, ["max_count"]);
  const nextCursor = readNumber(data, ["max_cursor"]) ?? readNumber(data, ["cursor"]) ?? readNumber(data, ["next_cursor"]);
  const hasMore = readBoolean(data, ["has_more"]) ?? (readNumber(data, ["has_more"]) ?? 0) > 0;
  return { awemeIds: ids, totalCount: total, nextCursor, hasMore };
}

async function fetchProfilePostListViaBrowser(
  secUserId: string,
  resolvedProfileUrl: string,
  options: ProfileInspectOptions,
): Promise<{ awemeIds: string[]; totalCount: number | null; hasMore: boolean }> {
  let releaseQueue!: () => void;
  const previous = profileBrowserQueue;
  profileBrowserQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  await previous;
  try {
    return await fetchProfilePostListViaBrowserUnlocked(secUserId, resolvedProfileUrl, options);
  } finally {
    releaseQueue();
  }
}

async function fetchProfilePostListViaBrowserUnlocked(
  secUserId: string,
  resolvedProfileUrl: string,
  options: ProfileInspectOptions,
): Promise<{ awemeIds: string[]; totalCount: number | null; hasMore: boolean }> {
  const maxItems = clampInt(options.maxItems ?? 20, 1, 1000);
  const timeoutMs = clampInt(options.timeoutMs ?? 35_000, 10_000, 90_000);
  const executablePath = await findProfileChromiumExecutable();
  if (!executablePath) throw new DouyinServiceError("FETCH_FAILED", "Chromium executable was not found for profile collection");

  let browser: any = null;
  const ids = new Map<string, true>();
  const pending = new Set<Promise<void>>();
  let totalCount: number | null = null;
  let postResponseSeen = false;
  let postHasMore = true;
  let lastProgressAt = Date.now();

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
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--disable-background-networking",
        "--disable-extensions",
      ],
    });
    const context = await browser.newContext({
      userAgent: MOBILE_PROFILE_USER_AGENT,
      locale: "zh-CN",
      viewport: { width: 390, height: 844 },
      isMobile: true,
      serviceWorkers: "block",
    });
    await applyConfiguredProfileCookies(context);
    await context.route("**/*", (route: any) => {
      const type = route.request().resourceType();
      return type === "image" || type === "media" || type === "font" ? route.abort() : route.continue();
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);

    page.on("response", (response: any) => {
      const url = response.url();
      const isPostResponse = url.includes("/web/api/v2/aweme/post/") || url.includes("/aweme/v1/web/aweme/post/");
      if (!isPostResponse && !url.includes("/aweme/v1/web/user/profile/other/")) return;
      const task = (async () => {
        try {
          const text = await Promise.race([response.text(), sleep(5_000).then(() => "")]);
          if (!text.trim()) return;
          const data = JSON.parse(text) as unknown;
          if ((readNumber(data, ["status_code"]) ?? 0) !== 0) return;
          if (!isPostResponse) {
            totalCount = readNumber(data, ["user", "aweme_count"]) ?? totalCount;
            return;
          }

          postResponseSeen = true;
          const before = ids.size;
          const awemeList = readArray(data, ["aweme_list"]);
          for (const id of extractAwemeIds(JSON.stringify(awemeList.length > 0 ? awemeList : data))) ids.set(id, true);
          totalCount = readNumber(data, ["total"]) ?? totalCount;
          postHasMore = Boolean(readBoolean(data, ["has_more"]) ?? readNumber(data, ["has_more"]));
          if (ids.size > before) lastProgressAt = Date.now();
        } catch {
          // Ignore anti-bot and partial responses; the collected result below decides success.
        }
      })();
      pending.add(task);
      void task.finally(() => pending.delete(task));
    });

    const deadline = Date.now() + timeoutMs;
    const profileUrls = unique([buildIesProfileUrl(secUserId, resolvedProfileUrl), buildCleanIesProfileUrl(secUserId)]);
    for (const [attempt, profileUrl] of profileUrls.entries()) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await page.goto(profileUrl, { waitUntil: "commit", timeout: Math.max(1_000, remaining) }).catch(() => undefined);
      const attemptDeadline = attempt === profileUrls.length - 1 ? deadline : Math.min(deadline, Date.now() + 12_000);
      while (Date.now() < attemptDeadline) {
        await page.waitForTimeout(800);
        if (ids.size >= maxItems) break;
        if (postResponseSeen && !postHasMore) break;
        if (postResponseSeen && Date.now() - lastProgressAt > 8_000) break;
        if (postResponseSeen) {
          await cdp
            .send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 680, y: 760, deltaX: 0, deltaY: 2_400 })
            .catch(() => undefined);
        }
      }
      if (postResponseSeen || ids.size >= maxItems) break;
    }
    if (pending.size > 0) await Promise.race([Promise.allSettled([...pending]), sleep(9_000)]);

    if (ids.size === 0) {
      const renderedHtml = await Promise.race([page.content().catch(() => ""), sleep(3_000).then(() => "")]);
      for (const id of extractAwemeIds(renderedHtml)) ids.set(id, true);
    }

    const allIds = [...ids.keys()];
    const awemeIds = allIds.slice(0, maxItems);
    if (!postResponseSeen && awemeIds.length === 0) {
      throw new DouyinServiceError("FETCH_FAILED", "主页采集器没有收到作品列表，已重试备用页面");
    }
    totalCount ??= postHasMore ? null : allIds.length;
    const hasMore = postHasMore || allIds.length > awemeIds.length || (awemeIds.length >= maxItems && totalCount !== null && awemeIds.length < totalCount);
    return { awemeIds, totalCount, hasMore };
  } catch (error) {
    if (error instanceof DouyinServiceError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new DouyinServiceError("FETCH_FAILED", `browser profile collector failed: ${detail}`);
  } finally {
    if (browser) await Promise.race([browser.close().catch(() => undefined), sleep(2_500)]);
  }
}

function buildIesProfileUrl(secUserId: string, resolvedProfileUrl: string): string {
  try {
    const resolved = new URL(resolvedProfileUrl);
    if ((resolved.hostname === "iesdouyin.com" || resolved.hostname.endsWith(".iesdouyin.com")) && resolved.pathname.includes("/share/user/")) {
      return resolved.toString();
    }
  } catch {
    // Rebuild a clean IES share page URL below.
  }
  return buildCleanIesProfileUrl(secUserId);
}

function buildCleanIesProfileUrl(secUserId: string): string {
  const fallback = new URL(`https://www.iesdouyin.com/share/user/${encodeURIComponent(secUserId)}`);
  fallback.searchParams.set("sec_uid", secUserId);
  fallback.searchParams.set("from_ssr", "1");
  return fallback.toString();
}

function shouldUseProfileBrowserFallback(options: ProfileInspectOptions, error: unknown): boolean {
  if (options.fetcher || !isNodeRuntime()) return false;
  const env = readProcessEnv();
  if (env.DOUYIN_PROFILE_BROWSER === "0" || env.DOUYIN_PROFILE_BROWSER?.toLowerCase() === "false") return false;
  return error instanceof DouyinServiceError && (error.code === "FETCH_FAILED" || error.code === "PARSE_FAILED");
}

function isNodeRuntime(): boolean {
  return typeof process !== "undefined" && Boolean(process.versions?.node);
}

function readProcessEnv(): Record<string, string | undefined> {
  return isNodeRuntime() ? process.env : {};
}

async function findProfileChromiumExecutable(): Promise<string | undefined> {
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

async function applyConfiguredProfileCookies(context: any): Promise<void> {
  const raw = readProcessEnv().DOUYIN_COOKIE?.trim();
  if (!raw) return;
  const cookies = raw
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf("=");
      if (separator <= 0) return null;
      return {
        name: part.slice(0, separator).trim(),
        value: part.slice(separator + 1).trim(),
        domain: ".douyin.com",
        path: "/",
        secure: true,
        sameSite: "Lax" as const,
      };
    })
    .filter((cookie): cookie is NonNullable<typeof cookie> => cookie !== null);
  if (cookies.length > 0) await context.addCookies(cookies);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeProfileInput(input: string): string {
  const match = input.trim().match(/https?:\/\/[^\s"'<>，。！？；、]+/i);
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
  return typeof cursor === "number" && Number.isFinite(cursor) ? cursor : typeof cursor === "string" && Number.isFinite(Number(cursor)) ? Number(cursor) : null;
}

function readBoolean(value: unknown, path: string[]): boolean | null {
  let cursor = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return null;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === "boolean" ? cursor : null;
}

function readArray(value: unknown, path: string[]): unknown[] {
  let cursor = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return [];
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return Array.isArray(cursor) ? cursor : [];
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(Number.isFinite(value) ? value : min)));
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
