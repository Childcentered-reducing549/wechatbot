# WeChatBot

Standalone WeChat AI chatbot. Connects to WeChat via the iLink Bot protocol and forwards messages to Claude (via Anthropic SDK).

Supports text, images (multimodal), and voice messages.

## Setup

```bash
cd ~/Projects/wechatbot
bun install
cp .env.example .env
# Edit .env with your API key
```

## Config (.env)

```env
# Required
ANTHROPIC_BASE_URL=https://zenmux.ai/api/anthropic
ANTHROPIC_API_KEY=sk-ai-v1-...

# Optional
ANTHROPIC_MODEL=anthropic/claude-sonnet-4.6
SYSTEM_PROMPT=You are a helpful assistant on WeChat.
MAX_HISTORY_TURNS=50
```

## Run

```bash
bun run start
```

1. A QR code appears in the terminal
2. Scan it with WeChat
3. The bot starts listening for messages
4. Ctrl+C to stop

## How It Works

```
WeChat User → iLink Bot API (long-poll) → Bot → Claude API → Bot → iLink Bot API → WeChat User
```

- **Text**: forwarded to Claude, reply sent back
- **Image**: downloaded from CDN, decrypted (AES-128-ECB), sent to Claude as base64 (multimodal)
- **Voice**: WeChat STT text used when available, otherwise SILK→WAV decode via `silk-wasm`
- **Session**: in-memory per-user conversation history (sliding window, default 50 turns)
- **Typing**: shows "typing..." indicator while Claude generates a response
- **Re-login**: auto-detects token expiration and prompts for QR re-scan

## State

Account credentials are saved to `~/.wechatbot/account.json` (chmod 600). Sync cursor saved to `~/.wechatbot/sync.json` for resume on restart.

Delete `~/.wechatbot/account.json` to force re-login.

## License

MIT
