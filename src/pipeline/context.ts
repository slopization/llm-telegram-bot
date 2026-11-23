import type { Attachment, NodeRecord } from "../db/repo.ts";
import type { AdapterKind, ChatMessage, ImageInput } from "../providers/types.ts";

function promptMessage(attachments: readonly Attachment[], text: string, seen: Set<string>) {
  const images: ImageInput[] = [];
  for (const attachment of attachments) {
    if (seen.has(attachment.fileUniqueId)) continue;
    seen.add(attachment.fileUniqueId);
    images.push({ mime: attachment.mime, data: attachment.data });
  }
  return images.length > 0
    ? { role: "user" as const, text, images }
    : { role: "user" as const, text };
}

function nodeMessages(
  node: NodeRecord,
  adapter: AdapterKind,
  attachments: ReadonlyMap<number, Attachment[]>,
  seen: Set<string>,
): ChatMessage[] {
  if (node.kind === "prompt")
    return [promptMessage(attachments.get(node.id) ?? [], node.text, seen)];
  if (node.kind !== "answer") return [];
  if (node.transcript !== null && node.transcript.adapter === adapter) {
    return node.transcript.messages;
  }
  return node.text === "" ? [] : [{ role: "assistant", text: node.text }];
}

function mergeUsers(
  first: Extract<ChatMessage, { role: "user" }>,
  second: Extract<ChatMessage, { role: "user" }>,
): ChatMessage {
  const text = [first.text, second.text].filter((part) => part !== "").join("\n\n");
  const images = [...(first.images ?? []), ...(second.images ?? [])];
  return images.length > 0 ? { role: "user", text, images } : { role: "user", text };
}

export function buildMessages(
  chain: readonly NodeRecord[],
  adapter: AdapterKind,
  attachments: ReadonlyMap<number, Attachment[]> = new Map(),
): ChatMessage[] {
  const seen = new Set<string>();
  const messages: ChatMessage[] = [];
  for (const message of chain.flatMap((node) => nodeMessages(node, adapter, attachments, seen))) {
    const last = messages.at(-1);
    if (message.role === "user" && last?.role === "user") {
      messages[messages.length - 1] = mergeUsers(last, message);
    } else {
      messages.push(message);
    }
  }
  while (messages[0] !== undefined && messages[0].role !== "user") messages.shift();
  return messages;
}
