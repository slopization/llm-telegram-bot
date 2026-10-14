import { describe, expect, it } from "vitest";
import { adapterKindFromEndpoints, mindlogicOutputPrice } from "../../src/providers/registry.ts";

describe("adapterKindFromEndpoints", () => {
  it.each([
    [["/v1/gateway/chat/completions/", "/v1/gateway/claude/v1/messages/"], "anthropic"],
    [
      [
        "/v1/gateway/chat/completions/",
        "/v1/gateway/gemini/v1beta/models/gemini-3.5-flash:generateContent",
      ],
      "gemini",
    ],
    [["/v1/gateway/chat/completions/", "/v1/gateway/responses/"], "openai-responses"],
    [["/v1/gateway/chat/completions/"], "openai-chat"],
    [[], "openai-chat"],
  ])("routes %j to %s", (endpoints, kind) => {
    expect(adapterKindFromEndpoints(endpoints)).toBe(kind);
  });
});

describe("mindlogicOutputPrice", () => {
  it("converts the output price to dollars per million tokens", () => {
    expect(mindlogicOutputPrice({ per_tokens: 1_000_000, output: 10 })).toBe(10);
    expect(mindlogicOutputPrice({ per_tokens: 1000, output: 0.01 })).toBeCloseTo(10);
  });

  it("returns undefined without pricing", () => {
    expect(mindlogicOutputPrice(undefined)).toBeUndefined();
    expect(mindlogicOutputPrice({ output: 10 })).toBeUndefined();
  });
});
