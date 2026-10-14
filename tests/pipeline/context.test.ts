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

  it("skips error and run nodes and leading assistant turns", () => {
    const chain = [
      node({ kind: "answer", text: "orphan" }),
      node({ text: "q" }),
      node({ kind: "error", text: "failed" }),
    ];

    expect(buildMessages(chain, "anthropic")).toEqual([{ role: "user", text: "q" }]);
  });
});
