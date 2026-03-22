# Standalone WeChat AI Bot

> Date: 2026-03-22
> Status: Draft

## Goal

A standalone WeChat AI chatbot that connects directly to the iLink Bot protocol (the same backend used by `@tencent-weixin/openclaw-weixin`), without depending on OpenClaw. Runs with `bun run bot.ts`.

## Use Case

Receive WeChat messages -> forward to Claude (via Anthropic SDK, Zenmux proxy) -> send reply back. Supports text, images (multimodal), and voice (SILK->WAV->text).

## Project Structure

```
~/Projects/wechatbot/
├── bot.ts                    # Entry point: CLI + lifecycle orchestration
├── package.json
├── .env.example
├── src/
│   ├── config.ts             # Env/config loading (validated)
│   ├── api.ts                # iLink Bot HTTP API (getupdates, sendmessage, etc.)
│   ├── types.ts              # Protocol types (WeixinMessage, CDNMedia, etc.)
│   ├── auth.ts               # QR login flow + account persistence
│   ├── cdn.ts                # AES-128-ECB encrypt/decrypt + CDN upload/download
│   ├── media.ts              # Media download, SILK->WAV transcode, MIME detection
│   ├── monitor.ts            # Long-poll loop (getUpdates -> process -> reply)
│   ├── messaging.ts          # Inbound normalization + outbound send
│   ├── llm.ts                # Claude API via Anthropic SDK (Zenmux proxy)
│   └── session.ts            # In-memory per-user conversation history
```

## Full Lifecycle

```
bun run bot.ts
  1. Load config from .env (validated)
  2. Check for saved account (~/.wechatbot/account.json)
  3. If no account: QR login flow
     a. GET ilink/bot/get_bot_qrcode?bot_type=3
     b. Render QR in terminal via qrcode-terminal
     c. Long-poll ilink/bot/get_qrcode_status until confirmed
     d. Save bot_token + ilink_bot_id + baseUrl to ~/.wechatbot/account.json
  4. Start long-poll monitor loop (getUpdates)
  5. On each inbound message:
     a. Download media if present (CDN download + AES-128-ECB decrypt)
     b. Build conversation context from in-memory session history
     c. Send typing indicator
     d. Call Claude via Anthropic SDK (Zenmux proxy)
     e. Cancel typing indicator
     f. Send reply back via iLink sendMessage API
  6. Ctrl+C: graceful shutdown via AbortController
  7. If monitor exits with "relogin": delete saved account, go back to step 2
```

## Module Design

### config.ts

- Load from `.env` via `process.env` (bun has built-in .env support)
- Validate required env vars with plain checks (throw on missing)
- Export typed config object

```ts
type Config = {
  anthropic: {
    baseUrl: string;
    apiKey: string;
    model: string;
    systemPrompt: string;
  };
  wechat: {
    baseUrl: string;
    cdnBaseUrl: string;
  };
  session: {
    maxHistoryTurns: number;
  };
};
```

### api.ts

HTTP client for the iLink Bot protocol. All requests are POST JSON to `baseUrl/ilink/bot/<endpoint>`.

Endpoints:
| Function | Endpoint | Timeout | Notes |
|----------|----------|---------|-------|
| `getUpdates(buf)` | `ilink/bot/getupdates` | 35s | Long-poll, returns when new messages arrive |
| `sendMessage(msg)` | `ilink/bot/sendmessage` | 15s | Send text/media downstream |
| `getUploadUrl(params)` | `ilink/bot/getuploadurl` | 15s | Pre-signed CDN upload URL |
| `getConfig(userId)` | `ilink/bot/getconfig` | 10s | Get typing_ticket |
| `sendTyping(userId, ticket)` | `ilink/bot/sendtyping` | 10s | Typing indicator |

Request headers:
- `Authorization: Bearer <bot_token>`
- `AuthorizationType: ilink_bot_token`
- `Content-Type: application/json`
- `X-WECHAT-UIN: <random base64 uint32>`
- Each request body includes `base_info: { channel_version }`

### types.ts

Protocol types mirrored from the original package:
- `WeixinMessage` — unified inbound/outbound message
- `MessageItem` — text/image/voice/file/video item
- `CDNMedia` — encrypted CDN reference
- `GetUpdatesReq/Resp`, `SendMessageReq`, `GetUploadUrlReq/Resp`
- Enums: `MessageType`, `MessageItemType`, `MessageState`, `UploadMediaType`

### auth.ts

QR login flow:
1. `startLogin()`: GET `get_bot_qrcode?bot_type=3` -> render QR in terminal
2. `waitForLogin()`: long-poll `get_qrcode_status` with status machine (wait/scaned/confirmed/expired)
3. QR auto-refresh on expiry (max 3 times), total timeout 8 minutes
4. On confirmed: save `{ token, accountId, baseUrl, userId }` to `~/.wechatbot/account.json`
5. `loadAccount()`: read saved account, return null if missing

### cdn.ts

CDN encryption/decryption:
- `encryptAesEcb(plaintext, key)`: AES-128-ECB encrypt with PKCS7 padding
- `decryptAesEcb(ciphertext, key)`: AES-128-ECB decrypt
- `uploadToCdn(filePath, toUserId, opts)`: read file -> hash -> gen aeskey -> getUploadUrl -> encrypt -> POST to CDN -> return download params
- `downloadAndDecrypt(encryptParam, aesKey, cdnBaseUrl)`: GET from CDN -> decrypt -> return Buffer

