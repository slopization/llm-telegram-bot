import { describe, expect, it } from "vitest";
import { googleCost } from "../../src/providers/google-prices.ts";

const usage = (overrides: Partial<Parameters<typeof googleCost>[1]> = {}) => ({
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  webSearches: 0,
  ...overrides,
});

const MILLION = 1_000_000;

describe("googleCost", () => {
  it("prices input, cached and output tokens per million tokens", () => {
    const cost = googleCost(
      "gemini-3.5-flash-lite",
      usage({ inputTokens: MILLION, cacheReadTokens: MILLION, outputTokens: MILLION }),
      "2026-11-23",
    );

    expect(cost).toBeCloseTo(0.3 + 0.03 + 2.5);
  });

  it("switches to the scheduled price on its start day", () => {
    const output = usage({ outputTokens: MILLION });

    expect(googleCost("gemini-4-carbon", output, "2026-11-30")).toBe(10);
    expect(googleCost("gemini-4-carbon", output, "2026-12-01")).toBe(20);
  });

  it("uses long-context prices above 200K prompt tokens", () => {
    expect(googleCost("gemini-2.5-pro", usage({ inputTokens: 200_000 }), "2026-11-23")).toBe(0.25);
    expect(googleCost("gemini-2.5-pro", usage({ inputTokens: 400_000 }), "2026-11-23")).toBe(1);
  });

  it("charges Gemini 3 searches per query and Gemini 2.5 searches per prompt", () => {
    const searches = usage({ webSearches: 3 });

    expect(googleCost("gemini-3.5-flash-lite", searches, "2026-11-23")).toBeCloseTo(0.042);
    expect(googleCost("gemini-2.5-flash", searches, "2026-11-23")).toBeCloseTo(0.035);
  });

  it("returns undefined for unknown models", () => {
    expect(googleCost("gemma-4-27b-it", usage(), "2026-11-23")).toBeUndefined();
  });
});
