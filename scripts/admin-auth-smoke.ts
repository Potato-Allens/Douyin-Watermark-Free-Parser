import { serve } from "@hono/node-server";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { chromium } from "playwright-core";
import { createApp } from "../src/app.ts";
import { createMemoryCreatorStore } from "../src/core/index.ts";

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const socket = createServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      if (!address || typeof address === "string") {
        socket.close(() => reject(new Error("failed to allocate a browser smoke port")));
        return;
      }
      socket.close(() => resolve(address.port));
    });
  });
}

function findBrowser(): string {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ].filter((value): value is string => Boolean(value));
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) throw new Error("Chrome/Chromium executable was not found; set CHROME_PATH");
  return executable;
}

const oldUser = process.env.ADMIN_USERNAME;
const oldPassword = process.env.ADMIN_PASSWORD;
const oldTotp = process.env.ADMIN_TOTP_SECRET;
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "admin-browser-smoke-password";
delete process.env.ADMIN_TOTP_SECRET;

const port = await getFreePort();
const app = createApp({ creatorStore: createMemoryCreatorStore() });
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port });
const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const response = await page.goto(`http://127.0.0.1:${port}/admin`, { waitUntil: "networkidle" });
  const before = await page.evaluate(() => ({
    loginForms: document.querySelectorAll("#loginForm").length,
    navs: document.querySelectorAll(".tab-nav").length,
    dashboardMarkup: document.documentElement.innerHTML.includes("/api/admin/dashboard"),
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  if (response?.status() !== 200 || before.loginForms !== 1 || before.navs !== 0 || before.dashboardMarkup || before.bodyWidth !== before.viewportWidth) {
    throw new Error(`unauthenticated admin boundary failed: ${JSON.stringify({ status: response?.status(), ...before })}`);
  }

  await page.locator("#adminUser").fill("admin");
  await page.locator("#adminPass").fill("admin-browser-smoke-password");
  await Promise.all([page.waitForSelector(".tab-nav"), page.locator("#loginBtn").click()]);
  const after = await page.evaluate(() => ({
    loginForms: document.querySelectorAll("#loginForm").length,
    navs: document.querySelectorAll(".tab-nav").length,
    activePanels: document.querySelectorAll(".tab-panel.active").length,
    localToken: localStorage.getItem("admin_token"),
  }));
  if (after.loginForms !== 0 || after.navs !== 1 || after.activePanels !== 1 || after.localToken !== null) {
    throw new Error(`authenticated admin workspace failed: ${JSON.stringify(after)}`);
  }

  await page.locator('[data-tab="auth"]').click();
  await Promise.all([page.waitForSelector("#loginForm"), page.locator("#logoutBtn").click()]);
  const loggedOut = await page.evaluate(() => ({
    loginForms: document.querySelectorAll("#loginForm").length,
    navs: document.querySelectorAll(".tab-nav").length,
  }));
  if (loggedOut.loginForms !== 1 || loggedOut.navs !== 0) throw new Error(`admin logout boundary failed: ${JSON.stringify(loggedOut)}`);
  if (pageErrors.length) throw new Error(`admin browser errors: ${pageErrors.join(" | ")}`);
  await context.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(`http://127.0.0.1:${port}/admin`, { waitUntil: "networkidle" });
  const mobileLayout = await mobilePage.evaluate(() => ({ bodyWidth: document.body.scrollWidth, viewportWidth: window.innerWidth }));
  if (mobileLayout.bodyWidth !== mobileLayout.viewportWidth) throw new Error(`mobile admin login overflows: ${JSON.stringify(mobileLayout)}`);
  await mobile.close();

  console.log(JSON.stringify({ ok: true, unauthenticated: before, authenticated: after, logged_out: loggedOut, mobile: mobileLayout, page_errors: pageErrors }, null, 2));
} finally {
  await browser.close();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (oldUser === undefined) delete process.env.ADMIN_USERNAME;
  else process.env.ADMIN_USERNAME = oldUser;
  if (oldPassword === undefined) delete process.env.ADMIN_PASSWORD;
  else process.env.ADMIN_PASSWORD = oldPassword;
  if (oldTotp === undefined) delete process.env.ADMIN_TOTP_SECRET;
  else process.env.ADMIN_TOTP_SECRET = oldTotp;
}
