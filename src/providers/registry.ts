import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import type { ProviderConfig } from "../config.ts";
import type { Logger } from "../log.ts";
import { AnthropicAdapter } from "./anthropic.ts";
import { claudeCost, claudePrice } from "./claude-prices.ts";
import { fetchCodexUsage, parseCodexQuota } from "./codex-quota.ts";
import { GeminiAdapter } from "./gemini.ts";
import { isChatModel } from "./models.ts";
import { OpenAIChatAdapter } from "./openai-chat.ts";
import { OpenAIPrices } from "./openai-prices.ts";
import { OpenAIResponsesAdapter } from "./openai-responses.ts";
import type {
  AdapterKind,
  ChatAdapter,
  CreditBalance,
  ModelInfo,
  Provider,
  QuotaSnapshot,
} from "./types.ts";

export const USER_AGENT = "llm-telegram-bot";

const MODEL_LIST_TTL_MS = 60 * 1000;

export function adapterKindFromEndpoints(endpoints: readonly string[]): AdapterKind {
  if (endpoints.some((endpoint) => endpoint.includes("/claude/"))) return "anthropic";
  if (endpoints.some((endpoint) => endpoint.includes("/gemini/"))) return "gemini";
  if (endpoints.some((endpoint) => endpoint.includes("/responses"))) return "openai-responses";
  return "openai-chat";
}

class CachedModels {
  private value: ModelInfo[] | undefined;
  private fetchedAt = 0;
  private readonly load: () => Promise<ModelInfo[]>;

  constructor(load: () => Promise<ModelInfo[]>) {
    this.load = load;
  }

  async get(): Promise<ModelInfo[]> {
    if (this.value === undefined || Date.now() - this.fetchedAt > MODEL_LIST_TTL_MS) {
      this.value = (await this.load()).filter((model) => isChatModel(model.id));
      this.fetchedAt = Date.now();
    }
    return this.value;
  }
}

function claudeProvider(config: ProviderConfig): Provider {
  const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.apiUrl });
  const adapter = new AnthropicAdapter(client);
  const models = new CachedModels(async () => {
    const result: ModelInfo[] = [];
    for await (const model of client.models.list({ limit: 100 })) {
      if (model.lifecycle === "retired") continue;
      result.push({
        id: model.id,
        vendor: "anthropic",
        outputPricePerMTok: claudePrice(model.id)?.output,
        webSearch: model.capabilities?.server_tools.web_search.supported ?? true,
        maxOutputTokens: model.max_tokens ?? undefined,
        legacy: model.lifecycle === "deprecated",
      });
    }
    return result;
  });
  return {
    name: config.name,
    listModels: () => models.get(),
    adapterFor: () => adapter,
    costOf: claudeCost,
  };
}

function openAICompatibleProvider(config: ProviderConfig, logger: Logger | undefined): Provider {
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.apiUrl });
  const prices = new OpenAIPrices(logger);
  let quota: QuotaSnapshot | undefined;
  const onHeaders = (headers: Headers) => {
    quota = parseCodexQuota(headers, Date.now()) ?? quota;
  };
  const responses = config.api === "responses";
  const adapter: ChatAdapter = responses
    ? new OpenAIResponsesAdapter(client, { onHeaders, limitsToolCalls: false })
    : new OpenAIChatAdapter(client, onHeaders);
  const models = new CachedModels(async () => {
    await prices.refreshIfStale();
    const result: ModelInfo[] = [];
    for await (const model of client.models.list()) {
      result.push({
        id: model.id,
        vendor: model.owned_by || config.name,
        outputPricePerMTok: prices.output(model.id),
        webSearch: responses,
        maxOutputTokens: undefined,
        legacy: false,
      });
    }
    return result;
  });
  const managementKey = config.managementKey;
  const currentQuota = async (): Promise<QuotaSnapshot | undefined> => {
    if (managementKey === undefined) return quota;
    try {
      quota =
        (await fetchCodexUsage(new URL(config.apiUrl).origin, managementKey, Date.now())) ?? quota;
    } catch (err) {
      logger?.warn({ err, provider: config.name }, "codex usage request failed");
    }
    return quota;
  };
  return {
    name: config.name,
    listModels: () => models.get(),
    adapterFor: () => adapter,
    quota: currentQuota,
  };
}

