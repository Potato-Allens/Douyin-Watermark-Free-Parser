import { describe, expect, it } from "vitest";
import { collectDouyinComments, fetchDouyinCommentReplies } from "../src/core/index.ts";

describe("incremental comment collection", () => {
  it("paginates top-level comments and second-level replies with stable hierarchy", async () => {
    const calls: string[] = [];
    const fetcher = async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      calls.push(url.toString());
      if (url.pathname.includes("/comment/list/reply/")) {
        const parent = url.searchParams.get("comment_id");
        const cursor = Number(url.searchParams.get("cursor") ?? 0);
        const comments =
          parent === "c1" && cursor === 0
            ? [{ cid: "r1", text: "第一条二级回复", user: { nickname: "回复者A" }, reply_to_username: "用户A" }]
            : parent === "c2" && cursor === 0
              ? [{ cid: "r2", text: "第二条二级回复", user: { nickname: "回复者B" } }]
              : [];
        return new Response(JSON.stringify({ status_code: 0, cursor: cursor + comments.length, has_more: 0, total: comments.length, comments }));
      }
      if (url.pathname.includes("/comment/list/")) {
        const cursor = Number(url.searchParams.get("cursor") ?? 0);
        if (cursor === 0) {
          return new Response(
            JSON.stringify({
              status_code: 0,
              cursor: 2,
              has_more: 1,
              total: 3,
              comments: [
                { cid: "c1", text: "一级一", reply_comment_total: 1, user: { nickname: "用户A" } },
                { cid: "c2", text: "一级二", reply_comment_total: 1, user: { nickname: "用户B" } },
              ],
            }),
          );
        }
        return new Response(
          JSON.stringify({
            status_code: 0,
            cursor: 3,
            has_more: 0,
            total: 3,
            comments: [{ cid: "c3", text: "一级三", reply_comment_total: 0, user: { nickname: "用户C" } }],
          }),
        );
      }
      return new Response("not found", { status: 404 });
    };

    const snapshots: number[] = [];
    const result = await collectDouyinComments("7673000000000000001", {
      fetcher,
      mode: "all",
      targetTopLevelCount: 100,
      pageSize: 2,
      replyPageSize: 20,
      delayMs: 0,
      onProgress: (progress) => {
        snapshots.push(progress.collected_count);
      },
    });

    expect(result.stopped_reason).toBe("completed");
    expect(result.top_level_count).toBe(3);
    expect(result.reply_count).toBe(2);
    expect(result.comments).toHaveLength(5);
    expect(result.comments.find((comment) => comment.cid === "r1")).toMatchObject({
      level: 2,
      parent_cid: "c1",
      reply_to_nickname: "用户A",
    });
    expect(calls.filter((url) => url.includes("/comment/list/reply/")).length).toBe(2);
    expect(snapshots.at(-1)).toBe(5);
  });

  it("exposes reply pagination as a standalone SDK function", async () => {
    const result = await fetchDouyinCommentReplies("7673000000000000001", "comment-root", {
      fetcher: async (input) => {
        const url = new URL(String(input));
        expect(url.searchParams.get("item_id")).toBe("7673000000000000001");
        expect(url.searchParams.get("comment_id")).toBe("comment-root");
        return new Response(
          JSON.stringify({ status_code: 0, cursor: 1, has_more: 0, total: 1, comments: [{ cid: "reply-1", text: "回复内容", user: { nickname: "回复者" } }] }),
        );
      },
    });
    expect(result.comments[0]).toMatchObject({ cid: "reply-1", level: 2, parent_cid: "comment-root" });
  });
});
