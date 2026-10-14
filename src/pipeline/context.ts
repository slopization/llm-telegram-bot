import type { NodeRecord } from "../db/repo.ts";
import type { AdapterKind, ChatMessage } from "../providers/types.ts";

function nodeMessages(node: NodeRecord, adapter: AdapterKind): ChatMessage[] {
  if (node.kind === "prompt") return [{ role: "user", text: node.text }];
  if (node.kind !== "answer") return [];
  if (node.transcript !== null && node.transcript.adapter === adapter) {
    return node.transcript.messages;
  }
  return node.text === "" ? [] : [{ role: "assistant", text: node.text }];
}

export function buildMessages(chain: readonly NodeRecord[], adapter: AdapterKind): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const message of chain.flatMap((node) => nodeMessages(node, adapter))) {
    const last = messages.at(-1);
    if (message.role === "user" && last?.role === "user") {
      messages[messages.length - 1] = { role: "user", text: `${last.text}\n\n${message.text}` };
    } else {
      messages.push(message);
    }
  }
  while (messages[0] !== undefined && messages[0].role !== "user") messages.shift();
  return messages;
}
