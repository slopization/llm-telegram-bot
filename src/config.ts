import { readFileSync } from "node:fs";

export const PROVIDER_TYPES = ["claude", "openai-compatible", "mindlogic"] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const OPENAI_APIS = ["chat-completions", "responses"] as const;
export type OpenAIApi = (typeof OPENAI_APIS)[number];

export const FEATURED_TIERS = ["cheap", "medium", "expensive"] as const;
export type FeaturedTier = (typeof FEATURED_TIERS)[number];

const DEFAULT_API_URLS: Record<ProviderType, string | undefined> = {
  claude: "https://api.anthropic.com",
  "openai-compatible": undefined,
  mindlogic: "https://factchat-cloud.mindlogic.ai/v1/gateway",
};

export interface ProviderConfig {
  name: string;
  type: ProviderType;
  apiUrl: string;
  apiKey: string;
  monthlyBudgetUsd: number | undefined;
  budgetResetDay: number;
  managementKey: string | undefined;
  api: OpenAIApi;
}

export interface Config {
  timezone: string;
  telegram: {
    botToken: string;
    allowedUserIds: number[];
    allowedChatIds: number[];
    draftIntervalMs: number;
  };
  chat: {
    maxContextNodes: number;
    timeoutSeconds: number;
    featuredModels: FeaturedTier;
  };
  providers: ProviderConfig[];
  tools: {
    webSearch: { enabled: boolean; maxUsesPerRequest: number; dailyLimitPerUser: number };
    webFetch: {
      enabled: boolean;
      maxUsesPerRequest: number;
      timeoutSeconds: number;
      maxDownloadMb: number;
      outputChars: number;
    };
  };
  sandbox: {
    enabled: boolean;
    dailyLimitPerUser: number;
    maxRunsPerRequest: number;
    timeoutSeconds: number;
    memoryMb: number;
    cpus: number;
    pids: number;
    diskMb: number;
    outputChars: number;
    maxFiles: number;
    concurrency: number;
  };
}

type Json = Record<string, unknown>;

class ConfigError extends Error {
  constructor(path: string, problem: string) {
    super(`config.${path}: ${problem}`);
    this.name = "ConfigError";
  }
}

function object(value: unknown, path: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigError(path, "must be an object");
  }
  return value as Json;
}

function string(value: unknown, path: string, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string") throw new ConfigError(path, "must be a string");
  return value;
}

function nonEmptyString(value: unknown, path: string): string {
  const result = string(value, path);
  if (result === "") throw new ConfigError(path, "must not be empty");
  return result;
}

function boolean(value: unknown, path: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new ConfigError(path, "must be a boolean");
  return value;
}

function count(value: unknown, path: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ConfigError(path, "must be a non-negative integer");
  }
  return value;
}

function positiveCount(value: unknown, path: string, fallback: number): number {
  const result = count(value, path, fallback);
  if (result === 0) throw new ConfigError(path, "must be a positive integer");
  return result;
}

function positiveNumber(value: unknown, path: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !(value > 0)) {
    throw new ConfigError(path, "must be a positive number");
  }
  return value;
}

function ids(value: unknown, path: string): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(Number.isSafeInteger)) {
    throw new ConfigError(path, "must be an array of integers");
  }
  return value as number[];
}

function featuredTier(value: unknown): FeaturedTier {
  const tier = string(value, "chat.featured-models", "medium");
  if (!(FEATURED_TIERS as readonly string[]).includes(tier)) {
    throw new ConfigError("chat.featured-models", `must be one of ${FEATURED_TIERS.join(", ")}`);
  }
  return tier as FeaturedTier;
}

function providerType(value: unknown, path: string): ProviderType {
  const type = string(value, path);
  if (!(PROVIDER_TYPES as readonly string[]).includes(type)) {
    throw new ConfigError(path, `must be one of ${PROVIDER_TYPES.join(", ")}`);
  }
  return type as ProviderType;
}

function openAIApi(value: unknown, path: string): OpenAIApi {
  const api = string(value, path, "chat-completions");
  if (!(OPENAI_APIS as readonly string[]).includes(api)) {
    throw new ConfigError(path, `must be one of ${OPENAI_APIS.join(", ")}`);
  }
  return api as OpenAIApi;
}

