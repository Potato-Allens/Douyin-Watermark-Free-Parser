import { DouyinServiceError } from "./errors.ts";
import type { DouyinVideoInfo, FetchLike, MediaType, ParsedDouyinInfo, ParsedMusicInfo, ParseHtmlOptions, ParseOptions } from "./types.ts";

const WEB_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 11; SAMSUNG SM-G973U) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/14.2 Chrome/87.0.4280.141 Mobile Safari/537.36";

const APP_USER_AGENT =
  "com.ss.android.ugc.aweme/260501 (Linux; U; Android 11; zh_CN; Pixel 5; Build/RQ3A.211001.001; Cronet/TTNetVersion:5f9640e3 2021-04-21 QuicVersion:47946d2a 2020-10-14)";

const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";

const DEFAULT_ALLOWED_HOSTS = [
  "douyin.com",
  "iesdouyin.com",
  "snssdk.com",
  "amemv.com",
  "douyinvod.com",
  "douyinpic.com",
  "byteimg.com",
  "pstatp.com",
];

const FALLBACK_VIDEO_PLAY_URL = "https://aweme.snssdk.com/aweme/v1/play/?video_id=%s&ratio=720p&line=0";

interface ResolvedInput {
  inputUrl: string;
  normalizedUrl: string;
  resolvedUrl: string;
  html: string | null;
  awemeId: string | null;
}

interface AwemeAddress {
  uri?: string;
  url_list?: string[];
}

interface AwemeItem {
  aweme_id?: string;
  aweme_type?: number;
  media_type?: number;
  desc?: string;
  create_time?: number;
  statistics?: {
    aweme_id?: string;
    comment_count?: number;
    digg_count?: number;
    share_count?: number;
    collect_count?: number;
  };
  author?: {
    nickname?: string;
    signature?: string;
  };
  video?: Record<string, unknown> & {
    play_addr?: AwemeAddress;
    play_addr_h264?: AwemeAddress;
    play_addr_lowbr?: AwemeAddress;
    play_addr_bytevc1?: AwemeAddress;
    cover?: unknown;
    origin_cover?: unknown;
    dynamic_cover?: unknown;
  };
  music?: Record<string, unknown> & {
    title?: string;
    author?: string;
    author_deleted?: boolean;
    owner_nickname?: string;
    play_url?: AwemeAddress;
    cover_hd?: unknown;
    cover_large?: unknown;
    cover_medium?: unknown;
    cover_thumb?: unknown;
  };
  images?: unknown[];
  image_infos?: unknown[];
}

export function parseDouyinHtml(html: string, sourceUrlOrOptions?: string | ParseHtmlOptions): ParsedDouyinInfo {
  const options = typeof sourceUrlOrOptions === "string" ? { inputUrl: sourceUrlOrOptions } : sourceUrlOrOptions ?? {};
  const text = normalizeText(html);

  const videoId = findVideoId(text);
  const imageUrlList = collectImageUrls(text);
  const coverUrl = findCoverUrlInText(text);
  const music = findMusicInfoInText(text);
  const videoUrl = videoId ? FALLBACK_VIDEO_PLAY_URL.replace("%s", encodeURIComponent(videoId)) : null;
  const mediaType: MediaType = videoId ? "video" : imageUrlList.length > 0 ? "image" : "unknown";

  if (mediaType === "unknown") {
    throw new DouyinServiceError("PARSE_FAILED", "no video play id or image url_list found");
  }

  const statsText = findObjectSection(text, "statistics") ?? text;
  const inputUrl = options.inputUrl ?? "";
  const resolvedUrl = options.resolvedUrl ?? inputUrl;
  const awemeId =
    findStringField(statsText, "aweme_id") ?? findStringField(text, "aweme_id") ?? extractAwemeIdFromUrl(resolvedUrl);
  const createTimestamp = findNumberField(text, "create_time");

  return buildParsedInfo({
    inputUrl,
    resolvedUrl,
    awemeId,
    commentCount: findNumberField(statsText, "comment_count"),
    diggCount: findNumberField(statsText, "digg_count"),
    shareCount: findNumberField(statsText, "share_count"),
    collectCount: findNumberField(statsText, "collect_count"),
    nickname: findStringField(text, "nickname"),
    signature: findStringField(text, "signature"),
    desc: findStringField(text, "desc"),
    createTimestamp,
    mediaType,
    videoUrl,
    coverUrl,
    imageUrlList: mediaType === "image" ? imageUrlList : [],
    music,
  });
}

