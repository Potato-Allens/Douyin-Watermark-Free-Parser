import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";

interface Step {
  name: string;
  command: string;
  args: string[];
  cleanup?: () => Promise<void>;
}

const root = process.cwd();
const wranglerOutDir = resolve(root, ".wrangler-dry-run");

const steps: Step[] = [
  { name: "unit tests", command: "pnpm", args: ["test"] },
  { name: "typecheck build", command: "pnpm", args: ["build"] },
  { name: "real in-memory API smoke", command: "pnpm", args: ["smoke"] },
  { name: "real image API smoke", command: "pnpm", args: ["smoke:image-real"] },
  { name: "real Node HTTP smoke", command: "pnpm", args: ["smoke:server-real"] },
  { name: "Deno entry type check", command: "npx", args: ["deno", "check", "src/deno.ts"] },
  { name: "real Deno HTTP smoke", command: "pnpm", args: ["smoke:deno-real"] },
  { name: "real Vercel Dev local smoke", command: "pnpm", args: ["verify:vercel-dev"] },
  { name: "real Vercel production remote smoke", command: "pnpm", args: ["verify:vercel-remote"] },
  { name: "real Docker container smoke", command: "pnpm", args: ["verify:docker"] },
  {
    name: "Cloudflare Worker dry-run bundle",
    command: "npx",
    args: ["wrangler", "deploy", "--dry-run", "--outdir", ".wrangler-dry-run"],
    cleanup: async () => {
      await rm(wranglerOutDir, { recursive: true, force: true });
    },
  },
];

function run(step: Step): Promise<void> {
  return new Promise((resolveStep, reject) => {
    const command = resolveCommand(step.command, step.args);
    console.log(`\n[verify] ${step.name}: ${step.command} ${step.args.join(" ")}`);
    const child = spawn(command.executable, command.args, {
      cwd: root,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveStep();
        return;
      }
      reject(new Error(`${step.name} failed with code=${code} signal=${signal ?? ""}`));
    });
  });
}

function resolveCommand(command: string, args: string[]): { executable: string; args: string[] } {
  if (process.platform !== "win32") return { executable: command, args };

  if (command === "pnpm") {
    const appData = process.env.APPDATA;
    const pnpmCli = appData ? join(appData, "npm", "node_modules", "pnpm", "bin", "pnpm.mjs") : "";
    if (pnpmCli && existsSync(pnpmCli)) return { executable: process.execPath, args: [pnpmCli, ...args] };
  }

  if (command === "npx") {
    const nodeDir = resolve(process.execPath, "..");
    const npxCli = join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js");
    if (existsSync(npxCli)) return { executable: process.execPath, args: [npxCli, ...args] };
  }

  return { executable: command, args };
}

for (const step of steps) {
  try {
    await run(step);
  } finally {
    await step.cleanup?.();
  }
}

console.log("\n[verify] core verification passed");
