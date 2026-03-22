import fs from "node:fs";
import path from "node:path";

import { getUpdates, getConfig, sendTyping } from "./api.js";
import { TypingStatus } from "./types.js";
import type { WeixinMessage } from "./types.js";
import type { Config } from "./config.js";
import type { Account } from "./auth.js";
import { getStateDir } from "./auth.js";
import { downloadMedia } from "./media.js";
import {
  extractTextBody,
  setContextToken,
  getContextToken,
  sendText,
} from "./messaging.js";
import { chat, buildUserMessage, type ChatMessage } from "./llm.js";
import { getHistory, addMessage } from "./session.js";

const SESSION_EXPIRED_ERRCODE = -14;
const MAX_CONSECUTIVE_FAILURES = 3;

export type MonitorExitReason = "aborted" | "relogin";

function getSyncPath(): string {
  return path.join(getStateDir(), "sync.json");
}

function loadSyncBuf(): string {
  try {
    const raw = fs.readFileSync(getSyncPath(), "utf-8");
    const data = JSON.parse(raw);
    return typeof data.get_updates_buf === "string" ? data.get_updates_buf : "";
  } catch {
    return "";
  }
}

function saveSyncBuf(buf: string): void {
  fs.writeFileSync(getSyncPath(), JSON.stringify({ get_updates_buf: buf }), "utf-8");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new Error("aborted")); }, { once: true });
  });
}

async function processMessage(
  msg: WeixinMessage,
  account: Account,
  config: Config,
): Promise<void> {
  const from = msg.from_user_id ?? "";
  if (!from) return;

  // Cache context token
  if (msg.context_token) {
    setContextToken(from, msg.context_token);
  }

  const text = extractTextBody(msg.item_list);
  const contextToken = getContextToken(from);

  // Download media
  const media = await downloadMedia(msg.item_list, config.wechat.cdnBaseUrl);

  // Build user message content
  let userText = text;
  if (media.voiceText && !userText) {
    userText = media.voiceText;
  }
  if (!userText && !media.path) {
    console.log(`[wechat] Empty message from ${from}, skipping`);
    return;
  }

  let imageBase64: string | undefined;
  if (media.path && media.mimeType?.startsWith("image/")) {
    try {
      const buf = await import("node:fs/promises").then((f) => f.readFile(media.path!));
      imageBase64 = buf.toString("base64");
    } catch (err) {
      console.error("[wechat] Failed to read image:", err);
    }
  }

  const userMsg = buildUserMessage(userText || "What's in this image?", imageBase64);
  addMessage(from, userMsg);

  // Send typing indicator
  let typingTicket: string | undefined;
  try {
    const cfg = await getConfig({
      baseUrl: account.baseUrl,
      token: account.token,
      ilinkUserId: from,
      contextToken,
    });
    typingTicket = cfg.typing_ticket;
  } catch {}

  if (typingTicket) {
    sendTyping({
      baseUrl: account.baseUrl,
      token: account.token,
      body: { ilink_user_id: from, typing_ticket: typingTicket, status: TypingStatus.TYPING },
    }).catch(() => {});
  }

  // Call LLM
  let reply: string;
  try {
    const history = getHistory(from);
    reply = await chat(history);
  } catch (err) {
    console.error("[wechat] LLM error:", err);
    reply = "Sorry, I encountered an error processing your message.";
  }

  // Cancel typing
  if (typingTicket) {
    sendTyping({
      baseUrl: account.baseUrl,
      token: account.token,
      body: { ilink_user_id: from, typing_ticket: typingTicket, status: TypingStatus.CANCEL },
    }).catch(() => {});
  }

  // Save assistant message
  addMessage(from, { role: "assistant", content: reply });

  // Send reply
  try {
    await sendText({
      baseUrl: account.baseUrl,
      token: account.token,
      to: from,
      text: reply,
      contextToken,
    });
    console.log(`[wechat] Reply sent to ${from} (${reply.length} chars)`);
  } catch (err) {
    console.error("[wechat] Failed to send reply:", err);
  }
}

export async function startMonitor(
  account: Account,
  config: Config,
  abortSignal: AbortSignal,
): Promise<MonitorExitReason> {
  let getUpdatesBuf = loadSyncBuf();
  let consecutiveFailures = 0;
  let nextTimeoutMs = 35_000;

  console.log(`[wechat] Monitor started (${account.baseUrl}, account=${account.accountId})`);
  if (getUpdatesBuf) {
    console.log(`[wechat] Resuming from saved sync buf (${getUpdatesBuf.length} bytes)`);
  }

  while (!abortSignal.aborted) {
    try {
      const resp = await getUpdates({
        baseUrl: account.baseUrl,
        token: account.token,
        getUpdatesBuf,
        timeoutMs: nextTimeoutMs,
      });

      if (resp.longpolling_timeout_ms && resp.longpolling_timeout_ms > 0) {
        nextTimeoutMs = resp.longpolling_timeout_ms;
      }

      const isApiError =
        (resp.ret !== undefined && resp.ret !== 0) ||
        (resp.errcode !== undefined && resp.errcode !== 0);

      if (isApiError) {
        const isSessionExpired =
          resp.errcode === SESSION_EXPIRED_ERRCODE || resp.ret === SESSION_EXPIRED_ERRCODE;

        if (isSessionExpired) {
          console.error("[wechat] Session expired (errcode -14), pausing for 1 hour...");
          try {
            await sleep(60 * 60 * 1000, abortSignal);
          } catch {
            return "aborted";
          }
          // After pause, check if still failing — trigger relogin
          consecutiveFailures = 0;
          continue;
        }

        consecutiveFailures++;
        console.error(
          `[wechat] getUpdates error: ret=${resp.ret} errcode=${resp.errcode} errmsg=${resp.errmsg ?? ""} (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`,
        );

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          // Check if it's an auth error — trigger relogin
          const errMsg = resp.errmsg?.toLowerCase() ?? "";
          if (resp.errcode === 401 || resp.errcode === 403 || errMsg.includes("unauthorized") || errMsg.includes("token")) {
            console.error("[wechat] Persistent auth failure, need re-login");
            return "relogin";
          }
          console.error("[wechat] Backing off 30s...");
          consecutiveFailures = 0;
          try {
            await sleep(30_000, abortSignal);
          } catch {
            return "aborted";
          }
        } else {
          try {
            await sleep(2_000, abortSignal);
          } catch {
            return "aborted";
          }
        }
        continue;
      }

      consecutiveFailures = 0;

      if (resp.get_updates_buf) {
        saveSyncBuf(resp.get_updates_buf);
        getUpdatesBuf = resp.get_updates_buf;
      }

      for (const msg of resp.msgs ?? []) {
        try {
          await processMessage(msg, account, config);
        } catch (err) {
          console.error("[wechat] processMessage error:", err);
        }
      }
    } catch (err) {
      if (abortSignal.aborted) return "aborted";

      consecutiveFailures++;
      console.error(
        `[wechat] getUpdates exception (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`,
        err,
      );

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        consecutiveFailures = 0;
        try {
          await sleep(30_000, abortSignal);
        } catch {
          return "aborted";
        }
      } else {
        try {
          await sleep(2_000, abortSignal);
        } catch {
          return "aborted";
        }
      }
    }
  }

  return "aborted";
}
