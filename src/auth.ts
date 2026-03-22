import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const STATE_DIR = path.join(os.homedir(), ".wechatbot");
const ACCOUNT_PATH = path.join(STATE_DIR, "account.json");
const BOT_TYPE = "3";
const QR_POLL_TIMEOUT_MS = 35_000;
const MAX_QR_REFRESH = 3;
const LOGIN_TIMEOUT_MS = 480_000;

export type Account = {
  token: string;
  accountId: string;
  baseUrl: string;
  userId?: string;
  savedAt: string;
};

export function loadAccount(): Account | null {
  try {
    if (!fs.existsSync(ACCOUNT_PATH)) return null;
    return JSON.parse(fs.readFileSync(ACCOUNT_PATH, "utf-8"));
  } catch {
    return null;
  }
}

export function saveAccount(account: Account): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(ACCOUNT_PATH, JSON.stringify(account, null, 2), "utf-8");
  try {
    fs.chmodSync(ACCOUNT_PATH, 0o600);
  } catch {}
}

export function deleteAccount(): void {
  try {
    fs.unlinkSync(ACCOUNT_PATH);
  } catch {}
}

export function getStateDir(): string {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  return STATE_DIR;
}

interface QRCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
}

interface StatusResponse {
  status: "wait" | "scaned" | "confirmed" | "expired";
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
}

async function fetchQRCode(baseUrl: string): Promise<QRCodeResponse> {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = `${base}ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`QR code fetch failed: ${res.status}`);
  return res.json();
}

async function pollQRStatus(baseUrl: string, qrcode: string): Promise<StatusResponse> {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = `${base}ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QR_POLL_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "iLink-App-ClientVersion": "1" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`QR status poll failed: ${res.status}`);
    return res.json();
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") return { status: "wait" };
    throw err;
  }
}

export async function login(baseUrl: string): Promise<Account> {
  console.log("[wechat] Starting QR login...");

  let qr = await fetchQRCode(baseUrl);
  let refreshCount = 1;

  // Render QR
  try {
    const qrterm = await import("qrcode-terminal");
    qrterm.default.generate(qr.qrcode_img_content, { small: true }, (code: string) => {
      console.log(code);
    });
  } catch {
    console.log(`QR Code URL: ${qr.qrcode_img_content}`);
  }
  console.log("[wechat] Scan the QR code with WeChat to connect.\n");

  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  let scannedPrinted = false;

  while (Date.now() < deadline) {
    const status = await pollQRStatus(baseUrl, qr.qrcode);

    switch (status.status) {
      case "wait":
        break;
      case "scaned":
        if (!scannedPrinted) {
          console.log("[wechat] QR scanned, confirm on WeChat...");
          scannedPrinted = true;
        }
        break;
      case "expired":
        refreshCount++;
        if (refreshCount > MAX_QR_REFRESH) {
          throw new Error("QR code expired too many times");
        }
        console.log(`[wechat] QR expired, refreshing (${refreshCount}/${MAX_QR_REFRESH})...`);
        qr = await fetchQRCode(baseUrl);
        scannedPrinted = false;
        try {
          const qrterm = await import("qrcode-terminal");
          qrterm.default.generate(qr.qrcode_img_content, { small: true }, (code: string) => {
            console.log(code);
          });
        } catch {
          console.log(`QR Code URL: ${qr.qrcode_img_content}`);
        }
        break;
      case "confirmed": {
        if (!status.ilink_bot_id || !status.bot_token) {
          throw new Error("Login confirmed but missing bot_id or token");
        }
        const account: Account = {
          token: status.bot_token,
          accountId: status.ilink_bot_id,
          baseUrl: status.baseurl || baseUrl,
          userId: status.ilink_user_id,
          savedAt: new Date().toISOString(),
        };
        saveAccount(account);
        console.log("[wechat] Login successful!");
        return account;
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  throw new Error("Login timed out");
}
