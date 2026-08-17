import { spawn } from "node:child_process";
import { createServer } from "node:net";

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

const port = Number(process.env.NODE_SMOKE_PORT ?? (await getFreePort()));
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

async function waitForHealth(): Promise<Response> {
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) return response;
    } catch {
      // keep polling until timeout
    }
  }
  throw new Error(`healthz not ready on port ${port}\nstdout=${stdout}\nstderr=${stderr}`);
}

try {
  const response = await waitForHealth();
  console.log(`NODE_SMOKE_PORT=${port}`);
  console.log(`NODE_SMOKE_STATUS=${response.status}`);
  console.log(`NODE_SMOKE_BODY=${await response.text()}`);
} finally {
  if (!child.killed) child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}
