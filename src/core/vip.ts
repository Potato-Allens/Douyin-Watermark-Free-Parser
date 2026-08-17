import { DouyinServiceError } from "./errors.ts";

export interface VipSession {
  token: string;
  code: string;
  expires_at: number;
}

export interface MemberPlan {
  id: string;
  name: string;
  queue_priority: number;
  batch_parse_limit: number;
  batch_ai_limit: number;
  comment_export: boolean;
  cover_batch_download: boolean;
  ai_daily_quota: number;
  concurrency: number;
}

export interface MemberPlanInput extends Partial<MemberPlan> {
  id: string;
}

export interface ActivationCodeInfo {
  code: string;
  status: string;
  max_uses: number;
  used_count: number;
  expires_at: number | null;
  created_at: number;
  plan_id: string;
}

export interface ActivationCodeInput {
  code: string;
  plan_id?: string;
  max_uses?: number;
  expires_at?: number | string | null;
}

export interface MemberSession extends VipSession {
  user_id: string;
  username: string;
  plan: MemberPlan;
}

export interface RegisterMemberInput {
  code: string;
  username: string;
  password: string;
}

export interface LoginMemberInput {
  username: string;
  password: string;
}

export interface VipStore {
  activate(code: string): Promise<VipSession | null>;
  verify(token: string | null | undefined): Promise<VipSession | MemberSession | null>;
  seedCodes(codes: string[]): Promise<void>;
  registerWithCode(input: RegisterMemberInput): Promise<MemberSession | null>;
  login(input: LoginMemberInput): Promise<MemberSession | null>;
  verifyMember(token: string | null | undefined): Promise<MemberSession | null>;
  listPlans(): Promise<MemberPlan[]>;
  savePlan(input: MemberPlanInput): Promise<MemberPlan>;
  createActivationCode(input: ActivationCodeInput): Promise<ActivationCodeInfo>;
  listActivationCodes(limit?: number): Promise<ActivationCodeInfo[]>;
}

type DatabaseSync = any;

let singleton: Promise<VipStore> | null = null;

const DEFAULT_PLANS: MemberPlan[] = [
  { id: "trial", name: "体验版", queue_priority: 10, batch_parse_limit: 10, batch_ai_limit: 3, comment_export: false, cover_batch_download: true, ai_daily_quota: 20, concurrency: 1 },
  { id: "standard", name: "标准版", queue_priority: 40, batch_parse_limit: 50, batch_ai_limit: 30, comment_export: true, cover_batch_download: true, ai_daily_quota: 200, concurrency: 2 },
  { id: "pro", name: "专业版", queue_priority: 80, batch_parse_limit: 200, batch_ai_limit: 150, comment_export: true, cover_batch_download: true, ai_daily_quota: 1000, concurrency: 4 },
  { id: "enterprise", name: "企业版", queue_priority: 100, batch_parse_limit: 1000, batch_ai_limit: 1000, comment_export: true, cover_batch_download: true, ai_daily_quota: 10000, concurrency: 8 },
];

export function getVipStore(): Promise<VipStore> {
  singleton ??= createVipStore();
  return singleton;
}

export async function createMemoryVipStore(codes: string[] = ["VIP-DEMO-2026"]): Promise<VipStore> {
  const store = new MemoryVipStore();
  await store.seedCodes(codes);
  return store;
}

async function createVipStore(): Promise<VipStore> {
  const env = getEnv();
  const databaseUrl = env.DATABASE_URL ?? ".data/app.db";
  const initCodes = splitCodes(env.VIP_INIT_CODES ?? "VIP-DEMO-2026");
  try {
    const store = await SqliteVipStore.open(databaseUrl);
    await store.seedCodes(initCodes);
    return store;
  } catch {
    const store = new MemoryVipStore();
    await store.seedCodes(initCodes);
    return store;
  }
}

class SqliteVipStore implements VipStore {
  private constructor(private readonly db: DatabaseSync) {}