export async function parseDouyinUrl(input: string, options: ParseOptions = {}): Promise<ParsedDouyinInfo> {
  const resolved = await resolveInput(input, options);

  if (resolved.awemeId) {
    try {
      const aweme = await fetchAwemeFromFeed(resolved.awemeId, options);
      const parsed = await parseAwemeItem(aweme, resolved, options);
      return parsed;
    } catch (error) {
      try {
        const aweme = await fetchAwemeFromWebDetail(resolved.awemeId, options);
        return await parseAwemeItem(aweme, resolved, options);
      } catch {
        // Fall through to HTML parsing below. The feed error remains the authoritative error if no fallback works.
      }
      const fallbackPage = resolved.html
        ? { text: resolved.html, url: resolved.resolvedUrl }
        : await tryFetchResolvedHtml(resolved.normalizedUrl, options);
      if (fallbackPage) {
        return parseDouyinHtml(fallbackPage.text, {
          inputUrl: input,
          resolvedUrl: fallbackPage.url,
        });
      }
      throw error;
    }
  }

  if (resolved.html) {
    return parseDouyinHtml(resolved.html, {
      inputUrl: input,
      resolvedUrl: resolved.resolvedUrl,
    });
  }

  throw new DouyinServiceError("PARSE_FAILED", "aweme id not found in input or resolved page");
}

async function tryFetchResolvedHtml(url: string, options: ParseOptions): Promise<{ text: string; url: string } | null> {
  try {
    const page = await fetchText(url, options, {
      userAgent: options.userAgent ?? WEB_USER_AGENT,
      accept: "text/html,*/*",
    });
    return { text: page.text, url: page.url };
  } catch {
    return null;
  }
}

export async function getNoWatermarkUrl(input: string, options: ParseOptions = {}): Promise<string> {
  const parsed = await parseDouyinUrl(input, options);
  if (parsed.media.type !== "video" || !parsed.media.video_url) {
    throw new DouyinServiceError("UNSUPPORTED_CONTENT", "video_url is not available for image content");
  }
  return parsed.media.video_url;
}

async function resolveInput(input: string, options: ParseOptions): Promise<ResolvedInput> {
  const normalizedUrl = normalizeInputUrl(input, options.allowedHosts ?? DEFAULT_ALLOWED_HOSTS);
  const directId = extractAwemeIdFromUrl(normalizedUrl);
  if (directId) {
    return {
      inputUrl: input,
      normalizedUrl,
      resolvedUrl: normalizedUrl,
      html: null,
      awemeId: directId,
    };
  }

  const page = await fetchText(normalizedUrl, options, { userAgent: options.userAgent ?? WEB_USER_AGENT, accept: "text/html,*/*" });
  const resolvedId = extractAwemeIdFromUrl(page.url) ?? extractAwemeIdFromText(page.text);
  return {
    inputUrl: input,
    normalizedUrl,
    resolvedUrl: page.url,
    html: page.text,
    awemeId: resolvedId,
  };
}

async function fetchAwemeFromFeed(awemeId: string, options: ParseOptions): Promise<AwemeItem> {
  const endpoint = new URL("https://aweme.snssdk.com/aweme/v1/feed/");
  endpoint.searchParams.set("aweme_id", awemeId);
  endpoint.searchParams.set("aid", "1128");
  endpoint.searchParams.set("version_name", "23.5.0");
  endpoint.searchParams.set("device_platform", "android");
  endpoint.searchParams.set("os_version", "11");

  const response = await fetchText(endpoint.toString(), options, {
    userAgent: APP_USER_AGENT,
    accept: "application/json,text/plain,*/*",
  });

  if (!response.text.trim()) {
    throw new DouyinServiceError("FETCH_FAILED", "feed api returned an empty body");
  }

  let data: unknown;
  try {
    data = JSON.parse(response.text) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new DouyinServiceError("PARSE_FAILED", `feed api returned non-json body: ${detail}`);
  }

  const statusCode = readNumber(data, ["status_code"]);
  if (statusCode !== null && statusCode !== 0) {
    const statusMsg = readString(data, ["status_msg"]) ?? "feed api returned non-zero status";
    throw new DouyinServiceError("FETCH_FAILED", `${statusCode}: ${statusMsg}`);
  }

  const list = readArray(data, ["aweme_list"]);
  const target = list.find((item) => readString(item, ["aweme_id"]) === awemeId) ?? null;
  if (!target) {
    throw new DouyinServiceError("PARSE_FAILED", `feed api did not return target aweme_id ${awemeId}`);
  }

  return target as AwemeItem;
}

