import { DouyinServiceError } from "./errors.ts";
import { inspectDouyinProfile, type ProfileInspectOptions, type ProfileInspectResult } from "./profile.ts";
import type { ParsedDouyinInfo } from "./types.ts";
import type { AiCopyResult } from "./creator.ts";

export type BatchItemStatus = "pending" | "running" | "success" | "failed";
export type BatchTaskStatus = "queued" | "running" | "completed" | "failed";

export interface BatchItem {
  aweme_id: string;
  status: BatchItemStatus;
  title: string | null;
  author_nickname: string | null;
  cover_url: string | null;
  video_url: string | null;
  download_url: string | null;
  music_title: string | null;
  music_author: string | null;
  stats: {
    comment_count: number | null;
    digg_count: number | null;
    share_count: number | null;
    collect_count: number | null;
  };
  ai_copy: AiCopyResult | null;
  comments: BatchComment[];
  error: string | null;
}

export interface BatchComment {
  cid: string;
  nickname: string | null;
  text: string;
  digg_count: number | null;
  create_time: string | null;
}

export interface BatchTask {
  id: string;
  homepage_url: string;
  owner_key: string | null;
  requested_count: number;
  concurrency: number;
  queue_priority: number;
  queue_position: number;
  total_detected: number | null;
  status: BatchTaskStatus;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  completed_count: number;
  success_count: number;
  failed_count: number;
  items: BatchItem[];
}

export interface BatchStartOptions {
  homepageUrl: string;
  count: number;
  concurrency: number;
  parseOptions?: ProfileInspectOptions;
  parseByAwemeId: (awemeId: string) => Promise<ParsedDouyinInfo>;
  makeDownloadUrl: (parsed: ParsedDouyinInfo) => string | null;
  ownerKey?: string | null;
  queuePriority?: number;
  maxActiveTasks?: number;
  maxGlobalConcurrency?: number;
}

export interface BatchQueueSnapshot {
  active_tasks: number;
  queued_tasks: number;
  max_active_tasks: number;
  max_global_concurrency: number;
  tasks: Array<{
    id: string;
    status: BatchTaskStatus;
    queue_priority: number;
    queue_position: number;
    owner_key: string | null;
    requested_count: number;
    completed_count: number;
    created_at: string;
    updated_at: string;
  }>;
}

const tasks = new Map<string, BatchTask>();
const executions = new Map<string, BatchStartOptions>();
let tasksLoaded = false;
let persistTail = Promise.resolve();
let activeTaskCount = 0;
let schedulerScheduled = false;

export async function inspectBatchHomepage(homepageUrl: string, options: ProfileInspectOptions = {}): Promise<ProfileInspectResult> {
  return await inspectDouyinProfile(homepageUrl, options);
}

export async function startBatchTask(options: BatchStartOptions): Promise<BatchTask> {
  await loadPersistedTasks();
  const inspect = await inspectDouyinProfile(options.homepageUrl, { ...(options.parseOptions ?? {}), maxItems: options.count });
  if (inspect.aweme_ids.length === 0) {
    throw new DouyinServiceError("PARSE_FAILED", "profile works list did not expose video ids for batch parsing");
  }
  const maxGlobalConcurrency = getMaxGlobalConcurrency(options);
  const concurrency = clamp(Math.floor(options.concurrency || 3), 1, Math.max(1, maxGlobalConcurrency));
  const requestedCount = clamp(Math.floor(options.count || 1), 1, inspect.aweme_ids.length);
  const selected = inspect.aweme_ids.slice(0, requestedCount);
  const now = new Date().toISOString();
  const task: BatchTask = {
    id: randomId(),
    homepage_url: options.homepageUrl,
    owner_key: normalizeOwnerKey(options.ownerKey),
    requested_count: requestedCount,
    concurrency,
    queue_priority: normalizePriority(options.queuePriority),
    queue_position: 0,
    total_detected: inspect.total_count,
    status: "queued",
    created_at: now,
    updated_at: now,
    started_at: null,
    finished_at: null,
    completed_count: 0,
    success_count: 0,
    failed_count: 0,
    items: selected.map(createEmptyBatchItem),
  };
  tasks.set(task.id, task);
  executions.set(task.id, options);
  updateQueuePositions();
  await persistTasks();
  scheduleQueue();
  return task;
}

export async function getBatchTask(taskId: string): Promise<BatchTask | null> {
  await loadPersistedTasks();
  return tasks.get(taskId) ?? null;
}

export async function saveBatchTask(task: BatchTask): Promise<void> {
  await loadPersistedTasks();
  tasks.set(task.id, task);
  await persistTasks();
}

