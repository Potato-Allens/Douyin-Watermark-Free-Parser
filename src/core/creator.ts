import { DouyinServiceError } from "./errors.ts";
import type { FetchLike, ParsedDouyinInfo } from "./types.ts";

type DatabaseSync = any;

export interface LlmSettings {
  base_url: string;
  api_key_masked: string | null;
  model: string | null;
  timeout_ms: number;
  max_tokens: number;
  temperature: number;
  enabled: boolean;
  updated_at: string | null;
}

export interface LlmSettingsInput {
  base_url?: string;
  api_key?: string;
  model?: string;
  timeout_ms?: number;
  max_tokens?: number;
  temperature?: number;
  enabled?: boolean;
}

export interface AiCopyResult {
  provider: "xiaomi" | "local_template";
  mode: string;
  title: string;
  transcript: string;
  rewritten_script: string;
  description: string;
  tags: string[];
  prompt: string | null;
  source_aweme_id: string | null;
}

export interface UsageLogInput {
  kind: string;
  user_key: string;
  ip: string;
  path: string;
  status: number;
  detail?: string | null;
}

export interface AuditLogInput {
  actor: string;
  action: string;
  ip: string;
  detail?: string | null;
}

export interface CreatorStore {
  getLlmSettings(): Promise<LlmSettings>;
  getRawApiKey(): Promise<string | null>;
  saveLlmSettings(input: LlmSettingsInput): Promise<LlmSettings>;
  recordUsage(input: UsageLogInput): Promise<void>;
  recordAudit(input: AuditLogInput): Promise<void>;
  getMetrics(): Promise<Record<string, number>>;
}

const DEFAULT_LLM_SETTINGS: Omit<LlmSettings, "updated_at"> = {
  base_url: "https://token-plan-cn.xiaomimimo.com/v1",
  api_key_masked: null,
  model: null,
  timeout_ms: 30_000,
  max_tokens: 900,
  temperature: 0.75,
  enabled: false,
};

let creatorSingleton: Promise<CreatorStore> | null = null;

export function getCreatorStore(): Promise<CreatorStore> {
  creatorSingleton ??= createCreatorStore();
  return creatorSingleton;
}

export function createTranscriptDraft(parsed: ParsedDouyinInfo): string {
  const title = parsed.content.desc ?? "未解析到标题";
  const author = parsed.author.nickname ? `作者：${parsed.author.nickname}` : "作者未解析";
  const music = [parsed.music.title, parsed.music.author].filter(Boolean).join(" - ");
  const stats = [
    parsed.stats.digg_count !== null ? `点赞 ${parsed.stats.digg_count}` : null,
    parsed.stats.comment_count !== null ? `评论 ${parsed.stats.comment_count}` : null,
    parsed.stats.share_count !== null ? `转发 ${parsed.stats.share_count}` : null,
  ]
    .filter(Boolean)
    .join("，");
  return [
    `开场：围绕“${title}”快速抓住注意力。`,
    `主体：用第一人称或旁白方式展开内容，保留原视频的情绪、节奏和核心信息。`,
    `素材：${author}${music ? `，背景音乐：${music}` : ""}${stats ? `，互动数据：${stats}` : ""}。`,
    "结尾：补一句自然的互动引导，让观众评论、收藏或继续观看。",
  ].join("\n");
}

