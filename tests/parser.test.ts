import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { DouyinServiceError, getNoWatermarkUrl, parseDouyinHtml, parseDouyinUrl } from "../src/core/index.ts";
import { EMPTY_HTML, IMAGE_HTML, makeFailedFetcher, makeFixtureFetcher, VIDEO_HTML } from "./fixtures.ts";

describe("douyin parser", () => {
  it("parses video html into normalized and compat data", () => {
    const parsed = parseDouyinHtml(VIDEO_HTML, "https://www.douyin.com/video/7673000000000000001");

    expect(parsed.source.aweme_id).toBe("7673000000000000001");
    expect(parsed.author.nickname).toBe("作者A");
    expect(parsed.stats.digg_count).toBe(345);
    expect(parsed.content.created_at).toBe("2023-11-14T22:13:20.000Z");
    expect(parsed.media.type).toBe("video");
    expect(parsed.media.video_url).toBe(
      "https://aweme.snssdk.com/aweme/v1/play/?video_id=v0200fg10000abc123douyin&ratio=720p&line=0",
    );
    expect(parsed.media.cover_url).toBe("https://p3-sign.douyinpic.com/tos-cn-i-0813/cover.jpeg");
    expect(parsed.music).toMatchObject({ title: "示例背景音乐", author: "音乐作者" });
    expect(parsed.compat.cover_url).toBe(parsed.media.cover_url);
    expect(parsed.compat.music_title).toBe("示例背景音乐");
    expect(parsed.compat.type).toBe("video");
    expect(parsed.compat.image_url_list).toEqual([]);
  });

  it("parses image html with url decoding, de-duplication, and /obj/ filtering", () => {
    const parsed = parseDouyinHtml(IMAGE_HTML, "https://www.douyin.com/note/7673000000000000002");

    expect(parsed.media.type).toBe("image");
    expect(parsed.compat.type).toBe("img");
    expect(parsed.media.video_url).toBeNull();
    expect(parsed.media.image_url_list).toEqual([
      "https://p3-sign.douyinpic.com/tos-cn-i-0813/a.jpeg?x=1&y=2",
      "https://p11-sign.douyinpic.com/tos-cn-i-0813/b.jpeg",
    ]);
  });

  it("throws PARSE_FAILED for html without supported media", () => {
    expect(() => parseDouyinHtml(EMPTY_HTML)).toThrow(DouyinServiceError);
    try {
      parseDouyinHtml(EMPTY_HTML);
    } catch (error) {
      expect(error).toBeInstanceOf(DouyinServiceError);
      expect((error as DouyinServiceError).code).toBe("PARSE_FAILED");
    }
  });

  it("supports copied share text containing a douyin url", async () => {
    const parsed = await parseDouyinUrl("复制打开 https://v.douyin.com/abc123/ 看视频", {
      fetcher: makeFixtureFetcher(VIDEO_HTML),
    });

    expect(parsed.source.input_url).toContain("https://v.douyin.com/abc123/");
    expect(parsed.media.type).toBe("video");
  });

  it("keeps query parameters when extracting a copied long url", async () => {
    const calls: string[] = [];
    const fetcher = async (input: RequestInfo | URL) => {
      calls.push(input.toString());
      return new Response(
        JSON.stringify({
          status_code: 0,
          aweme_list: [
            {
              aweme_id: "7673000000000000001",
              video: {
                play_addr: {
                  url_list: ["https://v11.douyinvod.com/video/tos/example.mp4"],
                },
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    await parseDouyinUrl("复制打开 https://www.douyin.com/?modal_id=7673000000000000001&previous_page=app_code_link", {
      fetcher,
      validateMedia: false,
    });

    expect(calls[0]).toContain("aweme/v1/feed/");
    expect(calls[0]).toContain("aweme_id=7673000000000000001");
  });

  it("falls back to parsing direct note html when feed detail is unavailable", async () => {
    const parsed = await parseDouyinUrl("https://www.douyin.com/note/7673000000000000002", {
      fetcher: makeFixtureFetcher(IMAGE_HTML, "https://www.douyin.com/note/7673000000000000002"),
    });

    expect(parsed.source.aweme_id).toBe("7673000000000000002");
    expect(parsed.media.type).toBe("image");
    expect(parsed.media.image_url_list).toHaveLength(2);
  });

  it("solves ByteDance WAF proof-of-work before parsing note html fallback", async () => {
    const wafHtml = makeWafChallengeHtml("fixture-prefix", 0);
    const calls: string[] = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      calls.push(`${url} cookie=${new Headers(init?.headers).get("cookie") ?? ""}`);
      if (url.includes("aweme/v1/feed")) {
        return new Response(JSON.stringify({ status_code: 0, aweme_list: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (new Headers(init?.headers).get("cookie")?.includes("_wafchallengeid=")) {
        return new Response(IMAGE_HTML, { status: 200, headers: { "content-type": "text/html" } });
      }
      return new Response(wafHtml, { status: 200, headers: { "content-type": "text/html" } });
    };

    const parsed = await parseDouyinUrl("https://www.iesdouyin.com/share/note/7673000000000000002/", { fetcher });

    expect(calls.some((call) => call.includes("_wafchallengeid="))).toBe(true);
    expect(parsed.media.type).toBe("image");
    expect(parsed.media.image_url_list).toHaveLength(2);
  });

  it("rejects malformed or unsupported urls", async () => {
    await expect(parseDouyinUrl("not-a-url", { fetcher: makeFixtureFetcher(VIDEO_HTML) })).rejects.toMatchObject({
      code: "INVALID_URL",
    });
    await expect(parseDouyinUrl("https://example.com/demo", { fetcher: makeFixtureFetcher(VIDEO_HTML) })).rejects.toMatchObject({
      code: "INVALID_URL",
    });
  });

  it("maps upstream fetch failure to FETCH_FAILED", async () => {
    await expect(parseDouyinUrl("https://v.douyin.com/abc123/", { fetcher: makeFailedFetcher() })).rejects.toMatchObject({
      code: "FETCH_FAILED",
    });
  });

  it("returns video url through SDK helper", async () => {
    await expect(
      getNoWatermarkUrl("https://v.douyin.com/abc123/", { fetcher: makeFixtureFetcher(VIDEO_HTML) }),
    ).resolves.toBe("https://aweme.snssdk.com/aweme/v1/play/?video_id=v0200fg10000abc123douyin&ratio=720p&line=0");
  });
});

function makeWafChallengeHtml(prefix: string, solution: number): string {
  const prefixBase64 = Buffer.from(prefix).toString("base64");
  const expectBase64 = createHash("sha256")
    .update(prefix)
    .update(String(solution))
    .digest()
    .toString("base64");
  const challenge = Buffer.from(JSON.stringify({ v: { a: prefixBase64, b: Date.now(), c: expectBase64 }, s: "fixture" })).toString(
    "base64",
  );
  return `<script>function readygo(){var wci="_wafchallengeid",cs="${challenge}",c=JSON.parse(atob(cs));}</script>`;
}
