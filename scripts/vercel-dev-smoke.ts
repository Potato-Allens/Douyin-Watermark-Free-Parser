import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createServer } from "node:net";

const smokeUrl = process.env.SMOKE_DOUYIN_URL ?? "https://v.douyin.com/L5pbfdP/";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function resolveNpx(): { executable: string; args: string[] } {
  if (process.platform !== "win32") return { executable: "npx", args: [] };
  const nodeDir = resolve(process.execPath, "..");
  const npxCli = join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js");
  if (existsSync(npxCli)) return { executable: process.execPath, args: [npxCli] };
  return { executable: "npx.cmd", args: [] };
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("failed to allocate a tcp port")));
        return;
      }
      const { port } = address;
      server.close(() => resolvePort(port));
    });
  });
}

async function waitForReady(base: string): Promise<void> {
  for (let i = 0; i < 90; i += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    try {
      const response = await fetchWithTimeout(`${base}/healthz`, {}, 1_000);
      if (response.status < 500) return;
    } catch {
      // keep polling
    }
  }
  throw new Error(`vercel dev server not ready at ${base}`);
}

async function readJson(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text) as any;
  } catch {
    throw new Error(`expected json, status=${response.status}, body=${text.slice(0, 500)}`);
  }
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function verifyVideoUrl(url: string): Promise<{ status: number; contentType: string; contentRange: string | null }> {
  assert(url.startsWith("http://") || url.startsWith("https://"), `video_url is not absolute: ${url}`);
  assert(!/playwm|watermark=1|logo_name=/i.test(url), `watermark marker exists in url: ${url}`);
  const response = await fetchWithTimeout(url, {
    headers: {
      "User-Agent":
        "com.ss.android.ugc.aweme/260501 (Linux; U; Android 11; zh_CN; Pixel 5; Build/RQ3A.211001.001; Cronet/TTNetVersion:5f9640e3 2021-04-21 QuicVersion:47946d2a 2020-10-14)",
      Range: "bytes=0-4095",
      Accept: "video/mp4,video/*,*/*",
    },
    redirect: "follow",
  }, 20_000);
  const buf = new Uint8Array(await response.arrayBuffer());
  const text = Array.from(buf)
    .map((value) => String.fromCharCode(value))
    .join("");
  const contentType = response.headers.get("content-type") ?? "";
  assert([200, 206].includes(response.status), `media status invalid: ${response.status}`);
  assert(contentType.includes("video") || text.includes("ftyp"), `media is not video: ${contentType}`);
  assert(buf.length > 0, "media range returned empty body");
  return { status: response.status, contentType, contentRange: response.headers.get("content-range") };
}

function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // process already exited
    }
  }
}

const port = Number(process.env.VERCEL_DEV_SMOKE_PORT ?? (await getFreePort()));
const base = `http://127.0.0.1:${port}`;
const npx = resolveNpx();

const child = spawn(
  npx.executable,
  [
    ...npx.args,
    "vercel",
    "dev",
    "--local",
    "--yes",
    "--listen",
    `127.0.0.1:${port}`,
    "--local-config",
    "vercel.json",
  ],
  {
    cwd: process.cwd(),
    env: { ...process.env, VERCEL_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  },
);

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

try {
  await waitForReady(base);
  const encoded = encodeURIComponent(smokeUrl);

  const v1Response = await fetchWithTimeout(`${base}/api/v1/parse?url=${encoded}`, {}, 60_000);
  const v1 = await readJson(v1Response);
  assert(v1Response.status === 200 && v1.ok === true, `v1 failed: ${v1Response.status} ${JSON.stringify(v1).slice(0, 500)}`);
  assert(v1.data.media.type === "video", `v1 media.type must be video, got ${v1.data.media.type}`);
  const v1Media = await verifyVideoUrl(v1.data.media.video_url);

  const textResponse = await fetchWithTimeout(`${base}/?url=${encoded}`, {}, 60_000);
  const textUrl = await textResponse.text();
  assert(textResponse.status === 200, `compat text failed: ${textResponse.status} ${textUrl.slice(0, 500)}`);
  const textMedia = await verifyVideoUrl(textUrl);

  const dataResponse = await fetchWithTimeout(`${base}/?data&url=${encoded}`, {}, 60_000);
  const data = await readJson(dataResponse);
  assert(dataResponse.status === 200 && data.aweme_id === v1.data.source.aweme_id, "compat data mismatch");
  const dataMedia = await verifyVideoUrl(data.video_url);

  const helloResponse = await fetchWithTimeout(`${base}/api/hello?data&url=${encoded}`, {}, 60_000);
  const hello = await readJson(helloResponse);
  assert(helloResponse.status === 200 && hello.aweme_id === v1.data.source.aweme_id, "api/hello mismatch");
  const helloMedia = await verifyVideoUrl(hello.video_url);

  console.log(
    JSON.stringify(
      {
        runtime: "vercel-dev-local",
        server: base,
        input: smokeUrl,
        aweme_id: v1.data.source.aweme_id,
        statuses: {
          v1: v1Response.status,
          compat_text: textResponse.status,
          compat_data: dataResponse.status,
          api_hello: helloResponse.status,
        },
        media: { v1: v1Media, compat_text: textMedia, compat_data: dataMedia, api_hello: helloMedia },
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`vercel stdout:\n${stdout.slice(-4000)}`);
  console.error(`vercel stderr:\n${stderr.slice(-4000)}`);
  throw error;
} finally {
  if (child.pid) killProcessTree(child.pid);
  await new Promise((resolveExit) => setTimeout(resolveExit, 500));
}
