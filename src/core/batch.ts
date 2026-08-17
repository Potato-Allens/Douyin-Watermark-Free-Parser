import { DouyinServiceError } from "./errors.ts";
import { inspectDouyinProfile, type ProfileInspectResult } from "./profile.ts";
import type { ParseOptions, ParsedDouyinInfo } from "./types.ts";

export type BatchItemStatus = "pending" | "running" | "success" | "failed";
export type BatchTaskStatus = "queued" | "running" | "completed" | "failed";

export interface BatchItem {
  aweme_id: string;
  status: BatchItemStatus;
  title: string | null;
  cover_url: string | null;
  video_url: string | null;
  download_url: string | null;
  error: string | null;
}

export interface BatchTask {
  id: string;
  homepage_url: string;
  requested_count: number;
  concurrency: number;
  total_detected: number | null;
  status: BatchTaskStatus;
  created_at: string;
  updated_at: string;
  completed_count: number;
  success_count: number;
  failed_count: number;
  items: BatchItem[];
}

export interface BatchStartOptions {
  homepageUrl: string;
  count: number;
  concurrency: number;
  parseOptions?: ParseOptions;
  parseByAwemeId: (awemeId: string) => Promise<ParsedDouyinInfo>;
  makeDownloadUrl: (parsed: ParsedDouyinInfo) => string | null;
}

const tasks = new Map<string, BatchTask>();

export async function inspectBatchHomepage(homepageUrl: string, options: ParseOptions = {}): Promise<ProfileInspectResult> {
  return await inspectDouyinProfile(homepageUrl, options);
}

export async function startBatchTask(options: BatchStartOptions): Promise<BatchTask> {
  const inspect = await inspectDouyinProfile(options.homepageUrl, options.parseOptions ?? {});
  if (inspect.aweme_ids.length === 0) {
    throw new DouyinServiceError("PARSE_FAILED", "profile works list did not expose video ids for batch parsing");
  }
  const concurrency = clamp(Math.floor(options.concurrency || 3), 1, 5);
  const requestedCount = clamp(Math.floor(options.count || 1), 1, inspect.aweme_ids.length);
  const selected = inspect.aweme_ids.slice(0, requestedCount);
  const now = new Date().toISOString();
  const task: BatchTask = {
    id: randomId(),
    homepage_url: options.homepageUrl,
    requested_count: requestedCount,
    concurrency,
    total_detected: inspect.total_count,
    status: "queued",
    created_at: now,
    updated_at: now,
    completed_count: 0,
    success_count: 0,
    failed_count: 0,
    items: selected.map((awemeId) => ({ aweme_id: awemeId, status: "pending", title: null, cover_url: null, video_url: null, download_url: null, error: null })),
  };
  tasks.set(task.id, task);
  void runTask(task, options);
  return task;
}

export function getBatchTask(taskId: string): BatchTask | null {
  return tasks.get(taskId) ?? null;
}

async function runTask(task: BatchTask, options: BatchStartOptions): Promise<void> {
  task.status = "running";
  touch(task);
  let cursor = 0;
  const workers = Array.from({ length: task.concurrency }, async () => {
    while (cursor < task.items.length) {
      const item = task.items[cursor++];
      if (!item) continue;
      item.status = "running";
      touch(task);
      try {
        const parsed = await options.parseByAwemeId(item.aweme_id);
        if (parsed.media.type !== "video" || !parsed.media.video_url) {
          throw new DouyinServiceError("UNSUPPORTED_CONTENT", "work is not a video");
        }
        item.status = "success";
        item.title = parsed.content.desc;
        item.cover_url = parsed.media.cover_url;
        item.video_url = parsed.media.video_url;
        item.download_url = options.makeDownloadUrl(parsed);
      } catch (error) {
        item.status = "failed";
        item.error = error instanceof Error ? error.message : String(error);
      } finally {
        task.completed_count += 1;
        task.success_count = task.items.filter((entry) => entry.status === "success").length;
        task.failed_count = task.items.filter((entry) => entry.status === "failed").length;
        touch(task);
      }
    }
  });
  await Promise.all(workers);
  task.status = task.failed_count === task.items.length ? "failed" : "completed";
  touch(task);
}

function touch(task: BatchTask): void {
  task.updated_at = new Date().toISOString();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