interface MindlogicPricing {
  per_tokens?: number;
  output?: number;
  web_search_per_1k?: number | null;
}

interface MindlogicModel {
  id: string;
  owned_by?: string;
  lifecycle?: string;
  endpoints?: string[];
  max_output_tokens?: number | null;
  pricing?: MindlogicPricing;
}

interface MindlogicCredits {
  monthly_allocated?: { renewal_date?: string };
  total?: { quota?: number; remaining?: number };
}

export function mindlogicOutputPrice(pricing: MindlogicPricing | undefined): number | undefined {
  if (pricing?.output === undefined || pricing.per_tokens === undefined) return undefined;
  return (pricing.output * 1_000_000) / pricing.per_tokens;
}

function mindlogicProvider(config: ProviderConfig): Provider {
  const headers = { "User-Agent": USER_AGENT };
  const authorized = { ...headers, Authorization: `Bearer ${config.apiKey}` };
  const openai = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.apiUrl,
    defaultHeaders: headers,
  });
  const adapters: Record<AdapterKind, ChatAdapter> = {
    anthropic: new AnthropicAdapter(
      new Anthropic({
        apiKey: config.apiKey,
        baseURL: `${config.apiUrl}/claude`,
        defaultHeaders: headers,
      }),
    ),
    gemini: new GeminiAdapter(
      new GoogleGenAI({
        apiKey: config.apiKey,
        httpOptions: { baseUrl: `${config.apiUrl}/gemini`, headers },
      }),
    ),
    "openai-responses": new OpenAIResponsesAdapter(openai),
    "openai-chat": new OpenAIChatAdapter(openai),
  };
  const kinds = new Map<string, AdapterKind>();
  const models = new CachedModels(async () => {
    const response = await fetch(`${config.apiUrl}/models/?type=llm`, { headers: authorized });
    if (!response.ok) throw new Error(`mindlogic model list failed: ${response.status}`);
    const body = (await response.json()) as { data?: MindlogicModel[] };
    return (body.data ?? []).map((model) => {
      kinds.set(model.id, adapterKindFromEndpoints(model.endpoints ?? []));
      return {
        id: model.id,
        vendor: model.owned_by || config.name,
        outputPricePerMTok: mindlogicOutputPrice(model.pricing),
        webSearch: model.pricing?.web_search_per_1k != null,
        maxOutputTokens: model.max_output_tokens ?? undefined,
        legacy: model.lifecycle === "legacy",
      };
    });
  });
  const balance = async (): Promise<CreditBalance> => {
    const response = await fetch(`${config.apiUrl}/credits/`, { headers: authorized });
    if (!response.ok) throw new Error(`mindlogic credits failed: ${response.status}`);
    const body = (await response.json()) as MindlogicCredits;
    if (body.total?.remaining === undefined || body.total.quota === undefined) {
      throw new Error("mindlogic credits response has no total");
    }
    return {
      remaining: body.total.remaining,
      quota: body.total.quota,
      renewsAt: body.monthly_allocated?.renewal_date,
    };
  };
  return {
    name: config.name,
    listModels: () => models.get(),
    adapterFor: (model) => adapters[kinds.get(model) ?? "openai-chat"],
    balance,
  };
}

export function createProvider(config: ProviderConfig, logger?: Logger): Provider {
  switch (config.type) {
    case "claude":
      return claudeProvider(config);
    case "openai-compatible":
      return openAICompatibleProvider(config, logger);
    case "mindlogic":
      return mindlogicProvider(config);
  }
}