async function fetchAwemeFromWebDetail(awemeId: string, options: ParseOptions): Promise<AwemeItem> {
  const cookie = await fetchDouyinTtwidCookie(options);
  const endpoint = new URL("https://www.douyin.com/aweme/v1/web/aweme/detail/");
  endpoint.searchParams.set("device_platform", "webapp");
  endpoint.searchParams.set("aid", "6383");
  endpoint.searchParams.set("channel", "channel_pc_web");
  endpoint.searchParams.set("aweme_id", awemeId);
  endpoint.searchParams.set("update_version_code", "170400");
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
  endpoint.searchParams.set("cpu_core_num", "24");
  endpoint.searchParams.set("device_memory", "32");
  endpoint.searchParams.set("platform", "PC");
  endpoint.searchParams.set("downlink", "10");
  endpoint.searchParams.set("effective_type", "4g");
  endpoint.searchParams.set("round_trip_time", "50");

  const response = await fetchText(endpoint.toString(), options, {
    userAgent: DESKTOP_USER_AGENT,
    accept: "application/json,text/plain,*/*",
    headers: {
      Cookie: cookie,
      Referer: `https://www.douyin.com/note/${awemeId}`,
    },
  });

  if (!response.text.trim()) throw new DouyinServiceError("FETCH_FAILED", "web detail api returned an empty body");

  let data: unknown;
  try {
    data = JSON.parse(response.text) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new DouyinServiceError("PARSE_FAILED", `web detail api returned non-json body: ${detail}`);
  }

  const statusCode = readNumber(data, ["status_code"]);
  if (statusCode !== null && statusCode !== 0) {
    const statusMsg = readString(data, ["status_msg"]) ?? "web detail api returned non-zero status";
    throw new DouyinServiceError("FETCH_FAILED", `${statusCode}: ${statusMsg}`);
  }

  const detail = readObject(data, ["aweme_detail"]) ?? readObject(data, ["item_info", "item_struct"]);
  if (!detail) throw new DouyinServiceError("PARSE_FAILED", "web detail api returned no aweme_detail");
  const returnedId = readString(detail, ["aweme_id"]);
  if (returnedId && returnedId !== awemeId) {
    throw new DouyinServiceError("PARSE_FAILED", `web detail api returned unexpected aweme_id ${returnedId}`);
  }
  return detail as AwemeItem;
}

async function parseAwemeItem(aweme: AwemeItem, resolved: ResolvedInput, options: ParseOptions): Promise<ParsedDouyinInfo> {
  const awemeId = aweme.aweme_id ?? resolved.awemeId;
  const videoCandidates = collectVideoCandidates(aweme);
  const imageUrlList = collectImageCandidatesFromAweme(aweme);
  const coverUrl = collectCoverUrlFromAweme(aweme) ?? imageUrlList[0] ?? null;
  const music = collectMusicInfoFromAweme(aweme);
  const isImageAweme = aweme.aweme_type === 68 || (imageUrlList.length > 0 && aweme.media_type !== 4);
  const mediaType: MediaType =
    imageUrlList.length > 0 && isImageAweme ? "image" : videoCandidates.length > 0 ? "video" : imageUrlList.length > 0 ? "image" : "unknown";

  if (mediaType === "unknown") {
    throw new DouyinServiceError("UNSUPPORTED_CONTENT", "feed api returned no playable video or image list");
  }

  const validateMedia = options.validateMedia ?? true;
  const videoUrl = mediaType === "video" ? await chooseVideoUrl(videoCandidates, options, validateMedia) : null;
  const verifiedImages = mediaType === "image" && validateMedia ? await chooseVerifiedImages(imageUrlList, options) : imageUrlList;

  return buildParsedInfo({
    inputUrl: resolved.inputUrl,
    resolvedUrl: resolved.resolvedUrl,
    awemeId,
    commentCount: toNullableNumber(aweme.statistics?.comment_count),
    diggCount: toNullableNumber(aweme.statistics?.digg_count),
    shareCount: toNullableNumber(aweme.statistics?.share_count),
    collectCount: toNullableNumber(aweme.statistics?.collect_count),
    nickname: toNullableString(aweme.author?.nickname),
    signature: toNullableString(aweme.author?.signature),
    desc: toNullableString(aweme.desc),
    createTimestamp: toNullableNumber(aweme.create_time),
    mediaType,
    videoUrl,
    coverUrl,
    imageUrlList: verifiedImages,
    music,
  });
}

