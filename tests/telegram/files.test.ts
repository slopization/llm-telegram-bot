import type { Message } from "grammy/types";
import { describe, expect, it } from "vitest";
import { messageImages } from "../../src/telegram/files.ts";

function message(overrides: Partial<Message>): Message {
  return {
    message_id: 1,
    date: 0,
    chat: { id: 1, type: "private", first_name: "a" },
    ...overrides,
  };
}

describe("messageImages", () => {
  it("picks the largest photo size", () => {
    const photo = [
      { file_id: "small", file_unique_id: "s", width: 90, height: 90, file_size: 1 },
      { file_id: "large", file_unique_id: "l", width: 1280, height: 960, file_size: 3 },
      { file_id: "medium", file_unique_id: "m", width: 320, height: 240, file_size: 2 },
    ];

    expect(messageImages(message({ photo }))).toEqual([
      { fileId: "large", fileUniqueId: "l", mime: "image/jpeg", size: 3 },
    ]);
  });

  it("accepts image documents", () => {
    const document = { file_id: "d", file_unique_id: "du", mime_type: "image/png", file_size: 5 };

    expect(messageImages(message({ document }))).toEqual([
      { fileId: "d", fileUniqueId: "du", mime: "image/png", size: 5 },
    ]);
  });

  it("ignores other documents and missing messages", () => {
    const document = { file_id: "d", file_unique_id: "du", mime_type: "application/pdf" };

    expect(messageImages(message({ document }))).toEqual([]);
    expect(messageImages(undefined)).toEqual([]);
  });
});
