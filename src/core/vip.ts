export interface VipSession {
  token: string;
  code: string;
  expires_at: number;
}

export interface VipStore {
  activate(code: string): Promise<VipSession | null>;
  verify(token: string | null | undefined): Promise<VipSession | null>;
  seedCodes(codes: string[]): Promise<void>;
}

type DatabaseSync = any;

let singleton: Promise<VipStore> | null = null;

export function getVipStore(): Promise<VipStore> {
  singleton ??= createVipStore();
  return singleton;
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
    return store;
  }

  async seedCodes(codes: string[]): Promise<void> {
    const stmt = this.db.prepare(
      "INSERT OR IGNORE INTO activation_codes (code, status, max_uses, used_count, expires_at, created_at) VALUES (?, 'active', 1, 0, NULL, ?)",
    );
    const now = Date.now();
    for (const code of codes) stmt.run(code, now);
  }

  async activate(code: string): Promise<VipSession | null> {
    const normalized = code.trim();
    if (!normalized) return null;
    const row = this.db.prepare("SELECT * FROM activation_codes WHERE code = ?").get(normalized) as any;
    const now = Date.now();
    if (!row || row.status !== "active") return null;
    if (row.expires_at !== null && Number(row.expires_at) < now) return null;
    if (Number(row.used_count) >= Number(row.max_uses)) return null;

    const token = randomToken();
    const expiresAt = now + sessionDays() * 24 * 60 * 60 * 1000;
    this.db.prepare("UPDATE activation_codes SET used_count = used_count + 1 WHERE code = ?").run(normalized);
    this.db.prepare("INSERT INTO vip_sessions (token, code, created_at, expires_at) VALUES (?, ?, ?, ?)").run(token, normalized, now, expiresAt);
    return { token, code: normalized, expires_at: expiresAt };
  }

  async verify(token: string | null | undefined): Promise<VipSession | null> {
    if (!token) return null;
    const row = this.db.prepare("SELECT token, code, expires_at FROM vip_sessions WHERE token = ?").get(token.trim()) as any;
    if (!row || Number(row.expires_at) < Date.now()) return null;
    return { token: row.token, code: row.code, expires_at: Number(row.expires_at) };
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS activation_codes (
        code TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'active',
        max_uses INTEGER NOT NULL DEFAULT 1,
        used_count INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS vip_sessions (
        token TEXT PRIMARY KEY,
        code TEXT NOT NULL,
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
  }
}

class MemoryVipStore implements VipStore {
  private readonly codes = new Map<string, { max_uses: number; used_count: number; expires_at: number | null }>();
  private readonly sessions = new Map<string, VipSession>();

  async seedCodes(codes: string[]): Promise<void> {
    for (const code of codes) if (!this.codes.has(code)) this.codes.set(code, { max_uses: 1, used_count: 0, expires_at: null });
  }

  async activate(code: string): Promise<VipSession | null> {
    const normalized = code.trim();
    const found = this.codes.get(normalized);
    const now = Date.now();
    if (!found || found.used_count >= found.max_uses || (found.expires_at !== null && found.expires_at < now)) return null;
    found.used_count += 1;
    const session = { token: randomToken(), code: normalized, expires_at: now + sessionDays() * 24 * 60 * 60 * 1000 };
    this.sessions.set(session.token, session);
    return session;
  }

  async verify(token: string | null | undefined): Promise<VipSession | null> {
    if (!token) return null;
    const session = this.sessions.get(token.trim());
    if (!session || session.expires_at < Date.now()) return null;
    return session;
  }
}

function splitCodes(value: string): string[] {
  return value
    .split(/[\s,?;?]+/)
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