function collectVideoCandidates(aweme: AwemeItem): string[] {
  const result: string[] = [];
  const addresses = [aweme.video?.play_addr, aweme.video?.play_addr_h264, aweme.video?.play_addr_lowbr, aweme.video?.play_addr_bytevc1];

  for (const addr of addresses) {
    for (const url of addr?.url_list ?? []) pushCleanUnique(result, url);
  }

  for (const addr of addresses) {
    if (addr?.uri && result.length === 0) {
      pushCleanUnique(result, FALLBACK_VIDEO_PLAY_URL.replace("%s", encodeURIComponent(addr.uri)));
    }
  }

  return result.filter((url) => !isWatermarkedUrl(url));
}

function collectImageCandidatesFromAweme(aweme: AwemeItem): string[] {
  const result: string[] = [];
  for (const container of [aweme.images, aweme.image_infos]) {
    for (const value of container ?? []) collectBestImageUrl(value, result);
  }
  return result;
}

function collectCoverUrlFromAweme(aweme: AwemeItem): string | null {
  const result: string[] = [];
  for (const value of [
    aweme.video?.cover,
    aweme.video?.origin_cover,
    aweme.video?.dynamic_cover,
    aweme.music?.cover_hd,
    aweme.music?.cover_large,
    aweme.music?.cover_medium,
    aweme.music?.cover_thumb,
  ]) {
    collectBestImageUrl(value, result);
  }
  return result[0] ?? null;
}

function collectMusicInfoFromAweme(aweme: AwemeItem): ParsedMusicInfo {
  const covers: string[] = [];
  for (const value of [aweme.music?.cover_hd, aweme.music?.cover_large, aweme.music?.cover_medium, aweme.music?.cover_thumb]) {
    collectBestImageUrl(value, covers);
  }
  const playUrls: string[] = [];
  for (const url of aweme.music?.play_url?.url_list ?? []) {
    const cleaned = cleanUrl(url);
    if (cleaned) pushCleanUnique(playUrls, cleaned);
  }
  return {
    title: toNullableString(aweme.music?.title),
    author: toNullableString(aweme.music?.author) ?? toNullableString(aweme.music?.owner_nickname),
    cover_url: covers[0] ?? null,
    play_url: playUrls[0] ?? null,
  };
}

async function chooseVideoUrl(candidates: string[], options: ParseOptions, validate: boolean): Promise<string> {
  if (candidates.length === 0) throw new DouyinServiceError("UNSUPPORTED_CONTENT", "no no-watermark play_addr url candidates");
  if (!validate) return candidates[0];

  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      await verifyVideoUrl(candidate, options);
      return candidate;
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new DouyinServiceError("FETCH_FAILED", `no video candidate passed media verification: ${failures.join("; ")}`);
}

async function chooseVerifiedImages(candidates: string[], options: ParseOptions): Promise<string[]> {
  const verified: string[] = [];
  for (const candidate of candidates) {
    try {
      await verifyImageUrl(candidate, options);
      pushCleanUnique(verified, candidate);
    } catch {
      // Drop unverifiable image candidates; fail below if all candidates failed.
    }
  }
  if (verified.length === 0 && candidates.length > 0) {
    throw new DouyinServiceError("FETCH_FAILED", "no image candidate passed media verification");
  }
  return verified;
}

async function verifyVideoUrl(url: string, options: ParseOptions): Promise<void> {
  if (isWatermarkedUrl(url)) throw new DouyinServiceError("PARSE_FAILED", "candidate contains watermark marker");
  const response = await fetchBinaryPrefix(url, options, "video/mp4,video/*,*/*");
  const contentType = response.contentType.toLowerCase();
  const hasFtyp = response.bytes.includes("ftyp");
  if (![200, 206].includes(response.status) || (!contentType.includes("video") && !hasFtyp)) {
    throw new DouyinServiceError("FETCH_FAILED", `video verification failed with status=${response.status} content-type=${response.contentType}`);
  }
}

