const baseUrl = (process.env.VERCEL_REMOTE_BASE_URL ?? "https://douyin-parser-allen.vercel.app").replace(/\/+$/, "");
const smokeUrl = process.env.SMOKE_DOUYIN_URL ?? "https://v.douyin.com/L5pbfdP/";

export {};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 120_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: init.redirect ?? "manual" });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text) as any;
  } catch {
    throw new Error(`expected json, status=${response.status}, body=${text.slice(0, 500)}`);
  }
}

async function verifyVideoUrl(url: string): Promise<{ status: number; contentType: string; contentRange: string | null; bytes: number }> {
  assert(url.startsWith("http://") || url.startsWith("https://"), `video_url is not absolute: ${url}`);
  assert(!/playwm|watermark=1|logo_name=/i.test(url), `watermark marker exists in url: ${url}`);
  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        "User-Agent":
          "com.ss.android.ugc.aweme/260501 (Linux; U; Android 11; zh_CN; Pixel 5; Build/RQ3A.211001.001; Cronet/TTNetVersion:5f9640e3 2021-04-21 QuicVersion:47946d2a 2020-10-14)",
        Range: "bytes=0-4095",
        Accept: "video/mp4,video/*,*/*",
        Referer: "https://www.douyin.com/",
      },
      redirect: "follow",
    },
    30_000,
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  const ascii = Array.from(bytes)
    .map((value) => String.fromCharCode(value))
    .join("");
  const contentType = response.headers.get("content-type") ?? "";
  assert([200, 206].includes(response.status), `media status invalid: ${response.status}`);
  assert(contentType.includes("video") || ascii.includes("ftyp"), `media is not video: ${contentType}`);
  assert(bytes.length > 0, "media range returned empty body");
  return { status: response.status, contentType, contentRange: response.headers.get("content-range"), bytes: bytes.length };
}

const encoded = encodeURIComponent(smokeUrl);

const missingResponse = await fetchWithTimeout(`${baseUrl}/api/v1/parse`, {}, 30_000);
const missing = await readJson(missingResponse);
assert(missingResponse.status === 400 && missing.code === "MISSING_URL", "missing-url response mismatch");

const v1Response = await fetchWithTimeout(`${baseUrl}/api/v1/parse?url=${encoded}`, {}, 180_000);
const v1 = await readJson(v1Response);
assert(v1Response.status === 200 && v1.ok === true && v1.code === "OK", `v1 failed: ${v1Response.status}`);
assert(v1.data.media.type === "video", `v1 media.type must be video, got ${v1.data.media.type}`);
assert(typeof v1.data.media.video_url === "string" && v1.data.media.video_url.startsWith("https://"), "v1 video_url missing");
const v1Media = await verifyVideoUrl(v1.data.media.video_url);

const textResponse = await fetchWithTimeout(`${baseUrl}/?url=${encoded}`, {}, 180_000);
const textUrl = await textResponse.text();
assert(textResponse.status === 200 && textUrl.startsWith("https://"), `compat text failed: ${textResponse.status}`);
const textMedia = await verifyVideoUrl(textUrl);

const dataResponse = await fetchWithTimeout(`${baseUrl}/?data&url=${encoded}`, {}, 180_000);
const data = await readJson(dataResponse);
assert(dataResponse.status === 200 && data.aweme_id === v1.data.source.aweme_id, "compat data mismatch");
const dataMedia = await verifyVideoUrl(data.video_url);

const helloResponse = await fetchWithTimeout(`${baseUrl}/api/hello?data&url=${encoded}`, {}, 180_000);
const hello = await readJson(helloResponse);
assert(helloResponse.status === 200 && hello.aweme_id === v1.data.source.aweme_id, "api/hello mismatch");
const helloMedia = await verifyVideoUrl(hello.video_url);

console.log(
  JSON.stringify(
    {
      runtime: "vercel-remote-production",
      baseUrl,
      input: smokeUrl,
      aweme_id: v1.data.source.aweme_id,
      statuses: {
        missing: missingResponse.status,
        v1: v1Response.status,
        compat_text: textResponse.status,
        compat_data: dataResponse.status,
        api_hello: helloResponse.status,
      },
      media: { v1: v1Media, compat_text: textMedia, compat_data: dataMedia, api_hello: helloMedia },
    },
    null,
    2,
  ),
);
