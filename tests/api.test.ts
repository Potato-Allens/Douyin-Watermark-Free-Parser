import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { IMAGE_HTML, makeFixtureFetcher, VIDEO_HTML } from "./fixtures.ts";

const encodedUrl = encodeURIComponent("https://v.douyin.com/abc123/");

describe("api routes", () => {
  it("returns exact compatibility message when url is missing", async () => {
    const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML) });
    const response = await app.request("/");

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("请提供url参数");
  });

  it("returns plain text no-watermark url on compatibility endpoint", async () => {
    const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML) });
    const response = await app.request(`/?url=${encodedUrl}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe(
      "https://aweme.snssdk.com/aweme/v1/play/?video_id=v0200fg10000abc123douyin&ratio=720p&line=0",
    );
  });

  it("returns bare compat json when data parameter is present", async () => {
    const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML) });
    const response = await app.request(`/?data&url=${encodedUrl}`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      aweme_id: "7673000000000000001",
      digg_count: 345,
      nickname: "作者A",
      type: "video",
    });
    expect(body.ok).toBeUndefined();
  });

  it("keeps /api/hello compatible with root", async () => {
    const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML) });
    const root = await app.request(`/?data&url=${encodedUrl}`);
    const hello = await app.request(`/api/hello?data&url=${encodedUrl}`);

    expect(await hello.text()).toBe(await root.text());
  });

  it("returns normalized v1 schema", async () => {
    const app = createApp({ fetcher: makeFixtureFetcher(IMAGE_HTML) });
    const response = await app.request(`/api/v1/parse?url=${encodedUrl}`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      code: "OK",
      message: "success",
      data: {
        source: { aweme_id: "7673000000000000002" },
        author: { nickname: "作者B", signature: "签名B" },
        stats: { comment_count: 1, digg_count: 2, share_count: 3, collect_count: 4 },
        content: { desc: "示例图文标题", create_timestamp: 1710000000 },
        media: { type: "image", video_url: null },
      },
    });
    expect(body.data.media.image_url_list).toHaveLength(2);
    expect(body.data.compat.type).toBe("img");
    expect(Object.keys(body.data).sort()).toEqual(["author", "compat", "content", "media", "source", "stats"]);
    expect(Object.keys(body.data.source).sort()).toEqual(["aweme_id", "input_url", "resolved_url"]);
    expect(Object.keys(body.data.author).sort()).toEqual(["nickname", "signature"]);
    expect(Object.keys(body.data.stats).sort()).toEqual(["collect_count", "comment_count", "digg_count", "share_count"]);
    expect(Object.keys(body.data.content).sort()).toEqual(["create_timestamp", "created_at", "desc"]);
    expect(Object.keys(body.data.media).sort()).toEqual(["image_url_list", "type", "video_url"]);
    expect(Object.keys(body.data.compat).sort()).toEqual([
      "aweme_id",
      "collect_count",
      "comment_count",
      "create_time",
      "desc",
      "digg_count",
      "image_url_list",
      "nickname",
      "share_count",
      "signature",
      "type",
      "video_url",
    ]);
  });

  it("returns normalized v1 error response", async () => {
    const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML) });
    const response = await app.request("/api/v1/parse");
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      ok: false,
      code: "MISSING_URL",
      message: "url query parameter is required",
      error: { detail: "" },
    });
  });
});
