import { readFileSync } from "node:fs";
import { type ProviderConfig, type ProviderType, parseConfig } from "../../src/config.ts";

export { USER_AGENT } from "../../src/providers/registry.ts";

function configuredProviders(): ProviderConfig[] {
  const raw = JSON.parse(readFileSync("config.json", "utf8")) as {
    telegram?: Record<string, unknown>;
    providers?: { "api-key"?: unknown }[];
  };
  const withKeys = (raw.providers ?? []).filter(
    (provider) => typeof provider["api-key"] === "string" && provider["api-key"] !== "",
  );
  if (withKeys.length === 0) return [];
  return parseConfig({
    ...raw,
    telegram: { ...raw.telegram, "bot-token": raw.telegram?.["bot-token"] || "unused" },
    providers: withKeys,
  }).providers;
}

export function providerOf(type: ProviderType): ProviderConfig {
  const found = configuredProviders().find((provider) => provider.type === type);
  if (found === undefined)
    throw new Error(`config.json has no provider of type ${type} with a key`);
  return found;
}

export function arg(index: number, fallback: string): string {
  return process.argv[2 + index] ?? fallback;
}

export function show(label: string, value: unknown): void {
  console.log(`\n== ${label}`);
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}
