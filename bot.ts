import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load .env from script directory (bun auto-load may not work with cwd hooks)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

import { loadConfig } from "./src/config.js";
import { loadAccount, login, deleteAccount } from "./src/auth.js";
import { initLLM } from "./src/llm.js";
import { initSession } from "./src/session.js";
import { startMonitor } from "./src/monitor.js";

async function main(): Promise<void> {
  // 1. Load config
  const config = loadConfig();
  console.log("[wechat] Config loaded");

  // 2. Init LLM + session
  initLLM(config.anthropic);
  initSession(config.session.maxHistoryTurns);
  console.log(`[wechat] LLM: ${config.anthropic.model} via ${config.anthropic.baseUrl}`);

  // 3. Login loop (re-enters on relogin)
  while (true) {
    // Load or create account
    let account = loadAccount();
    if (!account) {
      console.log("[wechat] No saved account, starting QR login...");
      account = await login(config.wechat.baseUrl);
    } else {
      console.log(`[wechat] Using saved account: ${account.accountId}`);
    }

    // 4. Start monitor with abort controller
    const abortController = new AbortController();

    const shutdown = () => {
      console.log("\n[wechat] Shutting down...");
      abortController.abort();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    const reason = await startMonitor(account, config, abortController.signal);

    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);

    if (reason === "relogin") {
      console.log("[wechat] Token expired, deleting saved account and re-logging in...");
      deleteAccount();
      continue;
    }

    // reason === "aborted"
    console.log("[wechat] Bot stopped.");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("[wechat] Fatal error:", err);
  process.exit(1);
});
