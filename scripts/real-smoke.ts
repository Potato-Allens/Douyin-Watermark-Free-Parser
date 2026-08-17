import { createApp } from "../src/app.ts";

const smokeUrl = process.env.SMOKE_DOUYIN_URL ?? "https://www.douyin.com/video/6914948781100338440";
const encoded = encodeURIComponent(smokeUrl);
const app = createApp();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function readJson(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text) as any;
  } catch {
    throw new Error(`expected json, status=${response.status}, body=${text.slice(0, 500)}`);
  }
}

async function verifyVideoUrl(url: string) {
  assert(url.startsWith("http://") || url.startsWith("https://"), `video_url is not absolute: ${url}`);
  assert(!/playwm|watermark=1|logo_name=/i.test(url), `video_url contains watermark marker: ${url}`);

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "com.ss.android.ugc.aweme/260501 (Linux; U; Android 11; zh_CN; Pixel 5; Build/RQ3A.211001.001; Cronet/TTNetVersion:5f9640e3 2021-04-21 QuicVersion:47946d2a 2020-10-14)",
      Range: "bytes=0-4095",
      Accept: "video/mp4,video/*,*/*",
    },
    redirect: "follow",
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const prefix = Array.from(bytes)
    .map((value) => String.fromCharCode(value))
    .join("");
  const contentType = response.headers.get("content-type") ?? "";

  assert([200, 206].includes(response.status), `video range status must be 200/206, got ${response.status}`);
  assert(contentType.includes("video") || prefix.includes("ftyp"), `video content type/magic invalid: ${contentType}`);
  assert(bytes.length > 0, "video range returned empty body");

  return {
    status: response.status,
    contentType,
    contentRange: response.headers.get("content-range"),
    bytes: bytes.length,
    finalUrl: response.url,
  };
}

const v1Response = await app.request(`/api/v1/parse?url=${encoded}`);
const v1 = await readJson(v1Response);
assert(v1Response.status === 200, `v1 status must be 200, got ${v1Response.status}: ${JSON.stringify(v1).slice(0, 500)}`);
assert(v1.ok === true && v1.code === "OK", `v1 ok/code invalid: ${JSON.stringify(v1).slice(0, 500)}`);
assert(v1.data?.source?.aweme_id, "v1 source.aweme_id missing");
assert(v1.data?.media?.type === "video", `v1 media.type must be video, got ${v1.data?.media?.type}`);
assert(v1.data?.media?.video_url, "v1 media.video_url missing");
const mediaCheck = await verifyVideoUrl(v1.data.media.video_url);

const compatTextResponse = await app.request(`/?url=${encoded}`);
const compatVideoUrl = await compatTextResponse.text();
assert(compatTextResponse.status === 200, `compat text status must be 200, got ${compatTextResponse.status}: ${compatVideoUrl}`);
const compatTextMediaCheck = await verifyVideoUrl(compatVideoUrl);

const compatDataResponse = await app.request(`/?data&url=${encoded}`);
const compatData = await readJson(compatDataResponse);
assert(compatDataResponse.status === 200, `compat data status must be 200, got ${compatDataResponse.status}`);
assert(compatData.aweme_id === v1.data.source.aweme_id, "compat data aweme_id differs from v1");
assert(compatData.type === "video", `compat type must be video, got ${compatData.type}`);
const compatDataMediaCheck = await verifyVideoUrl(compatData.video_url);

const helloResponse = await app.request(`/api/hello?data&url=${encoded}`);
const helloData = await readJson(helloResponse);
assert(helloResponse.status === 200, `api/hello status must be 200, got ${helloResponse.status}`);
assert(helloData.aweme_id === compatData.aweme_id, "api/hello aweme_id differs from root compat data");
assert(helloData.type === "video", `api/hello type must be video, got ${helloData.type}`);
const helloMediaCheck = await verifyVideoUrl(helloData.video_url);

console.log(
  JSON.stringify(
    {
      input: smokeUrl,
      aweme_id: v1.data.source.aweme_id,
      media_type: v1.data.media.type,
      video_url: v1.data.media.video_url,
      compat_text_status: compatTextResponse.status,
      compat_data_status: compatDataResponse.status,
      v1_status: v1Response.status,
      api_hello_status: helloResponse.status,
      media_check: mediaCheck,
      compat_text_video_url: compatVideoUrl,
      compat_text_media_check: compatTextMediaCheck,
      compat_data_video_url: compatData.video_url,
      compat_data_media_check: compatDataMediaCheck,
      api_hello_video_url: helloData.video_url,
      api_hello_media_check: helloMediaCheck,
    },
    null,
    2,
  ),
);