async function verifyImageUrl(url: string, options: ParseOptions): Promise<void> {
  const response = await fetchBinaryPrefix(url, options, "image/*,*/*");
  const contentType = response.contentType.toLowerCase();
  if (![200, 206].includes(response.status) || !contentType.includes("image")) {
    throw new DouyinServiceError("FETCH_FAILED", `image verification failed with status=${response.status} content-type=${response.contentType}`);
  }
}

async function fetchBinaryPrefix(url: string, options: ParseOptions, accept: string): Promise<{ status: number; contentType: string; bytes: string }> {
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (!fetcher) throw new DouyinServiceError("FETCH_FAILED", "fetch is not available in this runtime");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    const response = await fetcher(url, {
      method: "GET",
      headers: {
        "User-Agent": APP_USER_AGENT,
        Accept: accept,
        Range: "bytes=0-4095",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const buf = new Uint8Array(await response.arrayBuffer());
    const bytes = Array.from(buf)
      .map((value) => String.fromCharCode(value))
      .join("");
    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      bytes,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new DouyinServiceError("FETCH_FAILED", detail);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(
  url: string,
  options: ParseOptions,
  request: { userAgent: string; accept: string; headers?: Record<string, string> },
): Promise<{ text: string; url: string; status: number; contentType: string }> {
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (!fetcher) throw new DouyinServiceError("FETCH_FAILED", "fetch is not available in this runtime");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    const response = await fetcher(url, {
      method: "GET",
      headers: buildRequestHeaders(request),
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) throw new DouyinServiceError("FETCH_FAILED", `upstream status ${response.status}`);
    const text = await response.text();
    const responseUrl = response.url || url;
    const wafCookie = await solveWafChallengeCookie(text);
    if (wafCookie) {
      const retryResponse = await fetcher(responseUrl, {
        method: "GET",
        headers: buildRequestHeaders(request, wafCookie),
        redirect: "follow",
        signal: controller.signal,
      });
      if (!retryResponse.ok) throw new DouyinServiceError("FETCH_FAILED", `upstream status ${retryResponse.status} after waf retry`);
      const retryText = await retryResponse.text();
      if (await solveWafChallengeCookie(retryText)) {
        throw new DouyinServiceError("FETCH_FAILED", "waf challenge retry did not return content");
      }
      return {
        text: retryText,
        url: retryResponse.url || responseUrl,
        status: retryResponse.status,
        contentType: retryResponse.headers.get("content-type") ?? "",
      };
    }
    return {
      text,
      url: responseUrl,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
    };
  } catch (error) {
    if (error instanceof DouyinServiceError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new DouyinServiceError("FETCH_FAILED", detail);
  } finally {
    clearTimeout(timer);
  }
}

function buildRequestHeaders(request: { userAgent: string; accept: string; headers?: Record<string, string> }, extraCookie?: string): HeadersInit {
  const existingCookie = request.headers?.Cookie ?? request.headers?.cookie;
  const headers: Record<string, string> = {
    "User-Agent": request.userAgent,
    Accept: request.accept,
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    ...(request.headers ?? {}),
  };
  const cookie = [existingCookie, extraCookie].filter(Boolean).join("; ");
  if (cookie) headers.Cookie = cookie;
  return headers;
}

async function fetchDouyinTtwidCookie(options: ParseOptions): Promise<string> {
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (!fetcher) throw new DouyinServiceError("FETCH_FAILED", "fetch is not available in this runtime");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    const registerResponse = await fetcher("https://ttwid.bytedance.com/ttwid/union/register/", {
      method: "POST",
      headers: {
        "User-Agent": DESKTOP_USER_AGENT,
        Accept: "application/json,text/plain,*/*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        region: "cn",
        aid: 6383,
        needFid: false,
        service: "www.douyin.com",
        migrate_info: { ticket: "", source: "node" },
        cbUrlProtocol: "https",
      }),
      redirect: "follow",
      signal: controller.signal,
    });

    if (!registerResponse.ok) throw new DouyinServiceError("FETCH_FAILED", `ttwid register status ${registerResponse.status}`);
    const registerSetCookie = registerResponse.headers.get("set-cookie") ?? "";
    const ttwid = extractCookiePair(registerSetCookie, "ttwid");
    const body = (await registerResponse.json().catch(() => null)) as { redirect_url?: string } | null;
    if (!ttwid || !body?.redirect_url) throw new DouyinServiceError("FETCH_FAILED", "ttwid register did not return cookie or callback");

    const callbackResponse = await fetcher(body.redirect_url, {
      method: "GET",
      headers: {
        "User-Agent": DESKTOP_USER_AGENT,
        Accept: "application/json,text/plain,*/*",
        Cookie: ttwid,
      },
      redirect: "follow",
      signal: controller.signal,
    });

    if (!callbackResponse.ok) throw new DouyinServiceError("FETCH_FAILED", `ttwid callback status ${callbackResponse.status}`);
    const callbackCookie = extractCookiePair(callbackResponse.headers.get("set-cookie") ?? "", "ttwid");
    return callbackCookie ?? ttwid;
  } catch (error) {
    if (error instanceof DouyinServiceError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new DouyinServiceError("FETCH_FAILED", detail);
  } finally {
    clearTimeout(timer);
  }
}

function extractCookiePair(setCookie: string, name: string): string | null {
  const match = new RegExp(`(?:^|,\\s*)(${escapeRegExp(name)}=[^;,]+)`).exec(setCookie);
  return match?.[1] ?? null;
}

async function solveWafChallengeCookie(html: string): Promise<string | null> {
  const match = /var\s+wci="([^"]+)"[\s\S]*?cs="([^"]+)"/.exec(html);
  if (!match?.[1] || !match[2]) return null;

  let challenge: { v?: { a?: string; c?: string }; d?: string };
  try {
    challenge = JSON.parse(bytesToUtf8(base64ToBytes(match[2]))) as { v?: { a?: string; c?: string }; d?: string };
  } catch {
    return null;
  }

  if (!challenge.v?.a || !challenge.v.c) return null;
  const prefix = base64ToBytes(challenge.v.a);
  const expectHex = bytesToHex(base64ToBytes(challenge.v.c));
  const encoder = new TextEncoder();

  for (let i = 0; i <= 1_000_000; i += 1) {
    const suffix = encoder.encode(String(i));
    const payload = new Uint8Array(prefix.length + suffix.length);
    payload.set(prefix, 0);
    payload.set(suffix, prefix.length);
    const digest = await globalThis.crypto?.subtle.digest("SHA-256", payload);
    if (!digest) throw new DouyinServiceError("FETCH_FAILED", "crypto.subtle is not available for waf challenge");
    if (bytesToHex(new Uint8Array(digest)) === expectHex) {
      challenge.d = stringToBase64(String(i));
      return `${match[1]}=${stringToBase64(JSON.stringify(challenge))}`;
    }
  }

  throw new DouyinServiceError("FETCH_FAILED", "waf challenge solution not found");
}

function buildParsedInfo(input: {
  inputUrl: string;
  resolvedUrl: string;
  awemeId: string | null | undefined;
  commentCount: number | null;
  diggCount: number | null;
  shareCount: number | null;
  collectCount: number | null;
  nickname: string | null;
  signature: string | null;
  desc: string | null;
  createTimestamp: number | null;
  mediaType: MediaType;
  videoUrl: string | null;
  coverUrl: string | null;
  imageUrlList: string[];
  music: ParsedMusicInfo;
}): ParsedDouyinInfo {
  const awemeId = input.awemeId ?? null;
  const createdAt = input.createTimestamp === null ? null : new Date(input.createTimestamp * 1000).toISOString();
  const filename = input.mediaType === "video" ? (awemeId ? `douyin-${awemeId}.mp4` : "douyin-video.mp4") : null;
  const compat: DouyinVideoInfo = {
    aweme_id: awemeId,
    comment_count: input.commentCount,
    digg_count: input.diggCount,
    share_count: input.shareCount,
    collect_count: input.collectCount,
    nickname: input.nickname,
    signature: input.signature,
    desc: input.desc,
    create_time: input.createTimestamp === null ? null : formatCompatDate(new Date(input.createTimestamp * 1000)),
    video_url: input.videoUrl,
    cover_url: input.coverUrl,
    music_title: input.music.title,
    music_author: input.music.author,
    type: input.mediaType === "video" ? "video" : input.mediaType === "image" ? "img" : null,
    image_url_list: input.imageUrlList,
  };

  return {
    source: {
      input_url: input.inputUrl,
      resolved_url: input.resolvedUrl,
      aweme_id: awemeId,
    },
    author: {
      nickname: input.nickname,
      signature: input.signature,
    },
    stats: {
      comment_count: input.commentCount,
      digg_count: input.diggCount,
      share_count: input.shareCount,
      collect_count: input.collectCount,
    },
    content: {
      desc: input.desc,
      create_timestamp: input.createTimestamp,
      created_at: createdAt,
    },
    media: {
      type: input.mediaType,
      video_url: input.videoUrl,
      cover_url: input.coverUrl,
      image_url_list: input.imageUrlList,
    },
    music: input.music,
    download: {
      video_proxy_url: null,
      download_url: null,
      filename,
    },
    compat,
  };
}

function normalizeInputUrl(input: string, allowedHosts: string[]): string {
  const extracted = extractFirstHttpUrl(input);
  if (!extracted) throw new DouyinServiceError("INVALID_URL", "no http(s) url found in input");

  let url: URL;
  try {
    url = new URL(extracted);
  } catch {
    throw new DouyinServiceError("INVALID_URL", "malformed url");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new DouyinServiceError("INVALID_URL", "only http and https urls are supported");
  }
  if (!isAllowedHost(url.hostname, allowedHosts)) {
    throw new DouyinServiceError("INVALID_URL", `unsupported host: ${url.hostname}`);
  }
  return url.toString();
}

function extractFirstHttpUrl(input: string): string | null {
  const trimmed = input.trim();
  const match = trimmed.match(/https?:\/\/[^\s"'<>，。！？；、]+/i);
  const raw = match?.[0] ?? (trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : null);
  return raw?.replace(/[)\]}]+$/u, "") ?? null;
}

function isAllowedHost(hostname: string, allowedHosts: string[]): boolean {
  const host = hostname.toLowerCase();
  return allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function normalizeText(value: string): string {
  return value
    .replace(/\\u002F/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function findVideoId(text: string): string | null {
  const patterns = [
    /"video"\s*:\s*\{[\s\S]*?"play_addr"\s*:\s*\{[\s\S]*?"uri"\s*:\s*"((?:\\.|[^"\\])+)"/,
    /"play_addr"\s*:\s*\{[\s\S]*?"uri"\s*:\s*"((?:\\.|[^"\\])+)"/,
    /"video_id"\s*:\s*"((?:\\.|[^"\\])+)"/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return decodeJsonString(match[1]);
  }
  return null;
}

