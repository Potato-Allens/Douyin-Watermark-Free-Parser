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

export interface DouyinCommentReplyFetchOptions extends ParseOptions {
  cursor?: number;
  count?: number;
  parentText?: string;
  parentReplyCount?: number;
}

export interface DouyinCommentReplyFetchResult extends DouyinCommentFetchResult {
  parent_cid: string;
}

export interface DouyinCommentCollectProgress {
  mode: "limited" | "all";
  target_top_level_count: number;
  collected_count: number;
  top_level_count: number;
  reply_count: number;
  next_cursor: number;
  has_more: boolean;
  estimated_total: number | null;
  pages_fetched: number;
  reply_pages_fetched: number;
  reply_errors: number;
  current_parent_cid: string | null;
}

export interface DouyinCommentCollectOptions extends ParseOptions {
  mode?: "limited" | "all";
  targetTopLevelCount?: number;
  startCursor?: number;
  startHasMore?: boolean;
  pageSize?: number;
  replyPageSize?: number;
  maxPages?: number;
  maxReplyPagesPerComment?: number;
  delayMs?: number;
  includeReplies?: boolean;
  initialComments?: BatchComment[];
  shouldStop?: () => boolean;
  onProgress?: (progress: DouyinCommentCollectProgress, added: BatchComment[]) => void | Promise<void>;
}