export async function getBatchQueueSnapshot(): Promise<BatchQueueSnapshot> {
  await loadPersistedTasks();
  updateQueuePositions();
  return {
    active_tasks: activeTaskCount,
    queued_tasks: [...tasks.values()].filter((task) => task.status === "queued").length,
    max_active_tasks: getMaxActiveTasks(),
    max_global_concurrency: getMaxGlobalConcurrency(),
    tasks: [...tasks.values()]
      .filter((task) => task.status === "queued" || task.status === "running")
      .sort(compareQueueTasks)
      .map((task) => ({
        id: task.id,
        status: task.status,
        queue_priority: task.queue_priority,
        queue_position: task.queue_position,
        owner_key: task.owner_key,
        requested_count: task.requested_count,
        completed_count: task.completed_count,
        created_at: task.created_at,
        updated_at: task.updated_at,
      })),
  };
}

function scheduleQueue(): void {
  if (schedulerScheduled) return;
  schedulerScheduled = true;
  queueMicrotask(() => {
    schedulerScheduled = false;
    drainQueue();
  });
}

function drainQueue(): void {
  const maxActiveTasks = getMaxActiveTasks();
  updateQueuePositions();
  while (activeTaskCount < maxActiveTasks) {
    const next = [...tasks.values()]
      .filter((task) => task.status === "queued" && executions.has(task.id))
      .sort(compareQueueTasks)[0];
    if (!next) break;
    const options = executions.get(next.id);
    if (!options) break;
    activeTaskCount += 1;
    next.status = "running";
    next.queue_position = 0;
    next.started_at ??= new Date().toISOString();
    touch(next);
    void runTask(next, options)
      .catch((error) => {
        next.status = "failed";
        next.items
          .filter((item) => item.status === "pending" || item.status === "running")
          .forEach((item) => {
            item.status = "failed";
            item.error = error instanceof Error ? error.message : String(error);
          });
        next.failed_count = next.items.filter((item) => item.status === "failed").length;
        next.completed_count = next.items.filter((item) => item.status === "success" || item.status === "failed").length;
        next.finished_at = new Date().toISOString();
        touch(next);
      })
      .finally(() => {
        executions.delete(next.id);
        activeTaskCount = Math.max(0, activeTaskCount - 1);
        updateQueuePositions();
        schedulePersist();
        scheduleQueue();
      });
  }
}

function updateQueuePositions(): void {
  const queued = [...tasks.values()].filter((task) => task.status === "queued").sort(compareQueueTasks);
  queued.forEach((task, index) => {
    task.queue_position = index + 1;
  });
  for (const task of tasks.values()) {
    if (task.status !== "queued") task.queue_position = 0;
  }
}

function compareQueueTasks(a: BatchTask, b: BatchTask): number {
  if (b.queue_priority !== a.queue_priority) return b.queue_priority - a.queue_priority;
  return a.created_at.localeCompare(b.created_at);
}

async function runTask(task: BatchTask, options: BatchStartOptions): Promise<void> {
  task.status = "running";
  task.queue_position = 0;
  task.started_at ??= new Date().toISOString();
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
        item.author_nickname = parsed.author.nickname;
        item.cover_url = parsed.media.cover_url;
        item.video_url = parsed.media.video_url;
        item.download_url = options.makeDownloadUrl(parsed);
        item.music_title = parsed.music.title;
        item.music_author = parsed.music.author;
        item.stats = { ...parsed.stats };
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
  task.finished_at = new Date().toISOString();
  touch(task);
}

function touch(task: BatchTask): void {
  task.updated_at = new Date().toISOString();
  schedulePersist();
}

function createEmptyBatchItem(awemeId: string): BatchItem {
  return {
    aweme_id: awemeId,
    status: "pending",
    title: null,
    author_nickname: null,
    cover_url: null,
    video_url: null,
    download_url: null,
    music_title: null,
    music_author: null,
    stats: { comment_count: null, digg_count: null, share_count: null, collect_count: null },
    ai_copy: null,
    comments: [],
    error: null,
  };
}

async function loadPersistedTasks(): Promise<void> {
  if (tasksLoaded) return;
  tasksLoaded = true;
  if (!isNodeRuntime()) return;
  try {
    const fs = await import("node:fs/promises");
    const filePath = getPersistFilePath();
    const raw = await fs.readFile(filePath, "utf8");
    const values = JSON.parse(raw) as unknown;
    if (!Array.isArray(values)) return;
    for (const value of values) {
      const task = normalizeTask(value);
      if (task) tasks.set(task.id, task);
    }
  } catch {
    // Missing or unreadable persistence file is treated as an empty task store.
  }
}

function schedulePersist(): void {
  if (!tasksLoaded || !isNodeRuntime()) return;
  persistTail = persistTail.then(persistTasks, persistTasks);
}

