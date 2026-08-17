import { spawn } from "node:child_process";
import { createServer } from "node:net";

const smokeUrl = process.env.SMOKE_DOUYIN_URL ?? "https://v.douyin.com/L5pbfdP/";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
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
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const response = await fetch(`${base}/healthz`);
      if (response.ok) return;
    } catch {
      // keep polling
    }
  }
  throw new Error("server healthz not ready");
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

const port = Number(process.env.SERVER_REAL_SMOKE_PORT ?? (await getFreePort()));
const child = spawn(process.execPath, ["--import", "tsx", "src/node.ts"], {
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
  const encoded = encodeURIComponent(smokeUrl);

  const v1Response = await fetch(`${base}/api/v1/parse?url=${encoded}`);
  const v1 = await v1Response.json();
  assert(v1Response.status === 200 && v1.ok === true, `v1 failed: ${JSON.stringify(v1).slice(0, 500)}`);
  const v1Media = await verifyVideoUrl(v1.data.media.video_url);

  const textResponse = await fetch(`${base}/?url=${encoded}`);
  const textUrl = await textResponse.text();
  assert(textResponse.status === 200, `compat text failed: ${textResponse.status} ${textUrl}`);
  const textMedia = await verifyVideoUrl(textUrl);

  const dataResponse = await fetch(`${base}/?data&url=${encoded}`);
  const data = await dataResponse.json();
  assert(dataResponse.status === 200 && data.aweme_id === v1.data.source.aweme_id, "compat data mismatch");
  const dataMedia = await verifyVideoUrl(data.video_url);

  const helloResponse = await fetch(`${base}/api/hello?data&url=${encoded}`);
  const hello = await helloResponse.json();
  assert(helloResponse.status === 200 && hello.aweme_id === v1.data.source.aweme_id, "api/hello mismatch");
  const helloMedia = await verifyVideoUrl(hello.video_url);

  console.log(
    JSON.stringify(
      {
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
  console.error(`stdout=${stdout}`);
  console.error(`stderr=${stderr}`);
  throw error;
} finally {
  if (!child.killed) child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}