  static async open(databaseUrl: string): Promise<SqliteVipStore> {
    if (!isNodeRuntime()) throw new Error("node runtime is required for sqlite store");
    const sqlite = await dynamicImport("node:sqlite");
    const Database = sqlite.DatabaseSync;
    if (!Database) throw new Error("node:sqlite DatabaseSync not available");
    if (databaseUrl !== ":memory:") await ensureParentDir(databaseUrl);
    const db = new Database(databaseUrl);
    const store = new SqliteVipStore(db);
    store.migrate();
    store.seedPlans();
    return store;
  }

  async seedCodes(codes: string[]): Promise<void> {
    const stmt = this.db.prepare(
      "INSERT OR IGNORE INTO activation_codes (code, status, max_uses, used_count, expires_at, created_at, plan_id) VALUES (?, 'active', 1, 0, NULL, ?, 'standard')",
    );
    const now = Date.now();
    for (const code of codes) stmt.run(code, now);
  }

  async activate(code: string): Promise<VipSession | null> {
    const normalized = code.trim();
    if (!normalized) return null;
    const row = this.db.prepare("SELECT * FROM activation_codes WHERE code = ?").get(normalized) as any;
    const now = Date.now();
    if (!canUseCode(row, now)) return null;

    const token = randomToken();
    const expiresAt = now + sessionDays() * 24 * 60 * 60 * 1000;
    this.markCodeUsed(normalized);
    this.db.prepare("INSERT INTO vip_sessions (token, code, created_at, expires_at) VALUES (?, ?, ?, ?)").run(token, normalized, now, expiresAt);
    return { token, code: normalized, expires_at: expiresAt };
  }

  async registerWithCode(input: RegisterMemberInput): Promise<MemberSession | null> {
    const code = input.code.trim();
    const username = normalizeUsername(input.username);
    assertPassword(input.password);
    const now = Date.now();
    const row = this.db.prepare("SELECT * FROM activation_codes WHERE code = ?").get(code) as any;
    if (!canUseCode(row, now)) return null;
    const planId = String(row.plan_id || "standard");
    const userId = randomToken();
    const passwordHash = await hashPassword(input.password);
    try {
      this.db.prepare("INSERT INTO member_users (id, username, password_hash, code, plan_id, status, created_at) VALUES (?, ?, ?, ?, ?, 'active', ?)").run(
        userId,
        username,
        passwordHash,
        code,
        planId,
        now,
      );
    } catch {
      throw new DouyinServiceError("UNSUPPORTED_CONTENT", "username already exists", 409);
    }
    this.markCodeUsed(code);
    return this.createMemberSession(userId, code);
  }

  async login(input: LoginMemberInput): Promise<MemberSession | null> {
    const username = normalizeUsername(input.username);
    const row = this.db.prepare("SELECT * FROM member_users WHERE username = ? AND status = 'active'").get(username) as any;
    if (!row) return null;
    const ok = await verifyPassword(input.password, String(row.password_hash));
    if (!ok) return null;
    return this.createMemberSession(String(row.id), String(row.code));
  }

  async verify(token: string | null | undefined): Promise<VipSession | MemberSession | null> {
    const member = await this.verifyMember(token);
    if (member) return member;
    if (!token) return null;
    const row = this.db.prepare("SELECT token, code, expires_at FROM vip_sessions WHERE token = ?").get(token.trim()) as any;
    if (!row || Number(row.expires_at) < Date.now()) return null;
    return { token: row.token, code: row.code, expires_at: Number(row.expires_at) };
  }

  async verifyMember(token: string | null | undefined): Promise<MemberSession | null> {
    if (!token) return null;
    const row = this.db
      .prepare(
        `SELECT s.token, s.expires_at, u.id AS user_id, u.username, u.code, p.*
         FROM member_sessions s
         JOIN member_users u ON u.id = s.user_id
         LEFT JOIN member_plans p ON p.id = u.plan_id
         WHERE s.token = ? AND u.status = 'active'`,
      )
      .get(token.trim()) as any;
    if (!row || Number(row.expires_at) < Date.now()) return null;
    return rowToMemberSession(row);
  }

