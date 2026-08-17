import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:net";

const smokeUrl = process.env.SMOKE_DOUYIN_URL ?? "https://v.douyin.com/L5pbfdP/";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function findDenoExecutable(): string {
  if (process.env.DENO_BIN && existsSync(process.env.DENO_BIN)) return process.env.DENO_BIN;
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const npxRoot = join(localAppData, "npm-cache", "_npx");
      const candidates = findFiles(npxRoot, "deno.exe", 5);
      const denoPackage = candidates.find((path) => path.includes(`${join("node_modules", "deno")}`));
      if (denoPackage) return denoPackage;
      if (candidates[0]) return candidates[0];
    }
  }
  return "deno";
}

function findFiles(root: string, fileName: string, depth: number): string[] {
  if (depth < 0 || !existsSync(root)) return [];
  const result: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) result.push(full);
    if (entry.isDirectory()) result.push(...findFiles(full, fileName, depth - 1));
  }
  return result;
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("failed to allocate a tcp port")));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(base: string): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const response = await fetch(`${base}/healthz`);
      if (response.ok) return;
    } catch {
      // keep polling
    }
  }
  throw new Error("deno server healthz not ready");
}

async function verifyVideoUrl(url: string): Promise<{ status: number; contentType: string; contentRange: string | null }> {
  assert(!/playwm|watermark=1|logo_name=/i.test(url), `watermark marker exists in url: ${url}`);
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "com.ss.android.ugc.aweme/260501 (Linux; U; Android 11; zh_CN; Pixel 5; Build/RQ3A.211001.001; Cronet/TTNetVersion:5f9640e3 2021-04-21 QuicVersion:47946d2a 2020-10-14)",
      Range: "bytes=0-4095",
    },
  });
  const buf = new Uint8Array(await response.arrayBuffer());
  const text = Array.from(buf)
    .map((value) => String.fromCharCode(value))
    .join("");
  const contentType = response.headers.get("content-type") ?? "";
  assert([200, 206].includes(response.status), `media status invalid: ${response.status}`);
  assert(contentType.includes("video") || text.includes("ftyp"), `media is not video: ${contentType}`);
  return { status: response.status, contentType, contentRange: response.headers.get("content-range") };
}

const port = Number(process.env.DENO_REAL_SMOKE_PORT ?? (await getFreePort()));
const deno = findDenoExecutable();
const child = spawn(deno, ["run", "--allow-net", "--allow-env", "src/deno.ts"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

try {
  const base = `http://127.0.0.1:${port}`;
  await waitForHealth(base);
  const response = await fetch(`${base}/api/v1/parse?url=${encodeURIComponent(smokeUrl)}`);
  const body = await response.json();
  assert(response.status === 200 && body.ok === true, `deno v1 failed: ${response.status} ${JSON.stringify(body).slice(0, 500)}`);
  const media = await verifyVideoUrl(body.data.media.video_url);

  console.log(
    JSON.stringify(
      {
        runtime: "deno",
        deno,
        server: base,
        input: smokeUrl,
        aweme_id: body.data.source.aweme_id,
        status: response.status,
        media,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`stdout=${stdout}`);
  console.error(`stderr=${stderr}`);
  throw error;
} finally {
  if (!child.killed) child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}
