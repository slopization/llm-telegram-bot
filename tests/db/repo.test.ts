import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/database.ts";
import { type NewNode, Repo } from "../../src/db/repo.ts";

let repo: Repo;

function node(overrides: Partial<NewNode> = {}): NewNode {
  return {
    parentId: null,
    chatId: 1,
    userId: 10,
    kind: "prompt",
    text: "q",
    day: "2026-10-14",
    ...overrides,
  };
}

beforeEach(() => {
  repo = new Repo(openDatabase(":memory:"));
});

describe("Repo", () => {
  it("walks a chain from root to the given node", () => {
    const root = repo.insertNode(node({ text: "q1" }));
    const answer = repo.insertNode(node({ parentId: root, kind: "answer", text: "a1" }));
    const followUp = repo.insertNode(node({ parentId: answer, text: "q2" }));

    expect(repo.chain(followUp, 50).map((n) => n.text)).toEqual(["q1", "a1", "q2"]);
  });

  it("limits the chain to the newest nodes", () => {
    const first = repo.insertNode(node({ text: "1" }));
    const second = repo.insertNode(node({ parentId: first, text: "2" }));
    const third = repo.insertNode(node({ parentId: second, text: "3" }));

    expect(repo.chain(third, 2).map((n) => n.text)).toEqual(["2", "3"]);
  });

  it("keeps branches separate", () => {
    const root = repo.insertNode(node({ text: "root" }));
    const left = repo.insertNode(node({ parentId: root, text: "left" }));
    repo.insertNode(node({ parentId: root, text: "right" }));

    expect(repo.chain(left, 50).map((n) => n.text)).toEqual(["root", "left"]);
  });

  it("finds nodes by any linked message", () => {
    const answer = repo.insertNode(node({ kind: "answer" }));
    repo.linkMessages(1, [100, 101], answer);

    expect(repo.nodeByMessage(1, 101)?.id).toBe(answer);
    expect(repo.nodeByMessage(2, 101)).toBeUndefined();
  });

  it("round-trips transcripts", () => {
    const transcript = {
      adapter: "anthropic" as const,
      messages: [{ role: "user" as const, text: "hi" }],
    };
    const id = repo.insertNode(node({ kind: "answer", transcript }));

    expect(repo.node(id)?.transcript).toEqual(transcript);
  });

  it("sums daily usage per user and day", () => {
    repo.insertNode(node({ kind: "answer", webSearches: 2, sandboxRuns: 1 }));
    repo.insertNode(node({ kind: "run", sandboxRuns: 1 }));
    repo.insertNode(node({ kind: "run", sandboxRuns: 1, day: "2026-10-13" }));
    repo.insertNode(node({ kind: "run", sandboxRuns: 1, userId: 11 }));

    expect(repo.dailyUsage(10, "2026-10-14")).toEqual({ webSearches: 2, sandboxRuns: 2 });
  });

  it("deletes pending selections once", () => {
    const nodeId = repo.insertNode(node());
    repo.createPending({ id: "abc", chatId: 1, userId: 10, nodeId, messageId: 5, threadId: null });

    expect(repo.pending("abc")?.nodeId).toBe(nodeId);
    expect(repo.deletePending("abc")).toBe(true);
    expect(repo.deletePending("abc")).toBe(false);
  });

  it("sums provider spending from a day onward", () => {
    repo.insertNode(node({ kind: "answer", provider: "claude", costUsd: 1.5, day: "2026-10-07" }));
    repo.insertNode(node({ kind: "answer", provider: "claude", costUsd: 0.5, day: "2026-10-14" }));
    repo.insertNode(node({ kind: "answer", provider: "claude", costUsd: 9, day: "2026-10-06" }));
    repo.insertNode(node({ kind: "answer", provider: "other", costUsd: 9, day: "2026-10-14" }));

    expect(repo.spentSince("claude", "2026-10-07")).toBeCloseTo(2);
  });

  it("upserts preferences", () => {
    repo.setPreference(10, "claude", "a");
    repo.setPreference(10, "mindlogic", "b");

    expect(repo.preference(10)).toEqual({ provider: "mindlogic", model: "b" });
  });
});
