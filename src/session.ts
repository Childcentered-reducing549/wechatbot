import type { ChatMessage } from "./llm.js";

const sessions = new Map<string, ChatMessage[]>();
let maxTurns = 50;

export function initSession(max: number): void {
  maxTurns = max;
}

export function getHistory(userId: string): ChatMessage[] {
  return sessions.get(userId) ?? [];
}

export function addMessage(userId: string, msg: ChatMessage): void {
  let history = sessions.get(userId);
  if (!history) {
    history = [];
    sessions.set(userId, history);
  }
  history.push(msg);
  // Sliding window: keep last N messages (each user+assistant pair = 2 entries)
  while (history.length > maxTurns * 2) {
    history.shift();
  }
}

export function clearSession(userId: string): void {
  sessions.delete(userId);
}