export interface DouyinCommentCollectResult extends DouyinCommentCollectProgress {
  aweme_id: string;
  comments: BatchComment[];
  stopped_reason: "completed" | "target_reached" | "cancelled" | "page_limit" | "stalled";
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

export async function fetchDouyinCommentReplies(
  awemeId: string,
  parentCommentId: string,
  options: DouyinCommentReplyFetchOptions = {},
): Promise<DouyinCommentReplyFetchResult> {
  const normalizedAwemeId = normalizeAwemeId(awemeId);
  const parentCid = normalizeCommentId(parentCommentId);
  const cursor = clamp(Math.floor(options.cursor ?? 0), 0, Number.MAX_SAFE_INTEGER);
  const count = clamp(Math.floor(options.count ?? 20), 1, 100);
  try {
    return await fetchDouyinCommentRepliesViaHttp(normalizedAwemeId, parentCid, cursor, count, options);
  } catch (primaryError) {
    if (!shouldUseBrowserFallback(options, primaryError)) throw primaryError;
    return fetchDouyinCommentRepliesViaBrowser(normalizedAwemeId, parentCid, cursor, count, options);
  }
}

async function fetchDouyinCommentRepliesViaHttp(
  normalizedAwemeId: string,
  parentCid: string,
  cursor: number,
  count: number,
  options: DouyinCommentReplyFetchOptions,
): Promise<DouyinCommentReplyFetchResult> {
  const endpoint = buildCommentReplyListUrl(normalizedAwemeId, parentCid, cursor, count);
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
    if (!response.ok) throw new DouyinServiceError("FETCH_FAILED", `comment reply api status ${response.status}`);
    const text = await response.text();
    if (!text.trim()) throw new DouyinServiceError("FETCH_FAILED", "comment reply api returned an empty body");
    let data: unknown;
    try {
      data = JSON.parse(text) as unknown;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new DouyinServiceError("PARSE_FAILED", `comment reply api returned non-json body: ${detail}`);
    }
    const statusCode = readNumber(data, ["status_code"]);
    if (statusCode !== null && statusCode !== 0) {
      throw new DouyinServiceError("FETCH_FAILED", `${statusCode}: ${readString(data, ["status_msg"]) ?? "comment reply api returned non-zero status"}`);
    }
    const comments = uniqueComments(
      readArray(data, ["comments"])
        .map((value) => normalizeComment(value, { parentCid, level: 2 }))
        .filter(isPresent),
    ).slice(0, count);
    const hasMore = Boolean(readBoolean(data, ["has_more"]) ?? readNumber(data, ["has_more"]));
    const returnedCursor = readNumber(data, ["cursor"]) ?? cursor + comments.length;
    return {
      aweme_id: normalizedAwemeId,
      parent_cid: parentCid,
      source_url: endpoint,
      cursor,
      next_cursor: hasMore ? returnedCursor : null,
      has_more: hasMore,
      total: readNumber(data, ["total"]),
      comments,
    };
  } catch (error) {
    if (error instanceof DouyinServiceError) throw error;
    throw new DouyinServiceError("FETCH_FAILED", error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

export async function collectDouyinComments(
  awemeId: string,
  options: DouyinCommentCollectOptions = {},
): Promise<DouyinCommentCollectResult> {
  const normalizedAwemeId = normalizeAwemeId(awemeId);
  const mode = options.mode === "all" ? "all" : "limited";
  const targetTopLevelCount = clamp(Math.floor(options.targetTopLevelCount ?? 100), 1, 100_000);
  const pageSize = clamp(Math.floor(options.pageSize ?? 20), 1, 100);
  const replyPageSize = clamp(Math.floor(options.replyPageSize ?? 20), 1, 100);
  const maxPages = clamp(Math.floor(options.maxPages ?? 10_000), 1, 10_000);
  const maxReplyPages = clamp(Math.floor(options.maxReplyPagesPerComment ?? 2_000), 1, 2_000);
  const delayMs = clamp(Math.floor(options.delayMs ?? 250), 0, 10_000);
  const includeReplies = options.includeReplies !== false;
  const comments = new Map<string, BatchComment>();
  for (const comment of options.initialComments ?? []) comments.set(comment.cid, comment);

  let topLevelCount = [...comments.values()].filter((comment) => comment.level === 1).length;
  let replyCount = [...comments.values()].filter((comment) => comment.level === 2).length;
  let cursor = clamp(Math.floor(options.startCursor ?? 0), 0, Number.MAX_SAFE_INTEGER);
  let hasMore = options.startHasMore ?? true;
  let estimatedTotal: number | null = null;
  let pagesFetched = 0;
  let replyPagesFetched = 0;
  let replyErrors = 0;
  let currentParentCid: string | null = null;
  let stoppedReason: DouyinCommentCollectResult["stopped_reason"] = "completed";

  const progress = (): DouyinCommentCollectProgress => ({
    mode,
    target_top_level_count: targetTopLevelCount,
    collected_count: comments.size,
    top_level_count: topLevelCount,
    reply_count: replyCount,
    next_cursor: cursor,
    has_more: hasMore,
    estimated_total: estimatedTotal,
    pages_fetched: pagesFetched,
    reply_pages_fetched: replyPagesFetched,
    reply_errors: replyErrors,
    current_parent_cid: currentParentCid,
  });
  const publish = async (added: BatchComment[]) => {
    if (options.onProgress) await options.onProgress(progress(), added);
  };

  if (topLevelCount >= targetTopLevelCount) {
    stoppedReason = "target_reached";
    await publish([]);
  } else {
    while (hasMore && topLevelCount < targetTopLevelCount) {
      if (options.shouldStop?.()) {
        stoppedReason = "cancelled";
        break;
      }
      if (pagesFetched >= maxPages) {
        stoppedReason = "page_limit";
        break;
      }
      const page = await fetchDouyinComments(normalizedAwemeId, { ...options, cursor, count: pageSize });
      pagesFetched += 1;
      estimatedTotal = page.total ?? estimatedTotal;
      const previousCursor = cursor;
      const addedTop: BatchComment[] = [];
      for (const comment of page.comments) {
        if (topLevelCount >= targetTopLevelCount) break;
        if (comments.has(comment.cid)) continue;
        comments.set(comment.cid, comment);
        addedTop.push(comment);
        topLevelCount += 1;
      }
      const nextTopCursor = page.next_cursor ?? previousCursor + page.comments.length;
      hasMore = page.has_more && topLevelCount < targetTopLevelCount;
      await publish(addedTop);

      if (includeReplies) {
        for (const parent of addedTop) {
          if (options.shouldStop?.()) {
            stoppedReason = "cancelled";
            break;
          }
          if (parent.reply_count <= 0) continue;
          currentParentCid = parent.cid;
          let replyCursor = 0;
          let parentHasMore = true;
          let parentPages = 0;
          while (parentHasMore && parentPages < maxReplyPages) {
            if (options.shouldStop?.()) {
              stoppedReason = "cancelled";
              break;
            }
            try {
              const replyPage = await fetchDouyinCommentReplies(normalizedAwemeId, parent.cid, {
                ...options,
                cursor: replyCursor,
                count: replyPageSize,
                parentText: parent.text,
                parentReplyCount: parent.reply_count,
              });
              parentPages += 1;
              replyPagesFetched += 1;
              const addedReplies: BatchComment[] = [];
              for (const reply of replyPage.comments) {
                if (comments.has(reply.cid)) continue;
                comments.set(reply.cid, reply);
                addedReplies.push(reply);
                replyCount += 1;
              }
              const nextReplyCursor = replyPage.next_cursor ?? replyCursor + replyPage.comments.length;
              parentHasMore = replyPage.has_more && nextReplyCursor > replyCursor && replyPage.comments.length > 0;
              replyCursor = nextReplyCursor;
              await publish(addedReplies);
              if (parentHasMore && delayMs > 0) await sleep(delayMs);
            } catch {
              replyErrors += 1;
              parentHasMore = false;
              await publish([]);
            }
          }
          currentParentCid = null;
          if (stoppedReason === "cancelled") break;
        }
      }

      if (stoppedReason === "cancelled") break;
      cursor = nextTopCursor;
      currentParentCid = null;
      await publish([]);
      if (topLevelCount >= targetTopLevelCount) {
        hasMore = page.has_more;
        stoppedReason = "target_reached";
        break;
      }
      if (!page.has_more) {
        hasMore = false;
        stoppedReason = "completed";
        break;
      }
      if (page.comments.length === 0 || cursor <= previousCursor) {
        stoppedReason = "stalled";
        break;
      }
      if (delayMs > 0) await sleep(delayMs);
    }
  }

  currentParentCid = null;
  await publish([]);
  return {
    aweme_id: normalizedAwemeId,
    ...progress(),
    comments: [...comments.values()],
    stopped_reason: stoppedReason,
  };
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

    const comments = uniqueComments(readArray(data, ["comments"]).map((value) => normalizeComment(value)).filter(isPresent)).slice(0, count);
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
    await applyConfiguredDouyinCookies(context);
    const page = await context.newPage();
    const acceptPayload = (url: string, data: unknown) => {
      const urlCursor = readCursorFromUrl(url);
      const rawComments = readArray(data, ["comments"]).map((value) => normalizeComment(value)).filter(isPresent);
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

async function fetchDouyinCommentRepliesViaBrowser(
  normalizedAwemeId: string,
  parentCid: string,
  cursor: number,
  count: number,
  options: DouyinCommentReplyFetchOptions,
): Promise<DouyinCommentReplyFetchResult> {
  const totalTimeoutMs = clamp(options.timeoutMs ?? 35_000, 10_000, 90_000);
  const executablePath = await findChromiumExecutable();
  let browser: any = null;
  const collected = new Map<string, BatchComment>();
  let sourceUrl = `https://www.douyin.com/video/${normalizedAwemeId}`;
  let nextCursor: number | null = null;
  let hasMore = false;
  let total: number | null = null;
  let matchedParent = false;
  let requestedPageSeen = false;
  let loginRequired = false;

  try {
    const playwrightModule = "playwright" + "-core";
    const mod: any = await import(playwrightModule);
    browser = await mod.chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({
      userAgent: options.userAgent ?? DESKTOP_USER_AGENT,
      locale: "zh-CN",
      viewport: { width: 1365, height: 900 },
    });
    await applyConfiguredDouyinCookies(context);
    const page = await context.newPage();

    page.on("response", async (response: any) => {
      const url = response.url();
      if (!url.includes("/aweme/v1/web/comment/list/reply/")) return;
      if (readQueryValue(url, "comment_id") !== parentCid) return;
      matchedParent = true;
      try {
        const text = await response.text();
        if (!text.trim()) return;
        const data = JSON.parse(text) as unknown;
        if ((readNumber(data, ["status_code"]) ?? 0) !== 0) return;
        const pageCursor = readCursorFromUrl(url) ?? 0;
        const rawComments = readArray(data, ["comments"])
          .map((value) => normalizeComment(value, { parentCid, level: 2 }))
          .filter(isPresent);
        const pageEnd = pageCursor + rawComments.length;
        if (pageCursor > cursor || pageEnd <= cursor) return;
        const offset = Math.max(0, cursor - pageCursor);
        for (const comment of rawComments.slice(offset)) {
          if (collected.size >= count) break;
          collected.set(comment.cid, comment);
        }
        sourceUrl = url;
        total = readNumber(data, ["total"]);
        hasMore = Boolean(readBoolean(data, ["has_more"]) ?? readNumber(data, ["has_more"]));
        const returnedCursor = readNumber(data, ["cursor"]) ?? pageCursor + rawComments.length;
        nextCursor = hasMore ? returnedCursor : null;
        requestedPageSeen = true;
      } catch {
        // Ignore unrelated or partial browser responses and keep scanning.
      }
    });

    await page.goto(`https://www.douyin.com/video/${normalizedAwemeId}`, {
      waitUntil: "domcontentloaded",
      timeout: totalTimeoutMs,
    });

    const deadline = Date.now() + totalTimeoutMs;
    let scannedButtons = 0;
    while (Date.now() < deadline && !requestedPageSeen && !loginRequired && scannedButtons < 240) {
      const expectedLabel = options.parentReplyCount && options.parentReplyCount > 0 ? `展开${options.parentReplyCount}条回复` : "";
      const preferredButton = expectedLabel ? page.locator("button.comment-reply-expand-btn").filter({ hasText: expectedLabel }).first() : null;
      if (preferredButton && (await preferredButton.count()) === 0) {
        await scrollCommentSurface(page);
        await page.waitForTimeout(450);
        continue;
      }
      const button = preferredButton ?? page.locator("button.comment-reply-expand-btn:not([data-allen-scanned])").first();
      if ((await button.count()) === 0) {
        await scrollCommentSurface(page);
        await page.waitForTimeout(450);
        continue;
      }

      await button.evaluate((node: HTMLElement) => node.setAttribute("data-allen-scanned", "1")).catch(() => undefined);
      const parentContainer = button.locator("xpath=ancestor::div[.//div[contains(@class,'comment-item-stats-container')]][1]");
      await button.scrollIntoViewIfNeeded().catch(() => undefined);
      await button.click({ force: true, timeout: 3_000 }).catch(() => undefined);
      scannedButtons += 1;
      await page.waitForTimeout(850);
      if (!matchedParent) continue;
      if (requestedPageSeen) break;

      while (Date.now() < deadline && !requestedPageSeen) {
        const moreButton = parentContainer.locator("button").filter({ hasText: /展开更多|更多回复|登录后展开更多/ }).first();
        if ((await moreButton.count()) === 0) break;
        const label = (await moreButton.innerText().catch(() => "")).trim();
        if (label.includes("登录后")) {
          loginRequired = true;
          break;
        }
        await moreButton.click({ force: true, timeout: 3_000 }).catch(() => undefined);
        await page.waitForTimeout(900);
      }
      break;
    }

    const comments = [...collected.values()].slice(0, count);
    if (comments.length === 0) {
      if (loginRequired) {
        throw new DouyinServiceError("FETCH_FAILED", "douyin login cookie is required for deeper reply pages; configure DOUYIN_COOKIE");
      }
      throw new DouyinServiceError(
        "FETCH_FAILED",
        matchedParent ? "browser reply collector did not reach the requested cursor" : "browser reply collector did not find the parent comment",
      );
    }
    return {
      aweme_id: normalizedAwemeId,
      parent_cid: parentCid,
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
    throw new DouyinServiceError("FETCH_FAILED", `browser reply collector failed: ${detail}`);
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

function buildCommentReplyListUrl(awemeId: string, parentCid: string, cursor: number, count: number): string {
  const endpoint = new URL("https://www.douyin.com/aweme/v1/web/comment/list/reply/");
  endpoint.searchParams.set("device_platform", "webapp");
  endpoint.searchParams.set("aid", "6383");
  endpoint.searchParams.set("channel", "channel_pc_web");
  endpoint.searchParams.set("item_id", awemeId);
  endpoint.searchParams.set("comment_id", parentCid);
  endpoint.searchParams.set("cursor", String(cursor));
  endpoint.searchParams.set("count", String(count));
  endpoint.searchParams.set("item_type", "0");
  endpoint.searchParams.set("cut_version", "1");
  endpoint.searchParams.set("pc_client_type", "1");
  endpoint.searchParams.set("version_code", "170400");
  endpoint.searchParams.set("version_name", "17.4.0");
  endpoint.searchParams.set("cookie_enabled", "true");
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

async function applyConfiguredDouyinCookies(context: any): Promise<void> {
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
    .filter(isPresent);
  if (cookies.length > 0) await context.addCookies(cookies);
}

function readQueryValue(url: string, name: string): string | null {
  try {
    return new URL(url).searchParams.get(name);
  } catch {
    return null;
  }
}

function readCursorFromUrl(url: string): number | null {
  const value = readQueryValue(url, "cursor");
  const parsed = value === null ? NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function normalizeCommentId(value: string): string {
  const cid = value.trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(cid)) throw new DouyinServiceError("INVALID_URL", "comment_id is invalid");
  return cid;
}

function normalizeComment(value: unknown, context: { parentCid?: string | null; level?: 1 | 2 } = {}): BatchComment | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const text = readLooseString(record, "text") ?? readLooseString(record, "comment_text") ?? readLooseString(record, "content");
  if (!text) return null;
  const cid = readLooseString(record, "cid") ?? readLooseString(record, "comment_id") ?? readLooseString(record, "id");
  const user = typeof record.user === "object" && record.user ? (record.user as Record<string, unknown>) : null;
  const replyToUser = typeof record.reply_to_user === "object" && record.reply_to_user ? (record.reply_to_user as Record<string, unknown>) : null;
  const nickname = readLooseString(user, "nickname") ?? readLooseString(user, "unique_id") ?? readLooseString(user, "short_id");
  const parentCid = context.parentCid ?? readLooseString(record, "reply_id") ?? readLooseString(record, "parent_cid");
  const level = context.level ?? (parentCid ? 2 : 1);
  return {
    cid: cid ?? stableCommentId(text, nickname),
    parent_cid: level === 2 ? parentCid : null,
    level,
    nickname,
    reply_to_nickname:
      readLooseString(record, "reply_to_nickname") ??
      readLooseString(record, "reply_to_username") ??
      readLooseString(record, "reply_to_user_name") ??
      readLooseString(replyToUser, "nickname") ??
      readLooseString(replyToUser, "unique_id"),
    text,
    digg_count: readLooseNumber(record, "digg_count") ?? readLooseNumber(record, "like_count"),
    create_time: normalizeCreateTime(readLooseNumber(record, "create_time") ?? readLooseString(record, "create_time")),
    reply_count: Math.max(0, Math.floor(readLooseNumber(record, "reply_comment_total") ?? readLooseNumber(record, "reply_count") ?? 0)),
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