function collectImageUrls(text: string): string[] {
  const urls: string[] = [];
  const urlListRegex = /"url_list"\s*:\s*\[([\s\S]*?)\]/g;
  let match: RegExpExecArray | null;
  while ((match = urlListRegex.exec(text)) !== null) {
    const block = match[1] ?? "";
    const rawUrlRegex = /"((?:https?:)?\/\/[^"\\]*(?:\\.[^"\\]*)*)"/g;
    let urlMatch: RegExpExecArray | null;
    while ((urlMatch = rawUrlRegex.exec(block)) !== null) {
      const decoded = cleanUrl(urlMatch[1]);
      if (decoded && isImageCdnUrl(decoded)) pushCleanUnique(urls, decoded);
    }
  }
  return urls;
}

function findCoverUrlInText(text: string): string | null {
  const sections = [
    findObjectSection(text, "cover"),
    findObjectSection(text, "origin_cover"),
    findObjectSection(text, "dynamic_cover"),
    findObjectSection(text, "cover_large"),
    findObjectSection(text, "cover_medium"),
    findObjectSection(text, "cover_thumb"),
  ];
  for (const section of sections) {
    if (!section) continue;
    const candidates = collectImageUrls(section);
    if (candidates[0]) return candidates[0];
  }
  return collectImageUrls(text)[0] ?? null;
}

function findMusicInfoInText(text: string): ParsedMusicInfo {
  const section = findObjectSection(text, "music") ?? "";
  const coverCandidates = section ? collectImageUrls(section) : [];
  const playCandidates: string[] = [];
  if (section) collectUrlListsFromText(section, playCandidates, (url) => /music|audio|mime_type=audio|\.mp3|\.m4a/i.test(url));
  return {
    title: section ? findStringField(section, "title") : null,
    author: section ? findStringField(section, "author") ?? findStringField(section, "owner_nickname") : null,
    cover_url: coverCandidates[0] ?? null,
    play_url: playCandidates[0] ?? null,
  };
}

function collectUrlListsFromText(text: string, output: string[], predicate: (url: string) => boolean): void {
  const rawUrlRegex = /"((?:https?:)?\/\/[^"\\]*(?:\\.[^"\\]*)*)"/g;
  let urlMatch: RegExpExecArray | null;
  while ((urlMatch = rawUrlRegex.exec(text)) !== null) {
    const decoded = cleanUrl(urlMatch[1]);
    if (decoded && predicate(decoded)) pushCleanUnique(output, decoded);
  }
}

function collectUrlLists(value: unknown, output: string[], predicate: (url: string) => boolean): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectUrlLists(item, output, predicate);
    return;
  }
  const record = value as Record<string, unknown>;
  const urlList = record.url_list;
  if (Array.isArray(urlList)) {
    for (const raw of urlList) {
      if (typeof raw !== "string") continue;
      const cleaned = cleanUrl(raw);
      if (cleaned && predicate(cleaned)) pushCleanUnique(output, cleaned);
    }
  }
  for (const child of Object.values(record)) {
    if (child && typeof child === "object") collectUrlLists(child, output, predicate);
  }
}

