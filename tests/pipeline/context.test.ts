import { describe, expect, it } from "vitest";
import type { NodeRecord } from "../../src/db/repo.ts";
import { buildMessages } from "../../src/pipeline/context.ts";

function node(overrides: Partial<NodeRecord>): NodeRecord {
  return {
    id: 1,
    parentId: null,
    chatId: 1,
    userId: 1,
    kind: "prompt",
    text: "",
    provider: null,
    model: null,
    transcript: null,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    webSearches: 0,
    sandboxRuns: 0,
    costUsd: null,
    mode: null,
    day: "2026-10-14",
    createdAt: 0,
    ...overrides,
  };
}

describe("buildMessages", () => {
  it("maps prompts and answers to user and assistant turns", () => {
    const chain = [node({ text: "q" }), node({ kind: "answer", text: "a" })];

    expect(buildMessages(chain, "anthropic")).toEqual([
      { role: "user", text: "q" },
      { role: "assistant", text: "a" },
    ]);
  });

  it("replays the transcript only for the same adapter", () => {
    const transcript = {
      adapter: "gemini" as const,
      messages: [{ role: "assistant" as const, text: "a", native: [{ text: "a" }] }],
    };
    const chain = [node({ text: "q" }), node({ kind: "answer", text: "a", transcript })];

    expect(buildMessages(chain, "gemini")[1]).toEqual(transcript.messages[0]);
    expect(buildMessages(chain, "anthropic")[1]).toEqual({ role: "assistant", text: "a" });
  });

  it("merges consecutive user turns", () => {
    const chain = [node({ text: "first" }), node({ text: "second" })];

    expect(buildMessages(chain, "openai-chat")).toEqual([
      { role: "user", text: "first\n\nsecond" },
    ]);
  });

  it("attaches each image once across the chain", () => {
    const image = { fileUniqueId: "u1", mime: "image/png", data: Buffer.from("png") };
    const chain = [
      node({ id: 1, text: "look" }),
      node({ id: 2, kind: "answer", text: "a" }),
      node({ id: 3, text: "again" }),
    ];
    const attachments = new Map([
      [1, [image]],
      [3, [image]],
    ]);

    expect(buildMessages(chain, "anthropic", attachments)).toEqual([
      { role: "user", text: "look", images: [{ mime: "image/png", data: image.data }] },
      { role: "assistant", text: "a" },
      { role: "user", text: "again" },
    ]);
  });

  it("merges images of consecutive user turns", () => {
    const first = { fileUniqueId: "u1", mime: "image/png", data: Buffer.from("1") };
    const second = { fileUniqueId: "u2", mime: "image/jpeg", data: Buffer.from("2") };
    const chain = [node({ id: 1, text: "" }), node({ id: 2, text: "q" })];
    const attachments = new Map([
      [1, [first]],
      [2, [second]],
    ]);

    expect(buildMessages(chain, "gemini", attachments)).toEqual([
      {
        role: "user",
        text: "q",
        images: [
          { mime: "image/png", data: first.data },
          { mime: "image/jpeg", data: second.data },
        ],
      },
    ]);
  });

  it("skips error and run nodes and leading assistant turns", () => {
    const chain = [
      node({ kind: "answer", text: "orphan" }),
      node({ text: "q" }),
      node({ kind: "error", text: "failed" }),
    ];

    expect(buildMessages(chain, "anthropic")).toEqual([{ role: "user", text: "q" }]);
  });
});
