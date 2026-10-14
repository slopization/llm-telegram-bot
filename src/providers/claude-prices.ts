import type { TokenUsage } from "./types.ts";

interface Price {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

const PRICES_PER_MTOK: Record<string, Price> = {
  "claude-fable-5-1": { input: 10, cacheWrite: 12.5, cacheRead: 0.25, output: 50 },
  "claude-fable-5": { input: 10, cacheWrite: 12.5, cacheRead: 1, output: 50 },
  "claude-opus-5-5": { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 },
  "claude-opus-5": { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  "claude-opus-4-8": { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  "claude-opus-4-7": { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  "claude-opus-4-6": { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  "claude-opus-4-5": { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  "claude-sonnet-5-5": { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 },
  "claude-sonnet-5": { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 },
  "claude-sonnet-4-6": { input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
  "claude-sonnet-4-5": { input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
  "claude-haiku-5-5": { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 },
  "claude-haiku-4-5": { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 },
};

const HAIKU_5_5_LONG: Price = { input: 0.5, cacheWrite: 0.625, cacheRead: 0.05, output: 2.5 };
const HAIKU_5_5_LONG_THRESHOLD = 100_000;
const WEB_SEARCH_USD = 10 / 1000;

function baseModel(model: string): string {
  return model.replace(/-\d{8}$/, "");
}

export function claudePrice(model: string): Price | undefined {
  return PRICES_PER_MTOK[baseModel(model)];
}

export function claudeCost(model: string, usage: TokenUsage): number | undefined {
  const base = claudePrice(model);
  if (base === undefined) return undefined;
  const promptTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const price =
    baseModel(model) === "claude-haiku-5-5" && promptTokens > HAIKU_5_5_LONG_THRESHOLD
      ? HAIKU_5_5_LONG
      : base;
  const tokens =
    usage.inputTokens * price.input +
    usage.cacheWriteTokens * price.cacheWrite +
    usage.cacheReadTokens * price.cacheRead +
    usage.outputTokens * price.output;
  return tokens / 1_000_000 + usage.webSearches * WEB_SEARCH_USD;
}