async function persistTasks(): Promise<void> {
  if (!isNodeRuntime()) return;
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const filePath = getPersistFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const payload = JSON.stringify([...tasks.values()].slice(-200), null, 2);
  await fs.writeFile(filePath, payload, "utf8");
}

function normalizeTask(value: unknown): BatchTask | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, any>;
  const id = typeof record.id === "string" ? record.id : "";
  if (!id) return null;
  const items = Array.isArray(record.items) ? record.items.map(normalizeItem).filter(isPresent) : [];
  const completedCount = Number(record.completed_count ?? items.filter((item) => item.status === "success" || item.status === "failed").length);
  const successCount = Number(record.success_count ?? items.filter((item) => item.status === "success").length);
  const failedCount = Number(record.failed_count ?? items.filter((item) => item.status === "failed").length);
  let status = (record.status === "queued" || record.status === "running" || record.status === "completed" || record.status === "failed" ? record.status : "completed") as BatchTaskStatus;
  if (status === "queued" || status === "running") status = "failed";
  return {
    id,
    homepage_url: String(record.homepage_url ?? ""),
    owner_key: nullableString(record.owner_key),
    requested_count: Number(record.requested_count ?? items.length),
    concurrency: Number(record.concurrency ?? 1),
    queue_priority: nullableNumber(record.queue_priority) ?? 0,
    queue_position: 0,
    total_detected: record.total_detected === null || record.total_detected === undefined ? null : Number(record.total_detected),
    status,
    created_at: typeof record.created_at === "string" ? record.created_at : new Date().toISOString(),
    updated_at: typeof record.updated_at === "string" ? record.updated_at : new Date().toISOString(),
    started_at: nullableString(record.started_at),
    finished_at: nullableString(record.finished_at) ?? (status === "completed" || status === "failed" ? (typeof record.updated_at === "string" ? record.updated_at : new Date().toISOString()) : null),
    completed_count: completedCount,
    success_count: successCount,
    failed_count: failedCount,
    items: items as BatchItem[],
  };
}

function normalizeItem(value: unknown): BatchItem | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, any>;
  const awemeId = typeof record.aweme_id === "string" ? record.aweme_id : "";
  if (!awemeId) return null;
  const item = createEmptyBatchItem(awemeId);
  item.status = record.status === "pending" || record.status === "running" || record.status === "success" || record.status === "failed" ? record.status : item.status;
  item.title = nullableString(record.title);
  item.author_nickname = nullableString(record.author_nickname);
  item.cover_url = nullableString(record.cover_url);
  item.video_url = nullableString(record.video_url);
  item.download_url = nullableString(record.download_url);
  item.music_title = nullableString(record.music_title);
  item.music_author = nullableString(record.music_author);
  item.stats = {
    comment_count: nullableNumber(record.stats?.comment_count),
    digg_count: nullableNumber(record.stats?.digg_count),
    share_count: nullableNumber(record.stats?.share_count),
    collect_count: nullableNumber(record.stats?.collect_count),
  };
  item.ai_copy = record.ai_copy && typeof record.ai_copy === "object" ? (record.ai_copy as AiCopyResult) : null;
  item.comments = Array.isArray(record.comments) ? record.comments.map(normalizeComment).filter(isPresent) : [];
  item.error = nullableString(record.error);
  return item;
}

function normalizeComment(value: unknown): BatchComment | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, any>;
  const text = nullableString(record.text);
  if (!text) return null;
  return {
    cid: nullableString(record.cid) ?? randomId(),
    nickname: nullableString(record.nickname),
    text,
    digg_count: nullableNumber(record.digg_count),
    create_time: nullableString(record.create_time),
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function nullableNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function getPersistFilePath(): string {
  return getEnv().BATCH_STORE_FILE ?? ".data/batch-tasks.json";
}

function getMaxActiveTasks(): number {
  return clamp(readEnvInt("BATCH_MAX_ACTIVE_TASKS", 2), 1, 20);
}

function getMaxGlobalConcurrency(options?: BatchStartOptions): number {
  return clamp(Math.floor(options?.maxGlobalConcurrency ?? readEnvInt("BATCH_MAX_GLOBAL_CONCURRENCY", 4)), 1, 20);
}

function readEnvInt(key: string, fallback: number): number {
  const value = Number.parseInt(getEnv()[key] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeOwnerKey(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : null;
}

function normalizePriority(value: unknown): number {
  const priority = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(priority) ? clamp(Math.floor(priority), 0, 1000) : 0;
}

function getEnv(): Record<string, string | undefined> {
  return ((globalThis as any).process?.env ?? {}) as Record<string, string | undefined>;
}

function isNodeRuntime(): boolean {
  return Boolean((globalThis as any).process?.versions?.node);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
