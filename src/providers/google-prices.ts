import type { TokenUsage } from "./types.ts";

interface Price {
  input: number;
  cacheRead: number;
  output: number;
}

interface ModelPrice {
  base: Price;
  longContext?: Price;
  scheduled?: { from: string; price: Price };
  searchUsd: number;
  searchPerPrompt?: boolean;
}

const LONG_CONTEXT_THRESHOLD = 200_000;
const SEARCH_GEMINI_3 = 14 / 1000;
const SEARCH_GEMINI_2_5 = 35 / 1000;

const PRICES_PER_MTOK: Record<string, ModelPrice> = {
  "gemini-4-carbon": {
    base: { input: 2, cacheRead: 0.1, output: 10 },
    scheduled: { from: "2026-12-01", price: { input: 4, cacheRead: 0.2, output: 20 } },
    searchUsd: SEARCH_GEMINI_3,
  },
  "gemini-4-argon": {
    base: { input: 2, cacheRead: 0.1, output: 10 },
    scheduled: { from: "2026-12-01", price: { input: 4, cacheRead: 0.2, output: 20 } },
    searchUsd: SEARCH_GEMINI_3,
  },
  "gemini-4-neon": {
    base: { input: 3, cacheRead: 0.15, output: 15 },
    searchUsd: SEARCH_GEMINI_3,
  },
  "gemini-4-hydrogen": {
    base: { input: 1.5, cacheRead: 0.075, output: 7.5 },
    searchUsd: SEARCH_GEMINI_3,
  },
  "gemini-3.8-flash": {
    base: { input: 0.75, cacheRead: 0.075, output: 3.75 },
    scheduled: { from: "2027-01-01", price: { input: 1.5, cacheRead: 0.15, output: 7.5 } },
    searchUsd: SEARCH_GEMINI_3,
  },
  "gemini-3.6-flash": {
    base: { input: 0.75, cacheRead: 0.075, output: 3.75 },
    scheduled: { from: "2027-01-01", price: { input: 1.5, cacheRead: 0.15, output: 7.5 } },
    searchUsd: SEARCH_GEMINI_3,
  },
  "gemini-3.5-flash-lite": {
    base: { input: 0.3, cacheRead: 0.03, output: 2.5 },
    searchUsd: SEARCH_GEMINI_3,
  },
  "gemini-3.1-flash-lite": {
    base: { input: 0.25, cacheRead: 0.025, output: 1.5 },
    searchUsd: SEARCH_GEMINI_3,
  },
  "gemini-3.1-pro-preview": {
    base: { input: 2, cacheRead: 0.2, output: 12 },
    longContext: { input: 4, cacheRead: 0.4, output: 18 },
    searchUsd: SEARCH_GEMINI_3,
  },
  "gemini-3-flash-preview": {
    base: { input: 0.5, cacheRead: 0.05, output: 3 },
    searchUsd: SEARCH_GEMINI_3,
  },
  "gemini-2.5-pro": {
    base: { input: 1.25, cacheRead: 0.125, output: 10 },
    longContext: { input: 2.5, cacheRead: 0.25, output: 15 },
    searchUsd: SEARCH_GEMINI_2_5,
    searchPerPrompt: true,
  },
  "gemini-2.5-flash": {
    base: { input: 0.3, cacheRead: 0.03, output: 2.5 },
    searchUsd: SEARCH_GEMINI_2_5,
    searchPerPrompt: true,
  },
  "gemini-2.5-flash-lite": {
    base: { input: 0.1, cacheRead: 0.01, output: 0.4 },
    searchUsd: SEARCH_GEMINI_2_5,
    searchPerPrompt: true,
  },
};

function priceOn(model: ModelPrice, day: string): Price {
  return model.scheduled !== undefined && day >= model.scheduled.from
    ? model.scheduled.price
    : model.base;
}

export function googleOutputPrice(model: string, day: string): number | undefined {
  const entry = PRICES_PER_MTOK[model];
  return entry === undefined ? undefined : priceOn(entry, day).output;
}

export function googleCost(model: string, usage: TokenUsage, day: string): number | undefined {
  const entry = PRICES_PER_MTOK[model];
  if (entry === undefined) return undefined;
  const promptTokens = usage.inputTokens + usage.cacheReadTokens;
  const price =
    entry.longContext !== undefined && promptTokens > LONG_CONTEXT_THRESHOLD
      ? entry.longContext
      : priceOn(entry, day);
  const tokens =
    usage.inputTokens * price.input +
    usage.cacheReadTokens * price.cacheRead +
    usage.outputTokens * price.output;
  const searches = entry.searchPerPrompt ? Math.min(usage.webSearches, 1) : usage.webSearches;
  return tokens / 1_000_000 + searches * entry.searchUsd;
}