function collectBestImageUrl(value: unknown, output: string[]): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    let found = false;
    for (const item of value) found = collectBestImageUrl(item, output) || found;
    return found;
  }

  const record = value as Record<string, unknown>;
  const urlList = record.url_list;
  if (Array.isArray(urlList)) {
    for (const raw of urlList) {
      if (typeof raw !== "string") continue;
      const cleaned = cleanUrl(raw);
      if (cleaned && isImageCdnUrl(cleaned)) {
        pushCleanUnique(output, cleaned);
        return true;
      }
    }
  }

  let found = false;
  for (const child of Object.values(record)) found = collectBestImageUrl(child, output) || found;
  return found;
}

function cleanUrl(raw: string): string | null {
  const decoded = decodeJsonString(raw)
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/\\&/g, "&")
    .replace(/&amp;/g, "&");
  const value = decoded.startsWith("//") ? `https:${decoded}` : decoded;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

function pushCleanUnique(list: string[], raw: string): void {
  const cleaned = cleanUrl(raw) ?? raw;
  if (!list.includes(cleaned)) list.push(cleaned);
}

function isImageCdnUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (path.includes("/obj/")) return false;
    return ["douyinpic.com", "byteimg.com", "pstatp.com"].some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function isWatermarkedUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes("playwm") || lower.includes("watermark=1") || lower.includes("logo_name=");
}