function provider(value: unknown, path: string): ProviderConfig {
  const raw = object(value, path);
  const type = providerType(raw.type, `${path}.type`);
  const apiUrl = string(raw["api-url"], `${path}.api-url`, "") || DEFAULT_API_URLS[type];
  if (apiUrl === undefined) {
    throw new ConfigError(`${path}.api-url`, `is required for type ${type}`);
  }
  const budgetPath = `${path}.monthly-budget-usd`;
  const resetDay = positiveCount(raw["budget-reset-day"], `${path}.budget-reset-day`, 1);
  if (resetDay > 31) throw new ConfigError(`${path}.budget-reset-day`, "must be between 1 and 31");
  return {
    name: nonEmptyString(raw.name, `${path}.name`),
    type,
    apiUrl,
    apiKey: nonEmptyString(raw["api-key"], `${path}.api-key`),
    monthlyBudgetUsd:
      raw["monthly-budget-usd"] === undefined
        ? undefined
        : positiveNumber(raw["monthly-budget-usd"], budgetPath, 0),
    budgetResetDay: resetDay,
    managementKey: string(raw["management-key"], `${path}.management-key`, "") || undefined,
    api: openAIApi(raw.api, `${path}.api`),
  };
}

function providers(value: unknown): ProviderConfig[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConfigError("providers", "must be a non-empty array");
  }
  const result = value.map((entry, index) => provider(entry, `providers[${index}]`));
  const names = result.map((entry) => entry.name);
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate !== undefined) {
    throw new ConfigError("providers", `duplicate name "${duplicate}"`);
  }
  return result;
}

function sandbox(value: unknown): Config["sandbox"] {
  const raw = value === undefined ? {} : object(value, "sandbox");
  const at = (key: string) => [raw[key], `sandbox.${key}`] as const;
  return {
    enabled: boolean(...at("enabled"), true),
    dailyLimitPerUser: count(...at("daily-limit-per-user"), 50),
    maxRunsPerRequest: count(...at("max-runs-per-request"), 5),
    timeoutSeconds: positiveCount(...at("timeout-seconds"), 10),
    memoryMb: positiveCount(...at("memory-mb"), 512),
    cpus: positiveNumber(...at("cpus"), 1),
    pids: positiveCount(...at("pids"), 128),
    diskMb: positiveCount(...at("disk-mb"), 64),
    outputChars: positiveCount(...at("output-chars"), 3500),
    maxFiles: count(...at("max-files"), 10),
    concurrency: positiveCount(...at("concurrency"), 2),
  };
}

function webFetch(value: unknown): Config["tools"]["webFetch"] {
  const raw = value === undefined ? {} : object(value, "tools.web-fetch");
  const at = (key: string) => [raw[key], `tools.web-fetch.${key}`] as const;
  return {
    enabled: boolean(...at("enabled"), true),
    maxUsesPerRequest: count(...at("max-uses-per-request"), 5),
    timeoutSeconds: positiveCount(...at("timeout-seconds"), 15),
    maxDownloadMb: positiveNumber(...at("max-download-mb"), 5),
    outputChars: positiveCount(...at("output-chars"), 20000),
  };
}

export function parseConfig(value: unknown): Config {
  const raw = object(value, "(root)");
  const telegram = object(raw.telegram, "telegram");
  const tools = raw.tools === undefined ? {} : object(raw.tools, "tools");
  const webSearch =
    tools["web-search"] === undefined ? {} : object(tools["web-search"], "tools.web-search");
  const chat = raw.chat === undefined ? {} : object(raw.chat, "chat");

  return {
    timezone: string(raw.timezone, "timezone", "Asia/Seoul"),
    telegram: {
      botToken: nonEmptyString(telegram["bot-token"], "telegram.bot-token"),
      allowedUserIds: ids(telegram["allowed-user-ids"], "telegram.allowed-user-ids"),
      allowedChatIds: ids(telegram["allowed-chat-ids"], "telegram.allowed-chat-ids"),
      draftIntervalMs: positiveCount(
        telegram["draft-interval-ms"],
        "telegram.draft-interval-ms",
        1000,
      ),
    },
    chat: {
      maxContextNodes: positiveCount(chat["max-context-nodes"], "chat.max-context-nodes", 50),
      timeoutSeconds: positiveCount(chat["timeout-seconds"], "chat.timeout-seconds", 600),
      featuredModels: featuredTier(chat["featured-models"]),
    },
    providers: providers(raw.providers),
    tools: {
      webSearch: {
        enabled: boolean(webSearch.enabled, "tools.web-search.enabled", true),
        maxUsesPerRequest: count(
          webSearch["max-uses-per-request"],
          "tools.web-search.max-uses-per-request",
          3,
        ),
        dailyLimitPerUser: count(
          webSearch["daily-limit-per-user"],
          "tools.web-search.daily-limit-per-user",
          50,
        ),
      },
      webFetch: webFetch(tools["web-fetch"]),
    },
    sandbox: sandbox(raw.sandbox),
  };
}

export function loadConfig(path = "config.json"): Config {
  return parseConfig(JSON.parse(readFileSync(path, "utf8")));
}
