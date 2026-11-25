import type { Message } from "grammy/types";
import { describe, expect, it } from "vitest";
import {
  type FileRef,
  fileContent,
  messageFiles,
  UnsupportedFileError,
} from "../../src/telegram/files.ts";

function message(overrides: Partial<Message>): Message {
  return {
    message_id: 1,
    date: 0,
    chat: { id: 1, type: "private", first_name: "a" },
    ...overrides,
  };
}

function ref(mime: string, name = "a.bin"): FileRef {
  return { fileId: "f", fileUniqueId: "u", name, mime, size: undefined };
}

describe("messageFiles", () => {
  it("picks the largest photo size", () => {
    const photo = [
      { file_id: "small", file_unique_id: "s", width: 90, height: 90, file_size: 1 },
      { file_id: "large", file_unique_id: "l", width: 1280, height: 960, file_size: 3 },
      { file_id: "medium", file_unique_id: "m", width: 320, height: 240, file_size: 2 },
    ];

    expect(messageFiles(message({ photo }))).toEqual([
      { fileId: "large", fileUniqueId: "l", name: "photo.jpg", mime: "image/jpeg", size: 3 },
    ]);
  });

  it("accepts any document", () => {
    const document = {
      file_id: "d",
      file_unique_id: "du",
      file_name: "paper.pdf",
      mime_type: "application/pdf",
      file_size: 5,
    };

    expect(messageFiles(message({ document }))).toEqual([
      { fileId: "d", fileUniqueId: "du", name: "paper.pdf", mime: "application/pdf", size: 5 },
    ]);
  });

  it("defaults missing document name and type", () => {
    const document = { file_id: "d", file_unique_id: "du" };

    expect(messageFiles(message({ document }))).toEqual([
      {
        fileId: "d",
        fileUniqueId: "du",
        name: "file",
        mime: "application/octet-stream",
        size: undefined,
      },
    ]);
  });

  it("returns nothing for missing messages", () => {
    expect(messageFiles(undefined)).toEqual([]);
  });
});

describe("fileContent", () => {
  it("keeps images and pdfs as attachments", () => {
    const data = Buffer.from([0, 1, 2]);

    expect(fileContent(ref("application/pdf"), data)).toEqual({
      fileUniqueId: "u",
      mime: "application/pdf",
      data,
    });
  });

  it("wraps utf-8 files as text", () => {
    const data = Buffer.from("print('안녕')");

    expect(fileContent(ref("application/octet-stream", "a.py"), data)).toBe(
      "<file name=\"a.py\">\nprint('안녕')\n</file>",
    );
  });

  it("rejects binary files", () => {
    expect(() => fileContent(ref("application/zip"), Buffer.from([0x50, 0x4b, 0, 3]))).toThrow(
      UnsupportedFileError,
    );
    expect(() => fileContent(ref("application/octet-stream"), Buffer.from([0xff, 0xfe]))).toThrow(
      UnsupportedFileError,
    );
  });
});
