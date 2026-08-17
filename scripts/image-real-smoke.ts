import { createApp } from "../src/app.ts";

const smokeUrl = process.env.SMOKE_DOUYIN_IMAGE_URL ?? "https://www.douyin.com/note/7188492958054829327";
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

async function verifyImageUrl(url: string) {
  assert(url.startsWith("http://") || url.startsWith("https://"), `image url is not absolute: ${url}`);
  assert(!url.includes("/obj/"), `image url contains filtered /obj/ path: ${url}`);
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
      Range: "bytes=0-2047",
      Accept: "image/*,*/*",
    },
    redirect: "follow",
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "";
  assert([200, 206].includes(response.status), `image range status must be 200/206, got ${response.status}`);
  assert(contentType.includes("image"), `image content type invalid: ${contentType}`);
  assert(bytes.length > 0, "image range returned empty body");
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
assert(v1.data?.media?.type === "image", `v1 media.type must be image, got ${v1.data?.media?.type}`);
assert(Array.isArray(v1.data?.media?.image_url_list), "v1 media.image_url_list missing");
assert(v1.data.media.image_url_list.length > 0, "v1 image_url_list is empty");
assert(new Set(v1.data.media.image_url_list).size === v1.data.media.image_url_list.length, "v1 image_url_list contains duplicates");
const mediaChecks = [];
for (const imageUrl of v1.data.media.image_url_list) mediaChecks.push(await verifyImageUrl(imageUrl));

const compatDataResponse = await app.request(`/?data&url=${encoded}`);
const compatData = await readJson(compatDataResponse);
assert(compatDataResponse.status === 200, `compat data status must be 200, got ${compatDataResponse.status}`);
assert(compatData.aweme_id === v1.data.source.aweme_id, "compat data aweme_id differs from v1");
assert(compatData.type === "img", `compat type must be img, got ${compatData.type}`);
assert(Array.isArray(compatData.image_url_list) && compatData.image_url_list.length === v1.data.media.image_url_list.length, "compat image list mismatch");

const helloResponse = await app.request(`/api/hello?data&url=${encoded}`);
const helloData = await readJson(helloResponse);
assert(helloResponse.status === 200, `api/hello status must be 200, got ${helloResponse.status}`);
assert(helloData.aweme_id === compatData.aweme_id, "api/hello aweme_id differs from root compat data");
assert(helloData.type === "img", `api/hello type must be img, got ${helloData.type}`);

const compatTextResponse = await app.request(`/?url=${encoded}`);
const compatText = await compatTextResponse.text();
assert(compatTextResponse.status === 415, `compat text image status must be 415, got ${compatTextResponse.status}: ${compatText}`);

console.log(
  JSON.stringify(
    {
      input: smokeUrl,
      aweme_id: v1.data.source.aweme_id,
      media_type: v1.data.media.type,
      image_count: v1.data.media.image_url_list.length,
      compat_text_status: compatTextResponse.status,
      compat_data_status: compatDataResponse.status,
      v1_status: v1Response.status,
      api_hello_status: helloResponse.status,
      first_image_url: v1.data.media.image_url_list[0],
      media_checks: mediaChecks,
    },
    null,
    2,
  ),
);
