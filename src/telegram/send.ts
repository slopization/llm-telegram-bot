import { type Api, GrammyError } from "grammy";
import type { Formatted } from "../render/formatted.ts";

export interface Destination {
  chatId: number;
  threadId: number | undefined;
  replyTo: number;
  isPrivate: boolean;
}

export function threadOption(destination: Destination): { message_thread_id?: number } {
  return destination.threadId !== undefined ? { message_thread_id: destination.threadId } : {};
}

export function replyOption(messageId: number | undefined) {
  return messageId === undefined
    ? {}
    : { reply_parameters: { message_id: messageId, allow_sending_without_reply: true } };
}

function isEntityError(error: unknown): boolean {
  return (
    error instanceof GrammyError && error.error_code === 400 && /entit/i.test(error.description)
  );
}

export async function sendFormatted(
  api: Api,
  destination: Destination,
  text: Formatted,
  replyTo: number | undefined,
): Promise<number> {
  const options = {
    ...threadOption(destination),
    ...replyOption(replyTo),
    link_preview_options: { is_disabled: true },
  };
  try {
    return (
      await api.sendMessage(destination.chatId, text.text, { ...options, entities: text.entities })
    ).message_id;
  } catch (error) {
    if (!isEntityError(error)) throw error;
    return (await api.sendMessage(destination.chatId, text.text, options)).message_id;
  }
}

export async function editFormatted(
  api: Api,
  chatId: number,
  messageId: number,
  text: Formatted,
): Promise<void> {
  const options = { link_preview_options: { is_disabled: true } };
  try {
    await api.editMessageText(chatId, messageId, text.text, {
      ...options,
      entities: text.entities,
    });
  } catch (error) {
    if (!isEntityError(error)) throw error;
    await api.editMessageText(chatId, messageId, text.text, options);
  }
}

export async function sendChunks(
  api: Api,
  destination: Destination,
  chunks: readonly Formatted[],
  replyTo: number | undefined,
): Promise<number[]> {
  const ids: number[] = [];
  for (const chunk of chunks) {
    ids.push(await sendFormatted(api, destination, chunk, ids.at(-1) ?? replyTo));
  }
  return ids;
}
