export type Config = {
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

function required(name: string): string {
  const val = process.env[name]?.trim();
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optional(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

export function loadConfig(): Config {
  return {
    anthropic: {
      baseUrl: required("ANTHROPIC_BASE_URL"),
      apiKey: required("ANTHROPIC_API_KEY"),
      model: optional("ANTHROPIC_MODEL", "anthropic/claude-sonnet-4.6"),
      systemPrompt: optional("SYSTEM_PROMPT", "You are a helpful assistant on WeChat."),
    },
    wechat: {
      baseUrl: optional("WECHAT_BASE_URL", "https://ilinkai.weixin.qq.com"),
      cdnBaseUrl: optional("WECHAT_CDN_BASE_URL", "https://novac2c.cdn.weixin.qq.com/c2c"),
    },
    session: {
      maxHistoryTurns: parseInt(optional("MAX_HISTORY_TURNS", "50"), 10),
    },
  };
}
