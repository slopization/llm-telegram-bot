import { describe, expect, it } from "vitest";
import {
  adapterKindFromEndpoints,
  aiStudioModel,
  mindlogicOutputPrice,
} from "../../src/providers/registry.ts";

describe("aiStudioModel", () => {
  it("strips the models/ prefix and keeps the output limit and price", () => {
    expect(
      aiStudioModel(
        {
          name: "models/gemini-3.5-flash-lite",
          supportedActions: ["generateContent", "countTokens"],
          outputTokenLimit: 65536,
        },
        "2026-11-23",
      ),
    ).toEqual({
      id: "gemini-3.5-flash-lite",
      vendor: "google",
      outputPricePerMTok: 2.5,
      webSearch: true,
      maxOutputTokens: 65536,
      legacy: false,
    });
  });

  it("disables web search for non-gemini models", () => {
    expect(
      aiStudioModel(
        { name: "models/gemma-4-27b-it", supportedActions: ["generateContent"] },
        "2026-11-23",
      )?.webSearch,
    ).toBe(false);
  });

  it("skips models without generateContent", () => {
    expect(
      aiStudioModel(
        { name: "models/text-embedding-004", supportedActions: ["embedContent"] },
        "2026-11-23",
      ),
    ).toBeUndefined();
  });
});

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