  async listPlans(): Promise<MemberPlan[]> {
    const rows = this.db.prepare("SELECT * FROM member_plans ORDER BY queue_priority ASC").all() as any[];
    return rows.map(rowToPlan);
  }

  async savePlan(input: MemberPlanInput): Promise<MemberPlan> {
    const current = (await this.listPlans()).find((plan) => plan.id === input.id) ?? DEFAULT_PLANS.find((plan) => plan.id === input.id) ?? DEFAULT_PLANS[1];
    const plan = normalizePlanInput(input, current);
    this.db
      .prepare(
        `INSERT INTO member_plans
         (id, name, queue_priority, batch_parse_limit, batch_ai_limit, comment_export, cover_batch_download, ai_daily_quota, concurrency, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           queue_priority = excluded.queue_priority,
           batch_parse_limit = excluded.batch_parse_limit,
           batch_ai_limit = excluded.batch_ai_limit,
           comment_export = excluded.comment_export,
           cover_batch_download = excluded.cover_batch_download,
           ai_daily_quota = excluded.ai_daily_quota,
           concurrency = excluded.concurrency`,
      )
      .run(plan.id, plan.name, plan.queue_priority, plan.batch_parse_limit, plan.batch_ai_limit, plan.comment_export ? 1 : 0, plan.cover_batch_download ? 1 : 0, plan.ai_daily_quota, plan.concurrency, Date.now());
    return plan;
  }

  async createActivationCode(input: ActivationCodeInput): Promise<ActivationCodeInfo> {
    const info = normalizeActivationCodeInput(input);
    this.db
      .prepare(
        `INSERT INTO activation_codes (code, status, max_uses, used_count, expires_at, created_at, plan_id)
         VALUES (?, 'active', ?, 0, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET
           status = 'active',
           max_uses = excluded.max_uses,
           used_count = 0,
           expires_at = excluded.expires_at,
           plan_id = excluded.plan_id`,
      )
      .run(info.code, info.max_uses, info.expires_at, info.created_at, info.plan_id);
    const row = this.db.prepare("SELECT * FROM activation_codes WHERE code = ?").get(info.code) as any;
    return rowToActivationCode(row);
  }

  async listActivationCodes(limit = 100): Promise<ActivationCodeInfo[]> {
    const rows = this.db.prepare("SELECT * FROM activation_codes ORDER BY created_at DESC LIMIT ?").all(clampNumber(limit, 1, 500)) as any[];
    return rows.map(rowToActivationCode);
  }

