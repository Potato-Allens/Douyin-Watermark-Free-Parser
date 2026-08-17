import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";

const imageTag = process.env.DOCKER_IMAGE_TAG ?? "douyin-watermark-free-parser:verify";
const smokeUrl = process.env.SMOKE_DOUYIN_URL ?? "https://v.douyin.com/L5pbfdP/";
const root = process.cwd();
const dockerCaDir = resolve(root, ".docker-ca");
const dockerCaPath = join(dockerCaDir, "windows-trust.pem");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function run(command: string, args: string[], options: { capture?: boolean } = {}): string {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf-8",
    windowsHide: true,
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed with exit=${result.status}\n${output}`);
  }
  return [result.stdout, result.stderr].filter(Boolean).join("\n");
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
  for (let i = 0; i < 60; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const response = await fetch(`${base}/healthz`);
      if (response.ok) return;
    } catch {
      // keep polling
    }
  }
  throw new Error(`docker container healthz not ready at ${base}`);
}

async function verifyVideoUrl(url: string): Promise<{ status: number; contentType: string; contentRange: string | null }> {
  assert(url.startsWith("http://") || url.startsWith("https://"), `video_url is not absolute: ${url}`);
  assert(!/playwm|watermark=1|logo_name=/i.test(url), `watermark marker exists in url: ${url}`);
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "com.ss.android.ugc.aweme/260501 (Linux; U; Android 11; zh_CN; Pixel 5; Build/RQ3A.211001.001; Cronet/TTNetVersion:5f9640e3 2021-04-21 QuicVersion:47946d2a 2020-10-14)",
      Range: "bytes=0-4095",
      Accept: "video/mp4,video/*,*/*",
    },
    redirect: "follow",
  });
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

run("docker", ["version"], { capture: true });
const caSecret = prepareHostCaSecret();
run("docker", ["build", ...(caSecret ? ["--secret", `id=host_ca,src=${caSecret}`] : []), "-t", imageTag, "."]);

const hostPort = Number(process.env.DOCKER_SMOKE_PORT ?? (await getFreePort()));
const containerName = `douyin-parser-verify-${Date.now()}`;
let containerId = "";

try {
  containerId = run(
    "docker",
    ["run", "-d", "--rm", "--name", containerName, "-p", `${hostPort}:8000`, "-e", "PORT=8000", imageTag],
    { capture: true },
  )
    .trim()
    .split(/\s+/)[0];
  assert(containerId, "docker run did not return a container id");

  const base = `http://127.0.0.1:${hostPort}`;
  await waitForHealth(base);
  const encoded = encodeURIComponent(smokeUrl);

  const v1Response = await fetch(`${base}/api/v1/parse?url=${encoded}`);
  const v1 = await v1Response.json();
  assert(v1Response.status === 200 && v1.ok === true, `v1 failed: ${v1Response.status} ${JSON.stringify(v1).slice(0, 500)}`);
  assert(v1.data.media.type === "video", `v1 media.type must be video, got ${v1.data.media.type}`);
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
        runtime: "docker",
        image: imageTag,
        container_id: containerId,
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
} finally {
  if (containerId) {
    spawnSync("docker", ["rm", "-f", containerId], { cwd: process.cwd(), stdio: "ignore", windowsHide: true });
  } else {
    spawnSync("docker", ["rm", "-f", containerName], { cwd: process.cwd(), stdio: "ignore", windowsHide: true });
  }
}

function prepareHostCaSecret(): string | null {
  if (process.env.DOCKER_HOST_CA_PEM && existsSync(process.env.DOCKER_HOST_CA_PEM)) return process.env.DOCKER_HOST_CA_PEM;
  if (process.platform !== "win32") return null;

  mkdirSync(dockerCaDir, { recursive: true });
  const script = String.raw`
$ErrorActionPreference = "Stop"
$stores = @("Cert:\CurrentUser\Root", "Cert:\LocalMachine\Root", "Cert:\CurrentUser\CA", "Cert:\LocalMachine\CA")
$seen = @{}
$blocks = New-Object System.Collections.Generic.List[string]
foreach ($store in $stores) {
  if (!(Test-Path $store)) { continue }
  foreach ($cert in Get-ChildItem $store -ErrorAction SilentlyContinue) {
    if (!$cert.RawData -or $seen.ContainsKey($cert.Thumbprint)) { continue }
    $seen[$cert.Thumbprint] = $true
    $base64 = [Convert]::ToBase64String($cert.RawData, [Base64FormattingOptions]::InsertLineBreaks)
    $lf = [char]10
    $blocks.Add("-----BEGIN CERTIFICATE-----$lf$base64$lf-----END CERTIFICATE-----")
  }
}
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::Write(($blocks -join [string]([char]10)))
`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    cwd: root,
    encoding: "utf-8",
    windowsHide: true,
    stdio: "pipe",
  });

  if (result.status !== 0 || !result.stdout.includes("BEGIN CERTIFICATE")) {
    rmSync(dockerCaDir, { recursive: true, force: true });
    return null;
  }

  writeFileSync(dockerCaPath, result.stdout, "utf-8");
  return dockerCaPath;
}
