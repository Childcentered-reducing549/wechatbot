import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "./config.js";

type TextBlock = { type: "text"; text: string };
type ImageBlock = {
  type: "image";
  source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string };
};
type ContentBlock = TextBlock | ImageBlock;

export type ChatMessage = {
  role: "user" | "assistant";
  content: string | ContentBlock[];
};

let client: Anthropic | null = null;
let model = "";
let systemPrompt = "";

export function initLLM(config: Config["anthropic"]): void {
  client = new Anthropic({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  });
  model = config.model;
  systemPrompt = config.systemPrompt;
}

export async function chat(messages: ChatMessage[]): Promise<string> {
  if (!client) throw new Error("LLM not initialized");

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  });

  const textBlocks = response.content.filter(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );
  return textBlocks.map((b) => b.text).join("");
}

/** Build a user message with optional image attachment. */
export function buildUserMessage(text: string, imageBase64?: string): ChatMessage {
  if (!imageBase64) {
    return { role: "user", content: text };
  }
  const blocks: ContentBlock[] = [];
  blocks.push({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: imageBase64 },
  });
  if (text) {
    blocks.push({ type: "text", text });
  }
  return { role: "user", content: blocks };
}
