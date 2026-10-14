import { describe, expect, it } from "vitest";
import type { Config } from "../../src/config.ts";
import { generateAnswer } from "../../src/pipeline/answer.ts";
import type { ChatAdapter, ChatEvent, ChatRequest, ToolCall } from "../../src/providers/types.ts";
import type { RunResult, Sandbox } from "../../src/sandbox/run.ts";

const limits: Config["sandbox"] = {
  enabled: true,
  dailyLimitPerUser: 50,
  maxRunsPerRequest: 5,
  timeoutSeconds: 10,
  memoryMb: 512,
  cpus: 1,
  pids: 128,
  diskMb: 64,
  outputChars: 3500,
  maxFiles: 10,
  concurrency: 2,
};

const runResult: RunResult = {
  stdout: "42\n",
  stderr: "",
  exitCode: 0,
  timedOut: false,
  outOfMemory: false,
  durationMs: 10,
  files: [{ name: "plot.png", data: Buffer.from("png") }],
  totalFiles: 1,
};

function scriptedAdapter(rounds: { text: string; toolCalls?: ToolCall[] }[]) {
  const requests: ChatRequest[] = [];
  const adapter: ChatAdapter = {
    kind: "openai-chat",
    supportsWebSearch: false,
    async *stream(request): AsyncIterable<ChatEvent> {
      requests.push(request);
      const round = rounds[requests.length - 1] ?? { text: "" };
      if (round.text !== "") yield { type: "text", text: round.text };
      yield {
        type: "done",
        inputTokens: 10,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 5,
        webSearches: 0,
        toolCalls: round.toolCalls ?? [],
        native: { round: requests.length },
      };
    },
  };
  return { adapter, requests };
}

function fakeSandbox(): { runner: Sandbox; runs: string[] } {
  const runs: string[] = [];
  const runner = {
    run: async (_language: string, code: string) => {
      runs.push(code);
      return runResult;
    },
  } as unknown as Sandbox;
  return { runner, runs };
}

const runCall = (id: string): ToolCall => ({
  id,
  name: "run_code",
  arguments: { language: "python", code: "print(42)" },
});

function request(adapter: ChatAdapter, runner: Sandbox | undefined, runsAllowed = 5) {
  return {
    adapter,
    model: "m",
    messages: [{ role: "user" as const, text: "q" }],
    webSearch: undefined,
    sandbox: runner === undefined ? undefined : { runner, limits, runsAllowed },
    signal: new AbortController().signal,
    onUpdate: () => undefined,
  };
}

describe("generateAnswer", () => {
  it("returns a plain answer without tools", async () => {
    const { adapter, requests } = scriptedAdapter([{ text: "hello" }]);

    const result = await generateAnswer(request(adapter, undefined));

    expect(result.segments).toEqual([{ kind: "text", markdown: "hello" }]);
    expect(requests[0]?.functions).toEqual([]);
    expect(result.transcript).toHaveLength(1);
    expect(result.costUsd).toBeUndefined();
  });

  it("sums the cost of every round when the provider prices the model", async () => {
    const { adapter } = scriptedAdapter([{ text: "", toolCalls: [runCall("c1")] }, { text: "ok" }]);
    const { runner } = fakeSandbox();

    const result = await generateAnswer({
      ...request(adapter, runner),
      costOf: (usage) => usage.inputTokens / 1000,
    });

    expect(result.costUsd).toBeCloseTo(0.02);
  });

  it("runs requested code and feeds the result back", async () => {
    const { adapter, requests } = scriptedAdapter([
      { text: "running", toolCalls: [runCall("c1")] },
      { text: "the answer is 42" },
    ]);
    const { runner, runs } = fakeSandbox();

    const result = await generateAnswer(request(adapter, runner));

    expect(runs).toEqual(["print(42)"]);
    expect(result.sandboxRuns).toBe(1);
    expect(result.media).toEqual([{ type: "image", mime: "image/png", data: Buffer.from("png") }]);
    expect(result.segments.map((segment) => segment.kind)).toEqual(["text", "run", "text"]);
    expect(requests[1]?.messages.at(-1)).toMatchObject({
      role: "tool",
      callId: "c1",
      name: "run_code",
    });
    expect(result.inputTokens).toBe(20);
  });

  it("refuses runs beyond the allowed count", async () => {
    const { adapter, requests } = scriptedAdapter([
      { text: "", toolCalls: [runCall("c1"), runCall("c2")] },
      { text: "done" },
    ]);
    const { runner, runs } = fakeSandbox();

    await generateAnswer(request(adapter, runner, 1));

    expect(runs).toHaveLength(1);
    const toolMessages = requests[1]?.messages.filter((message) => message.role === "tool") ?? [];
    expect(toolMessages[1]).toMatchObject({ callId: "c2" });
    expect(toolMessages[1]?.role === "tool" && toolMessages[1].text).toContain("limit");
  });

  it("stops after the round cap even if the model keeps calling tools", async () => {
    const endless = Array.from({ length: 10 }, (_, index) => ({
      text: "",
      toolCalls: [runCall(`c${index}`)],
    }));
    const { adapter, requests } = scriptedAdapter(endless);
    const { runner } = fakeSandbox();

    await generateAnswer(request(adapter, runner, 2));

    expect(requests).toHaveLength(4);
  });
});