export function makeLocalAiCopy(parsed: ParsedDouyinInfo, prompt: string | null, mode = "rewrite"): AiCopyResult {
  const baseTitle = parsed.content.desc ?? "短视频内容";
  const transcript = createTranscriptDraft(parsed);
  const topic = trimText(baseTitle.replace(/[#@].*$/g, ""), 36) || "这个视频";
  const custom = prompt ? `\n改写要求：${prompt}` : "";
  return {
    provider: "local_template",
    mode,
    title: `${topic}｜高互动短视频标题`,
    transcript,
    rewritten_script: [
      `你有没有发现，${topic}这类内容之所以容易被记住，是因为它开头就把情绪拉满。`,
      "前几秒先抛出一个明确场景，再用一句自然的解释承接，让观众知道为什么要继续看。",
      "中段保留原视频的核心信息，把表达改得更口语、更顺、更像真实分享。",
      "最后补一个轻互动结尾：如果你也遇到过类似情况，评论区聊聊你的看法。",
      custom,
    ]
      .filter(Boolean)
      .join("\n"),
    description: `围绕“${topic}”整理的视频简介，可用于发布页、素材库和批量导出。`,
    tags: uniqueTags(["抖音", "短视频", "口播文案", "热门文案", "视频改写", ...extractHashTags(baseTitle)]),
    prompt,
    source_aweme_id: parsed.source.aweme_id,
  };
}

export async function generateAiCopy(options: {
  parsed: ParsedDouyinInfo;
  prompt?: string | null;
  mode?: string;
  store?: CreatorStore;
  fetcher?: FetchLike;
}): Promise<AiCopyResult> {
  const store = options.store ?? (await getCreatorStore());
  const settings = await store.getLlmSettings();
  const apiKey = await store.getRawApiKey();
  const mode = options.mode ?? "rewrite";
  if (!settings.enabled || !apiKey || !settings.model) {
    return makeLocalAiCopy(options.parsed, options.prompt ?? null, mode);
  }

  const local = makeLocalAiCopy(options.parsed, options.prompt ?? null, mode);
  const prompt = [
    "你是短视频文案策划，请基于输入的视频信息生成 JSON。",
    "JSON 字段必须包含 title、transcript、rewritten_script、description、tags。",
    "文案要自然、口语化、适合中文短视频发布，不要解释过程。",
    options.prompt ? `用户改写要求：${options.prompt}` : "",
    `视频信息：${JSON.stringify({
      aweme_id: options.parsed.source.aweme_id,
      desc: options.parsed.content.desc,
      author: options.parsed.author,
      stats: options.parsed.stats,
      music: options.parsed.music,
      local_transcript_draft: local.transcript,
    })}`,
  ]
    .filter(Boolean)
    .join("\n");

  const content = await callOpenAiCompatible({
    settings,
    apiKey,
    prompt,
    fetcher: options.fetcher,
  });
  const parsedJson = parseJsonObject(content);
  return {
    provider: "xiaomi",
    mode,
    title: asString(parsedJson.title) ?? local.title,
    transcript: asString(parsedJson.transcript) ?? local.transcript,
    rewritten_script: asString(parsedJson.rewritten_script) ?? asString(parsedJson.script) ?? local.rewritten_script,
    description: asString(parsedJson.description) ?? local.description,
    tags: Array.isArray(parsedJson.tags) ? parsedJson.tags.map(String).filter(Boolean).slice(0, 12) : local.tags,
    prompt: options.prompt ?? null,
    source_aweme_id: options.parsed.source.aweme_id,
  };
}

export async function testLlmSettings(input: LlmSettingsInput, store?: CreatorStore, fetcher?: FetchLike) {
  const current = store ? await store.getLlmSettings() : { ...DEFAULT_LLM_SETTINGS, updated_at: null };
  const apiKey = input.api_key || (store ? await store.getRawApiKey() : null);
  const settings: LlmSettings = normalizeSettings(input, current);
  if (!apiKey) throw new DouyinServiceError("UNSUPPORTED_CONTENT", "api key is required for model test", 400);
  if (!settings.model) throw new DouyinServiceError("UNSUPPORTED_CONTENT", "model name is required for model test", 400);
  const started = Date.now();
  const content = await callOpenAiCompatible({
    settings,
    apiKey,
    prompt: "只回复 OK 两个字母。",
    fetcher,
    maxTokensOverride: 8,
  });
  return {
    connected: true,
    base_url: settings.base_url,
    model: settings.model,
    latency_ms: Date.now() - started,
    sample: trimText(content, 80),
  };
}

class MemoryCreatorStore implements CreatorStore {
  private settings = { ...DEFAULT_LLM_SETTINGS, updated_at: null } as LlmSettings;
  private apiKey: string | null = null;
  private usage: UsageLogInput[] = [];
  private audits: AuditLogInput[] = [];

  async getLlmSettings(): Promise<LlmSettings> {
    return { ...this.settings, api_key_masked: maskKey(this.apiKey) };
  }
  async getRawApiKey(): Promise<string | null> {
    return this.apiKey;
  }
  async saveLlmSettings(input: LlmSettingsInput): Promise<LlmSettings> {
    this.settings = normalizeSettings(input, this.settings);
    if (input.api_key !== undefined) this.apiKey = input.api_key.trim() || null;
    return this.getLlmSettings();
  }
  async recordUsage(input: UsageLogInput): Promise<void> {
    this.usage.push(input);
  }
  async recordAudit(input: AuditLogInput): Promise<void> {
    this.audits.push(input);
  }
  async getMetrics(): Promise<Record<string, number>> {
    return {
      usage_total: this.usage.length,
      audit_total: this.audits.length,
      ai_calls: this.usage.filter((item) => item.kind.startsWith("ai")).length,
      blocked_calls: this.usage.filter((item) => item.status === 429).length,
    };
  }
}

class SqliteCreatorStore implements CreatorStore {
  private constructor(private readonly db: DatabaseSync) {}

  static async open(databaseUrl: string): Promise<SqliteCreatorStore> {
    if (!isNodeRuntime()) throw new Error("node runtime is required for sqlite store");
    const sqlite = await dynamicImport("node:sqlite");
    const Database = sqlite.DatabaseSync;
    if (!Database) throw new Error("node:sqlite DatabaseSync not available");
    if (databaseUrl !== ":memory:") await ensureParentDir(databaseUrl);
    const db = new Database(databaseUrl);
    const store = new SqliteCreatorStore(db);
    store.migrate();
    return store;
  }

  async getLlmSettings(): Promise<LlmSettings> {
    const raw = this.readJson("llm_settings");
    const settings = normalizeSettings(raw, { ...DEFAULT_LLM_SETTINGS, updated_at: null });
    return { ...settings, api_key_masked: maskKey(await this.getRawApiKey()) };
  }

  async getRawApiKey(): Promise<string | null> {
    const row = this.db.prepare("SELECT value FROM creator_settings WHERE key = 'llm_api_key'").get() as { value?: string } | undefined;
    return row?.value || null;
  }

  async saveLlmSettings(input: LlmSettingsInput): Promise<LlmSettings> {
    const current = await this.getLlmSettings();
    const settings = normalizeSettings(input, current);
    this.writeJson("llm_settings", { ...settings, api_key_masked: null });
    if (input.api_key !== undefined) {
      this.db
        .prepare("INSERT INTO creator_settings (key, value, updated_at) VALUES ('llm_api_key', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
        .run(input.api_key.trim(), Date.now());
    }
    return this.getLlmSettings();
  }

  async recordUsage(input: UsageLogInput): Promise<void> {
    this.db
      .prepare("INSERT INTO usage_logs (kind, user_key, ip, path, status, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(input.kind, input.user_key, input.ip, input.path, input.status, input.detail ?? null, Date.now());
  }

  async recordAudit(input: AuditLogInput): Promise<void> {
    this.db
      .prepare("INSERT INTO audit_logs (actor, action, ip, detail, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(input.actor, input.action, input.ip, input.detail ?? null, Date.now());
  }

  async getMetrics(): Promise<Record<string, number>> {
    const usage = this.db.prepare("SELECT COUNT(*) AS count FROM usage_logs").get() as { count: number };
    const audits = this.db.prepare("SELECT COUNT(*) AS count FROM audit_logs").get() as { count: number };
    const ai = this.db.prepare("SELECT COUNT(*) AS count FROM usage_logs WHERE kind LIKE 'ai%'").get() as { count: number };
    const blocked = this.db.prepare("SELECT COUNT(*) AS count FROM usage_logs WHERE status = 429").get() as { count: number };
    return { usage_total: usage.count, audit_total: audits.count, ai_calls: ai.count, blocked_calls: blocked.count };
  }

  private readJson(key: string): Record<string, unknown> {
    const row = this.db.prepare("SELECT value FROM creator_settings WHERE key = ?").get(key) as { value?: string } | undefined;
    if (!row?.value) return {};
    try {
      return JSON.parse(row.value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private writeJson(key: string, value: unknown): void {
    this.db
      .prepare("INSERT INTO creator_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(key, JSON.stringify(value), Date.now());
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS creator_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS usage_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        user_key TEXT NOT NULL,
        ip TEXT NOT NULL,
        path TEXT NOT NULL,
        status INTEGER NOT NULL,
        detail TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        ip TEXT NOT NULL,
        detail TEXT,
        created_at INTEGER NOT NULL
      );
    `);
  }
}

async function createCreatorStore(): Promise<CreatorStore> {
  const databaseUrl = getEnv().DATABASE_URL ?? ".data/app.db";
  try {
    return await SqliteCreatorStore.open(databaseUrl);
  } catch {
    return new MemoryCreatorStore();
  }
}

function normalizeSettings(input: LlmSettingsInput, current: LlmSettings): LlmSettings {
  const base = asString(input.base_url) ?? current.base_url ?? DEFAULT_LLM_SETTINGS.base_url;
  return {
    base_url: base.replace(/\/+$/, ""),
    api_key_masked: current.api_key_masked,
    model: asString(input.model) ?? current.model ?? DEFAULT_LLM_SETTINGS.model,
    timeout_ms: asPositiveNumber(input.timeout_ms, current.timeout_ms ?? DEFAULT_LLM_SETTINGS.timeout_ms),
    max_tokens: asPositiveNumber(input.max_tokens, current.max_tokens ?? DEFAULT_LLM_SETTINGS.max_tokens),
    temperature: asFiniteNumber(input.temperature, current.temperature ?? DEFAULT_LLM_SETTINGS.temperature),
    enabled: typeof input.enabled === "boolean" ? input.enabled : current.enabled ?? DEFAULT_LLM_SETTINGS.enabled,
    updated_at: new Date().toISOString(),
  };
}

async function callOpenAiCompatible(options: {
  settings: LlmSettings;
  apiKey: string;
  prompt: string;
  fetcher?: FetchLike;
  maxTokensOverride?: number;
}): Promise<string> {
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (!fetcher) throw new DouyinServiceError("FETCH_FAILED", "fetch is not available");
  const endpoint = `${options.settings.base_url.replace(/\/+$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.settings.timeout_ms);
  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model: options.settings.model,
        messages: [{ role: "user", content: options.prompt }],
        temperature: options.settings.temperature,
        max_tokens: options.maxTokensOverride ?? options.settings.max_tokens,
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new DouyinServiceError("FETCH_FAILED", `model upstream status ${response.status}: ${trimText(text, 200)}`, 502);
    const data = JSON.parse(text) as any;
    return String(data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? text);
  } catch (error) {
    if (error instanceof DouyinServiceError) throw error;
    throw new DouyinServiceError("FETCH_FAILED", error instanceof Error ? error.message : String(error), 502);
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  const jsonText = first >= 0 && last > first ? trimmed.slice(first, last + 1) : trimmed;
  try {
    const value = JSON.parse(jsonText) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function maskKey(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 8) return "****";
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asPositiveNumber(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function asFiniteNumber(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : fallback;
}

function extractHashTags(text: string): string[] {
  return Array.from(text.matchAll(/#([^#\s]+)/g), (match) => match[1]).filter(Boolean);
}

function uniqueTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 12);
}

function trimText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

async function ensureParentDir(filePath: string): Promise<void> {
  if (filePath.startsWith("file:")) filePath = new URL(filePath).pathname;
  const path = await dynamicImport("node:path");
  const fs = await dynamicImport("node:fs/promises");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function dynamicImport(specifier: string): Promise<any> {
  return await import(specifier);
}

function getEnv(): Record<string, string | undefined> {
  return ((globalThis as any).process?.env ?? {}) as Record<string, string | undefined>;
}

function isNodeRuntime(): boolean {
  return Boolean((globalThis as any).process?.versions?.node);
}
