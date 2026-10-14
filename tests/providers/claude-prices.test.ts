import { describe, expect, it } from "vitest";
import { claudeCost } from "../../src/providers/claude-prices.ts";

const usage = (overrides: Partial<Parameters<typeof claudeCost>[1]> = {}) => ({
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  webSearches: 0,
  ...overrides,
});

describe("claudeCost", () => {
  it("prices every token category per million tokens", () => {
    const cost = claudeCost(
      "claude-sonnet-5-5",
      usage({
        inputTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    );

    expect(cost).toBeCloseTo(2 + 2.5 + 0.1 + 10);
  });

  it("adds ten dollars per thousand web searches", () => {
    expect(claudeCost("claude-sonnet-5-5", usage({ webSearches: 3 }))).toBeCloseTo(0.03);
  });

  it("uses long-context Haiku 5.5 prices above 100K prompt tokens", () => {
    expect(claudeCost("claude-haiku-5-5", usage({ inputTokens: 100_000 }))).toBeCloseTo(0.01);
    expect(claudeCost("claude-haiku-5-5", usage({ inputTokens: 200_000 }))).toBeCloseTo(0.1);
  });

  it("accepts dated model ids and rejects unknown models", () => {
    expect(claudeCost("claude-haiku-4-5-20251001", usage({ outputTokens: 1_000_000 }))).toBe(5);
    expect(claudeCost("claude-unknown", usage())).toBeUndefined();
  });
});
