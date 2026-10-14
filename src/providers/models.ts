import type { FeaturedTier } from "../config.ts";
import type { ModelInfo } from "./types.ts";

const NON_CHAT_MODEL =
  /(^|[-_./])(image|dall-e|audio|tts|transcribe|whisper|realtime|embed|embedding|moderation|auto-review)($|[-_./\d])/i;
const GPT_CHAT_MODEL = /^gpt-\d+(\.\d+)?(-|$)/i;

export function isChatModel(id: string): boolean {
  if (/^gpt-/i.test(id) && !GPT_CHAT_MODEL.test(id)) return false;
  return !NON_CHAT_MODEL.test(id);
}

function byPriceThenId(a: ModelInfo, b: ModelInfo): number {
  const priceA = a.outputPricePerMTok ?? Number.POSITIVE_INFINITY;
  const priceB = b.outputPricePerMTok ?? Number.POSITIVE_INFINITY;
  return priceA === priceB ? a.id.localeCompare(b.id) : priceA - priceB;
}

export function sortModels(models: readonly ModelInfo[]): ModelInfo[] {
  return [...models].sort((a, b) => a.vendor.localeCompare(b.vendor) || byPriceThenId(a, b));
}

function pickByTier<T>(sorted: readonly T[], tier: FeaturedTier): T | undefined {
  switch (tier) {
    case "cheap":
      return sorted[0];
    case "medium":
      return sorted[Math.floor((sorted.length - 1) / 2)];
    case "expensive":
      return sorted.at(-1);
  }
}

export function representatives(models: readonly ModelInfo[], tier: FeaturedTier): ModelInfo[] {
  const groups = Map.groupBy(models, (model) => model.vendor);
  const picks: ModelInfo[] = [];
  for (const vendor of [...groups.keys()].sort()) {
    const all = groups.get(vendor) ?? [];
    const current = all.filter((model) => !model.legacy);
    const group = current.length > 0 ? current : all;
    const priced = group.filter((model) => model.outputPricePerMTok !== undefined);
    const pool = priced.length > 0 ? priced : group;
    const pick = pickByTier([...pool].sort(byPriceThenId), tier);
    if (pick !== undefined) picks.push(pick);
  }
  return picks;
}

export function page<T>(items: readonly T[], index: number, size: number) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(index, 0), pages - 1);
  return { items: items.slice(current * size, (current + 1) * size), current, pages };
}