CDN URLs:
- Upload: `{cdnBaseUrl}/upload?encrypted_query_param={uploadParam}&filekey={filekey}`
- Download: `{cdnBaseUrl}/download?encrypted_query_param={encryptParam}`

### media.ts

Media processing:
- `downloadMediaFromMessage(msg)`: extract media items -> CDN download + decrypt
  - Image: download + decrypt -> save to /tmp -> return path
  - Voice: download + decrypt SILK -> transcode to WAV (via silk-wasm) -> return path + text if STT available
  - Priority: IMAGE > VOICE (skip VIDEO/FILE for now)
- `silkToWav(silkBuf)`: SILK -> PCM (silk-wasm) -> WAV header construction
- `getMimeFromFilename(name)`: extension -> MIME lookup
- Image data is base64-encoded and sent to multimodal LLM
- Voice text field (WeChat STT) is used directly when available; WAV as fallback

### monitor.ts

The main long-poll loop:
```
while (!aborted) {
  resp = await getUpdates(buf, token)
  if error:
    if session_expired (errcode -14): pause 1 hour
    if consecutive failures >= 3: backoff 30s
    else: retry after 2s
  update buf from resp
  for each message in resp.msgs:
    await processMessage(message)
}
```

- `get_updates_buf` persisted to `~/.wechatbot/sync.json` for resume on restart
- Server-suggested `longpolling_timeout_ms` is respected
- AbortSignal for graceful shutdown
- Returns a reason code on exit: `"aborted"` (Ctrl+C), `"relogin"` (token expired, need QR re-login)

### messaging.ts

Inbound:
- Extract text body from item_list (text > voice STT > quoted context)
- `contextToken` cached per user (required for all replies)
- Build standardized `InboundMessage { from, text, mediaPath?, mediaType?, contextToken }`

Outbound:
- `sendText(to, text, contextToken)`: build SendMessageReq with TEXT item
- `sendImage(to, uploaded, contextToken)`: build with IMAGE item (CDN refs)
- Text chunking not needed initially (single message up to 4000 chars)

### llm.ts

Single-file Claude integration via `@anthropic-ai/sdk`:

- Initialize `Anthropic` client with `baseURL` and `apiKey` from config (Zenmux proxy)
- `chat(messages, systemPrompt)`: call `messages.create()` with model, system, history
- Support image content blocks (`{ type: "image", source: { type: "base64", ... } }`) for multimodal
- Non-streaming for simplicity (single response, extract text from response)
- No abstraction layer — just a thin wrapper around the SDK

### session.ts

```ts
class SessionManager {
  private sessions = new Map<string, ChatMessage[]>();

  getHistory(userId: string): ChatMessage[];
  addUserMessage(userId: string, message: ChatMessage): void;
  addAssistantMessage(userId: string, text: string): void;
  // Sliding window: keep last N turns (default 50)
}
```

## Config (.env)

```env
# Claude via Zenmux proxy
ANTHROPIC_BASE_URL=https://zenmux.ai/api/anthropic
ANTHROPIC_API_KEY=sk-ai-v1-...
ANTHROPIC_MODEL=anthropic/claude-sonnet-4.6
SYSTEM_PROMPT=You are a helpful assistant on WeChat.

# WeChat (usually no need to change)
WECHAT_BASE_URL=https://ilinkai.weixin.qq.com
WECHAT_CDN_BASE_URL=https://novac2c.cdn.weixin.qq.com/c2c

# Session
MAX_HISTORY_TURNS=50
```

## Dependencies

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "latest",
    "qrcode-terminal": "0.12.0"
  },
  "optionalDependencies": {
    "silk-wasm": "latest"
  }
}
```

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| State dir | `~/.wechatbot/` | Independent from OpenClaw, user-scoped |
| Config | `.env` + plain checks | Bun has built-in .env support, no extra deps needed |
| LLM | Claude only via Anthropic SDK + Zenmux proxy | Simple, no abstraction needed |
| Session | `Map<userId, Message[]>` sliding window (50 turns) | Simple, no persistence needed |
| Media in | Image -> base64 to multimodal LLM; Voice -> SILK->WAV or use WeChat STT | Practical for AI chat |
| Media out | Text only (no image generation/upload) | YAGNI for now |
| Logging | `console.log` with `[wechat]` prefix | Simple, no file overhead |
| Typing indicator | Send while LLM generates, cancel after | Good UX, uses getConfig typing_ticket |
| Error recovery | Auto-retry with backoff, session pause on -14 | Matches proven patterns from original |
| Single account | One bot per process | Simplicity; run multiple instances for multiple accounts |

## Error Handling

- **LLM failure**: Send "Sorry, I encountered an error" back to user, log error
- **CDN download failure**: Skip media, process text only, log warning
- **Session expired (-14)**: Pause all API calls for 1 hour, log prominently
- **Token invalidation / persistent auth failure**: If getUpdates returns auth errors (401/403) repeatedly after the 1-hour pause, delete saved account and trigger interactive QR re-login in the terminal. The monitor loop exits, bot.ts detects this and restarts the login flow.
- **Network errors**: Exponential backoff (2s -> 30s after 3 consecutive failures)
- **QR timeout**: Print instructions to restart

## Not In Scope (YAGNI)

- Multi-account support
- Group chat
- File/video media handling
- Outbound image/media generation
- Web UI / dashboard
- Database persistence
- Webhook mode (push instead of poll)
- User allowlist / authorization