function findObjectSection(text: string, key: string): string | null {
  const keyPattern = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*\\{`, "g");
  const match = keyPattern.exec(text);
  if (!match) return null;
  let depth = 0;
  for (let i = match.index + match[0].length - 1; i < text.length; i += 1) {
    const char = text[i];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(match.index, i + 1);
    }
  }
  return null;
}

function findStringField(text: string, key: string): string | null {
  const pattern = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
  const match = pattern.exec(text);
  if (!match?.[1]) return null;
  const value = decodeJsonString(match[1]);
  return value.length > 0 ? value : null;
}

function findNumberField(text: string, key: string): number | null {
  const pattern = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*(\\d+)`);
  const match = pattern.exec(text);
  if (!match?.[1]) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

function extractAwemeIdFromUrl(url: string): string | null {
  if (!url) return null;
  const patterns = [/\/(?:video|note)\/(\d+)/, /[?&](?:modal_id|aweme_id|item_ids)=(\d+)/];
  for (const pattern of patterns) {
    const match = pattern.exec(url);
    if (match?.[1]) return match[1];
  }
  return null;
}

function extractAwemeIdFromText(text: string): string | null {
  const normalized = normalizeText(text);
  return (
    extractAwemeIdFromUrl(normalized) ??
    findStringField(normalized, "aweme_id") ??
    findStringField(normalized, "itemId") ??
    null
  );
}

function decodeJsonString(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

function base64ToBytes(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function stringToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(value: unknown, path: string[]): string | null {
  let cursor = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return null;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return toNullableString(cursor);
}

function readNumber(value: unknown, path: string[]): number | null {
  let cursor = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return null;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return toNullableNumber(cursor);
}

function readArray(value: unknown, path: string[]): unknown[] {
  let cursor = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return [];
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return Array.isArray(cursor) ? cursor : [];
}

function readObject(value: unknown, path: string[]): Record<string, unknown> | null {
  let cursor = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return null;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor && typeof cursor === "object" && !Array.isArray(cursor) ? (cursor as Record<string, unknown>) : null;
}

function formatCompatDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}:${pad(date.getSeconds())}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
