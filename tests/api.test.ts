import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { IMAGE_HTML, makeFixtureFetcher, VIDEO_HTML } from "./fixtures.ts";

const encodedUrl = encodeURIComponent("https://v.douyin.com/abc123/");

describe("api routes", () => {
  it("renders the Douyin-style UI on root without url", async () => {
    const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML) });
    const response = await app.request("/");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("抖音视频解析");
    expect(html).toContain('id="onlineCount"');
  });

  it("keeps /api/hello compatibility message when url is missing", async () => {
    const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML) });
    const response = await app.request("/api/hello");

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
        media: { type: "image", video_url: null, cover_url: "https://p3-sign.douyinpic.com/tos-cn-i-0813/a.jpeg?x=1&y=2" },
        music: { title: "图文音乐", author: "图文作者", cover_url: null, play_url: null },
        download: { video_proxy_url: null, download_url: null, filename: null },
      },
    });
    expect(body.data.media.image_url_list).toHaveLength(2);
    expect(body.data.compat.type).toBe("img");
    expect(Object.keys(body.data).sort()).toEqual(["author", "compat", "content", "download", "media", "music", "source", "stats"]);
    expect(Object.keys(body.data.source).sort()).toEqual(["aweme_id", "input_url", "resolved_url"]);
    expect(Object.keys(body.data.author).sort()).toEqual(["nickname", "signature"]);
    expect(Object.keys(body.data.stats).sort()).toEqual(["collect_count", "comment_count", "digg_count", "share_count"]);
    expect(Object.keys(body.data.content).sort()).toEqual(["create_timestamp", "created_at", "desc"]);
    expect(Object.keys(body.data.media).sort()).toEqual(["cover_url", "image_url_list", "type", "video_url"]);
    expect(Object.keys(body.data.music).sort()).toEqual(["author", "cover_url", "play_url", "title"]);
    expect(Object.keys(body.data.download).sort()).toEqual(["download_url", "filename", "video_proxy_url"]);
    expect(Object.keys(body.data.compat).sort()).toEqual([
      "aweme_id",
      "collect_count",
      "comment_count",
      "cover_url",
      "create_time",
      "desc",
      "digg_count",
      "image_url_list",
      "music_author",
      "music_title",
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

  it("adds same-origin preview and download proxy urls for v1 video", async () => {
    const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML) });
    const response = await app.request(`/api/v1/parse?url=${encodedUrl}`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.media.cover_url).toBe("https://p3-sign.douyinpic.com/tos-cn-i-0813/cover.jpeg");
    expect(body.data.music).toMatchObject({ title: "示例背景音乐", author: "音乐作者" });
    expect(body.data.download.filename).toBe("douyin-7673000000000000001.mp4");
    expect(body.data.download.video_proxy_url).toContain("/api/v1/media?url=");
    expect(body.data.download.download_url).toContain("/api/v1/download?url=");
  });

  it("uses forwarded https origin for generated proxy urls", async () => {
    const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML) });
    const response = await app.request(`/api/v1/parse?url=${encodedUrl}`, {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "dy.devforai.cn",
      },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.download.video_proxy_url).toMatch(/^https:\/\/dy\.devforai\.cn\/api\/v1\/media\?/);
    expect(body.data.download.download_url).toMatch(/^https:\/\/dy\.devforai\.cn\/api\/v1\/download\?/);
  });

  it("rejects unsupported media proxy hosts and watermark markers", async () => {
    const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML) });
    const unsupported = await app.request("/api/v1/media?url=https%3A%2F%2Fexample.com%2Fx.mp4");
    const watermarked = await app.request("/api/v1/media?url=https%3A%2F%2Fv1.douyinvod.com%2Fplaywm%2Fx.mp4");

    expect(unsupported.status).toBe(400);
    expect((await unsupported.json()).code).toBe("INVALID_URL");
    expect(watermarked.status).toBe(422);
    expect((await watermarked.json()).code).toBe("PARSE_FAILED");
  });

  it("tracks online pings", async () => {
    const app = createApp({ fetcher: makeFixtureFetcher(VIDEO_HTML), onlineBaseCount: 2 });
    const response = await app.request("/api/v1/online/ping", {
      method: "POST",
      body: JSON.stringify({ client_id: "client-a" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ client_id: "client-a", active_connections: 1, online_count: 3, base_count: 2 });
  });
});
