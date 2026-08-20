import type { BatchComment } from "./batch.ts";

export interface StoredComment extends BatchComment {
  aweme_id: string;
}

export interface StoredCommentQuery {
  awemeId?: string | null;
  keyword?: string | null;
  offset?: number;
  limit?: number;
  cids?: Iterable<string> | null;
}

export interface StoredCommentPage {
  total: number;
  filtered_count: number;
  offset: number;
  limit: number;
  has_more: boolean;
  comments: StoredComment[];
}

const records = new Map<string, Map<string, StoredComment>>();
const loaded = new Set<string>();
const writeTails = new Map<string, Promise<void>>();

export async function appendStoredComments(taskId: string, awemeId: string, comments: BatchComment[]): Promise<number> {
  await ensureLoaded(taskId);
  const bucket = records.get(taskId) ?? new Map<string, StoredComment>();
  records.set(taskId, bucket);
  const added: StoredComment[] = [];
  for (const comment of comments) {
    const key = commentKey(awemeId, comment.cid);
    if (bucket.has(key)) continue;
    const value = { ...comment, aweme_id: awemeId };
    bucket.set(key, value);
    added.push(value);
  }
  if (added.length > 0) await appendToDisk(taskId, added);
  return added.length;
}

export async function listStoredComments(taskId: string, query: StoredCommentQuery = {}): Promise<StoredCommentPage> {
  await ensureLoaded(taskId);
  const all = [...(records.get(taskId)?.values() ?? [])];
  const keyword = normalizeKeyword(query.keyword);
  const cidSet = query.cids ? new Set(query.cids) : null;
  const matched = all.filter((comment) => {
    if (query.awemeId && comment.aweme_id !== query.awemeId) return false;
    if (cidSet && !cidSet.has(comment.cid)) return false;
    if (!keyword) return true;
    return [comment.nickname, comment.reply_to_nickname, comment.text, comment.cid]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase("zh-CN").includes(keyword));
  });
  const offset = Math.max(0, Math.floor(query.offset ?? 0));
  const limit = Math.min(1_000, Math.max(1, Math.floor(query.limit ?? 100)));
  return {
    total: all.filter((comment) => !query.awemeId || comment.aweme_id === query.awemeId).length,
    filtered_count: matched.length,
    offset,
    limit,
    has_more: offset + limit < matched.length,
    comments: matched.slice(offset, offset + limit),
  };
}

export async function getAllStoredComments(taskId: string, query: Omit<StoredCommentQuery, "offset" | "limit"> = {}): Promise<StoredComment[]> {
  await ensureLoaded(taskId);
  const page = await listStoredComments(taskId, { ...query, offset: 0, limit: 1_000 });
  if (!page.has_more) return page.comments;
  const result = [...page.comments];
  for (let offset = page.limit; offset < page.filtered_count; offset += 1_000) {
    const next = await listStoredComments(taskId, { ...query, offset, limit: 1_000 });
    result.push(...next.comments);
  }
  return result;
}

export async function countStoredComments(taskId: string, awemeId?: string | null): Promise<number> {
  await ensureLoaded(taskId);
  if (!awemeId) return records.get(taskId)?.size ?? 0;
  let count = 0;
  for (const comment of records.get(taskId)?.values() ?? []) if (comment.aweme_id === awemeId) count += 1;
  return count;
}

async function ensureLoaded(taskId: string): Promise<void> {
  if (loaded.has(taskId)) return;
  loaded.add(taskId);
  const bucket = new Map<string, StoredComment>();
  records.set(taskId, bucket);
  if (!isNodeRuntime()) return;
  try {
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(commentFilePath(taskId), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const value = JSON.parse(line) as StoredComment;
        if (!value?.aweme_id || !value?.cid || !value?.text) continue;
        bucket.set(commentKey(value.aweme_id, value.cid), value);
      } catch {
        // A partial final line is ignored; previous complete JSONL records remain usable.
      }
    }
  } catch {
    // Missing comment files represent an empty collection.
  }
}

async function appendToDisk(taskId: string, comments: StoredComment[]): Promise<void> {
  if (!isNodeRuntime()) return;
  const previous = writeTails.get(taskId) ?? Promise.resolve();
  const next = previous.then(async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const filePath = commentFilePath(taskId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const payload = comments.map((comment) => JSON.stringify(comment)).join("\n") + "\n";
    await fs.appendFile(filePath, payload, "utf8");
  });
  writeTails.set(taskId, next);
  try {
    await next;
  } finally {
    if (writeTails.get(taskId) === next) writeTails.delete(taskId);
  }
}

function commentFilePath(taskId: string): string {
  const base = getEnv().COMMENT_STORE_DIR ?? ".data/comments";
  return `${base}/${taskId.replace(/[^a-zA-Z0-9_-]/g, "_")}.jsonl`;
}

function commentKey(awemeId: string, cid: string): string {
  return `${awemeId}:${cid}`;
}

function normalizeKeyword(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().slice(0, 200).toLocaleLowerCase("zh-CN") : "";
}

function isNodeRuntime(): boolean {
  return Boolean((globalThis as any).process?.versions?.node);
}

function getEnv(): Record<string, string | undefined> {
  return ((globalThis as any).process?.env ?? {}) as Record<string, string | undefined>;
}