  private createMemberSession(userId: string, code: string): MemberSession {
    const token = randomToken();
    const now = Date.now();
    const expiresAt = now + sessionDays() * 24 * 60 * 60 * 1000;
    this.db.prepare("INSERT INTO member_sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(token, userId, now, expiresAt);
    const row = this.db
      .prepare(
        `SELECT s.token, s.expires_at, u.id AS user_id, u.username, u.code, p.*
         FROM member_sessions s
         JOIN member_users u ON u.id = s.user_id
         LEFT JOIN member_plans p ON p.id = u.plan_id
         WHERE s.token = ?`,
      )
      .get(token) as any;
    return rowToMemberSession({ ...row, code });
  }

  private markCodeUsed(code: string): void {
    this.db.prepare("UPDATE activation_codes SET used_count = used_count + 1, status = CASE WHEN used_count + 1 >= max_uses THEN 'used' ELSE status END WHERE code = ?").run(code);
  }

  private seedPlans(): void {
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO member_plans
       (id, name, queue_priority, batch_parse_limit, batch_ai_limit, comment_export, cover_batch_download, ai_daily_quota, concurrency, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = Date.now();
    for (const plan of DEFAULT_PLANS) {
      stmt.run(plan.id, plan.name, plan.queue_priority, plan.batch_parse_limit, plan.batch_ai_limit, plan.comment_export ? 1 : 0, plan.cover_batch_download ? 1 : 0, plan.ai_daily_quota, plan.concurrency, now);
    }
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS activation_codes (
        code TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'active',
        max_uses INTEGER NOT NULL DEFAULT 1,
        used_count INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        plan_id TEXT NOT NULL DEFAULT 'standard'
      );
      CREATE TABLE IF NOT EXISTS vip_sessions (
        token TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS member_plans (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        queue_priority INTEGER NOT NULL,
        batch_parse_limit INTEGER NOT NULL,
        batch_ai_limit INTEGER NOT NULL,
        comment_export INTEGER NOT NULL,
        cover_batch_download INTEGER NOT NULL,
        ai_daily_quota INTEGER NOT NULL,
        concurrency INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS member_users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        code TEXT NOT NULL,
        plan_id TEXT NOT NULL DEFAULT 'standard',
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS member_sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS batch_tasks (
        id TEXT PRIMARY KEY,
        homepage_url TEXT NOT NULL,
        requested_count INTEGER NOT NULL,
        concurrency INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS batch_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        aweme_id TEXT,
        status TEXT NOT NULL,
        title TEXT,
        video_url TEXT,
        download_url TEXT,
        error TEXT
      );
    `);
    try {
      this.db.exec("ALTER TABLE activation_codes ADD COLUMN plan_id TEXT NOT NULL DEFAULT 'standard'");
    } catch {
      // Existing database already has plan_id.
    }
  }
}

class MemoryVipStore implements VipStore {
  private readonly plans = new Map<string, MemberPlan>(DEFAULT_PLANS.map((plan) => [plan.id, { ...plan }]));
  private readonly codes = new Map<string, { max_uses: number; used_count: number; expires_at: number | null; plan_id: string; status: string; created_at: number }>();
  private readonly sessions = new Map<string, VipSession>();
  private readonly users = new Map<string, { id: string; username: string; password_hash: string; code: string; plan_id: string }>();
  private readonly memberSessions = new Map<string, MemberSession>();

  async seedCodes(codes: string[]): Promise<void> {
    for (const code of codes) if (!this.codes.has(code)) this.codes.set(code, { max_uses: 1, used_count: 0, expires_at: null, plan_id: "standard", status: "active", created_at: Date.now() });
  }

  async activate(code: string): Promise<VipSession | null> {
    const normalized = code.trim();
    const found = this.codes.get(normalized);
    const now = Date.now();
    if (!found || !canUseCode(found, now)) return null;
    found.used_count += 1;
    if (found.used_count >= found.max_uses) found.status = "used";
    const session = { token: randomToken(), code: normalized, expires_at: now + sessionDays() * 24 * 60 * 60 * 1000 };
    this.sessions.set(session.token, session);
    return session;
  }

  async registerWithCode(input: RegisterMemberInput): Promise<MemberSession | null> {
    const code = input.code.trim();
    const found = this.codes.get(code);
    const now = Date.now();
    if (!found || !canUseCode(found, now)) return null;
    const username = normalizeUsername(input.username);
    assertPassword(input.password);
    for (const user of this.users.values()) if (user.username === username) throw new DouyinServiceError("UNSUPPORTED_CONTENT", "username already exists", 409);
    const user = { id: randomToken(), username, password_hash: await hashPassword(input.password), code, plan_id: found.plan_id };
    this.users.set(user.id, user);
    found.used_count += 1;
    if (found.used_count >= found.max_uses) found.status = "used";
    return this.createMemberSession(user);
  }

  async login(input: LoginMemberInput): Promise<MemberSession | null> {
    const username = normalizeUsername(input.username);
    const user = [...this.users.values()].find((item) => item.username === username);
    if (!user || !(await verifyPassword(input.password, user.password_hash))) return null;
    return this.createMemberSession(user);
  }

  async verify(token: string | null | undefined): Promise<VipSession | MemberSession | null> {
    return (await this.verifyMember(token)) ?? (token ? this.sessions.get(token.trim()) ?? null : null);
  }

  async verifyMember(token: string | null | undefined): Promise<MemberSession | null> {
    if (!token) return null;
    const session = this.memberSessions.get(token.trim());
    if (!session || session.expires_at < Date.now()) return null;
    return session;
  }

  async listPlans(): Promise<MemberPlan[]> {
    return [...this.plans.values()].sort((a, b) => a.queue_priority - b.queue_priority).map((plan) => ({ ...plan }));
  }

  async savePlan(input: MemberPlanInput): Promise<MemberPlan> {
    const current = this.plans.get(input.id) ?? DEFAULT_PLANS.find((plan) => plan.id === input.id) ?? DEFAULT_PLANS[1];
    const plan = normalizePlanInput(input, current);
    this.plans.set(plan.id, { ...plan });
    return { ...plan };
  }

  async createActivationCode(input: ActivationCodeInput): Promise<ActivationCodeInfo> {
    const info = normalizeActivationCodeInput(input);
    this.codes.set(info.code, { max_uses: info.max_uses, used_count: 0, expires_at: info.expires_at, plan_id: info.plan_id, status: "active", created_at: info.created_at });
    return { ...info, used_count: 0, status: "active" };
  }

  async listActivationCodes(limit = 100): Promise<ActivationCodeInfo[]> {
    return [...this.codes.entries()]
      .map(([code, value]) => ({ code, ...value }))
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, clampNumber(limit, 1, 500));
  }

  private createMemberSession(user: { id: string; username: string; code: string; plan_id: string }): MemberSession {
    const plan = this.plans.get(user.plan_id) ?? DEFAULT_PLANS[1];
    const session: MemberSession = { token: randomToken(), code: user.code, expires_at: Date.now() + sessionDays() * 24 * 60 * 60 * 1000, user_id: user.id, username: user.username, plan };
    this.memberSessions.set(session.token, session);
    return session;
  }
}

function rowToMemberSession(row: any): MemberSession {
  return {
    token: String(row.token),
    code: String(row.code),
    expires_at: Number(row.expires_at),
    user_id: String(row.user_id),
    username: String(row.username),
    plan: rowToPlan(row),
  };
}

function rowToPlan(row: any): MemberPlan {
  return {
    id: String(row.id ?? "standard"),
    name: String(row.name ?? "标准版"),
    queue_priority: Number(row.queue_priority ?? 40),
    batch_parse_limit: Number(row.batch_parse_limit ?? 50),
    batch_ai_limit: Number(row.batch_ai_limit ?? 30),
    comment_export: Boolean(Number(row.comment_export ?? 1)),
    cover_batch_download: Boolean(Number(row.cover_batch_download ?? 1)),
    ai_daily_quota: Number(row.ai_daily_quota ?? 200),
    concurrency: Number(row.concurrency ?? 2),
  };
}

function rowToActivationCode(row: any): ActivationCodeInfo {
  return {
    code: String(row.code),
    status: String(row.status ?? "active"),
    max_uses: Number(row.max_uses ?? 1),
    used_count: Number(row.used_count ?? 0),
    expires_at: row.expires_at === null || row.expires_at === undefined ? null : Number(row.expires_at),
    created_at: Number(row.created_at ?? Date.now()),
    plan_id: String(row.plan_id ?? "standard"),
  };
}

function normalizePlanInput(input: MemberPlanInput, current: MemberPlan): MemberPlan {
  const id = normalizePlanId(input.id);
  return {
    id,
    name: typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 40) : current.name,
    queue_priority: clampNumber(input.queue_priority ?? current.queue_priority, 0, 100),
    batch_parse_limit: clampNumber(input.batch_parse_limit ?? current.batch_parse_limit, 1, 5000),
    batch_ai_limit: clampNumber(input.batch_ai_limit ?? current.batch_ai_limit, 0, 5000),
    comment_export: typeof input.comment_export === "boolean" ? input.comment_export : current.comment_export,
    cover_batch_download: typeof input.cover_batch_download === "boolean" ? input.cover_batch_download : current.cover_batch_download,
    ai_daily_quota: clampNumber(input.ai_daily_quota ?? current.ai_daily_quota, 0, 100000),
    concurrency: clampNumber(input.concurrency ?? current.concurrency, 1, 20),
  };
}

function normalizeActivationCodeInput(input: ActivationCodeInput): Omit<ActivationCodeInfo, "status" | "used_count"> & { status?: string; used_count?: number } {
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{5,63}$/.test(code)) {
    throw new DouyinServiceError("UNSUPPORTED_CONTENT", "activation code must be 6-64 chars: A-Z, 0-9, _ or -", 400);
  }
  return {
    code,
    max_uses: clampNumber(input.max_uses ?? 1, 1, 10000),
    expires_at: normalizeExpiresAt(input.expires_at),
    created_at: Date.now(),
    plan_id: normalizePlanId(input.plan_id ?? "standard"),
  };
}

function normalizePlanId(value: string): string {
  const id = value.trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,32}$/.test(id)) {
    throw new DouyinServiceError("UNSUPPORTED_CONTENT", "plan id must be 2-32 chars: letters, numbers, _ or -", 400);
  }
  return id;
}

function normalizeExpiresAt(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
    throw new DouyinServiceError("UNSUPPORTED_CONTENT", "expires_at must be a future timestamp or ISO datetime", 400);
  }
  return Math.floor(timestamp);
}

function clampNumber(value: unknown, min: number, max: number): number {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Math.max(min, Math.min(max, Number.isFinite(number) ? Math.floor(number) : min));
}

function canUseCode(row: any, now: number): boolean {
  if (!row || row.status !== "active") return false;
  if (row.expires_at !== null && row.expires_at !== undefined && Number(row.expires_at) < now) return false;
  return Number(row.used_count) < Number(row.max_uses);
}

function normalizeUsername(value: string): string {
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9_@.-]{3,40}$/.test(username)) {
    throw new DouyinServiceError("UNSUPPORTED_CONTENT", "username must be 3-40 chars: letters, numbers, _ @ . -", 400);
  }
  return username;
}

function assertPassword(value: string): void {
  if (value.length < 8) throw new DouyinServiceError("UNSUPPORTED_CONTENT", "password must be at least 8 characters", 400);
}

async function hashPassword(password: string): Promise<string> {
  const saltBytes = randomBytes(16);
  const hash = await pbkdf2(password, saltBytes);
  return `pbkdf2:${bytesToHex(saltBytes)}:${bytesToHex(hash)}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  if (scheme === "scrypt") {
    const crypto = await dynamicImport("node:crypto");
    const hash = crypto.scryptSync(password, salt, 32);
    const expectedBuffer = Buffer.from(expected, "hex");
    return expectedBuffer.length === hash.length && crypto.timingSafeEqual(hash, expectedBuffer);
  }
  const hash = await pbkdf2(password, hexToBytes(salt));
  return constantTimeEqual(hash, hexToBytes(expected));
}

async function pbkdf2(password: string, salt: Uint8Array): Promise<Uint8Array> {
  if (!globalThis.crypto?.subtle) throw new DouyinServiceError("INTERNAL_ERROR", "web crypto is not available");
  const passwordBytes = new TextEncoder().encode(password);
  const saltBytes = new Uint8Array(salt.length);
  saltBytes.set(salt);
  const key = await globalThis.crypto.subtle.importKey("raw", passwordBytes.buffer as ArrayBuffer, "PBKDF2", false, ["deriveBits"]);
  const bits = await globalThis.crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBytes.buffer as ArrayBuffer, iterations: 120_000 }, key, 256);
  return new Uint8Array(bits);
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^a-f0-9]/gi, "");
  const bytes = new Uint8Array(Math.floor(clean.length / 2));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

function splitCodes(value: string): string[] {
  return value
    .split(/[\s,;，；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function sessionDays(): number {
  const raw = Number(getEnv().VIP_SESSION_DAYS ?? "30");
  return Number.isFinite(raw) && raw > 0 ? raw : 30;
}

function randomToken(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
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
