import type { User } from "grammy/types";
import { strings } from "../strings.ts";
import type { TaskInfo } from "./deps.ts";

const PREVIEW_CHARS = 40;

export function senderName(user: User | undefined): string {
  if (user === undefined) return strings.queueUnknownSender;
  return user.username !== undefined ? `@${user.username}` : user.first_name;
}

export function preview(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > PREVIEW_CHARS ? `${line.slice(0, PREVIEW_CHARS)}...` : line;
}

export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes === 0
    ? strings.queueSeconds(seconds)
    : strings.queueMinutes(minutes, seconds % 60);
}

export function queueText(tasks: readonly TaskInfo[], now: number): string {
  if (tasks.length === 0) return strings.queueEmpty;
  return [
    strings.queueTitle(tasks.length),
    ...tasks.map((task, index) =>
      strings.queueLine(
        index + 1,
        task.sender,
        task.label,
        elapsed(now - task.startedAt),
        task.preview,
      ),
    ),
  ].join("\n");
}
