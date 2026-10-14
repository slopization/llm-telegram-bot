import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.ts";

const minimal = {
  telegram: { "bot-token": "token" },
  providers: [{ name: "claude-platform", type: "claude", "api-key": "key" }],
};

function withProviders(...providers: unknown[]) {
  return { ...minimal, providers };
}

describe("parseConfig", () => {
  it("fills defaults", () => {
    const config = parseConfig(minimal);

    expect(config.timezone).toBe("Asia/Seoul");
    expect(config.telegram.allowedUserIds).toEqual([]);
    expect(config.telegram.draftIntervalMs).toBe(1000);
    expect(config.chat).toEqual({
      maxContextNodes: 50,
      timeoutSeconds: 600,
      featuredModels: "medium",
    });
    expect(config.providers[0]?.apiUrl).toBe("https://api.anthropic.com");
    expect(config.tools.webSearch).toEqual({
      enabled: true,
      maxUsesPerRequest: 3,
      dailyLimitPerUser: 50,
    });
    expect(config.sandbox).toEqual({
      enabled: true,
      dailyLimitPerUser: 50,
      maxRunsPerRequest: 5,
      timeoutSeconds: 10,
      memoryMb: 512,
      cpus: 1,
      pids: 128,
      diskMb: 64,
      outputChars: 3500,
      maxFiles: 10,
      concurrency: 2,
    });
  });

  it("reads provider budgets with a default reset day", () => {
    const config = parseConfig(
      withProviders({ name: "c", type: "claude", "api-key": "k", "monthly-budget-usd": 100 }),
    );

    expect(config.providers[0]).toMatchObject({ monthlyBudgetUsd: 100, budgetResetDay: 1 });
    expect(parseConfig(minimal).providers[0]?.monthlyBudgetUsd).toBeUndefined();
  });

  it("reads an optional management key and treats empty as missing", () => {
    const provider = (key: string) =>
      parseConfig(
        withProviders({
          name: "codex",
          type: "openai-compatible",
          "api-url": "http://localhost:8317/v1",
          "api-key": "k",
          "management-key": key,
        }),
      ).providers[0]?.managementKey;

    expect(provider("secret")).toBe("secret");
    expect(provider("")).toBeUndefined();
  });

  it("rejects a reset day past 31", () => {
    expect(() =>
      parseConfig(
        withProviders({ name: "c", type: "claude", "api-key": "k", "budget-reset-day": 32 }),
      ),
    ).toThrow("config.providers[0].budget-reset-day: must be between 1 and 31");
  });

  it("reads the featured model tier", () => {
    expect(
      parseConfig({ ...minimal, chat: { "featured-models": "cheap" } }).chat.featuredModels,
    ).toBe("cheap");
    expect(() => parseConfig({ ...minimal, chat: { "featured-models": "free" } })).toThrow(
      "config.chat.featured-models: must be one of cheap, medium, expensive",
    );
  });

  it("accepts fractional cpus", () => {
    expect(parseConfig({ ...minimal, sandbox: { cpus: 0.5 } }).sandbox.cpus).toBe(0.5);
  });

  it("rejects a zero sandbox timeout", () => {
    expect(() => parseConfig({ ...minimal, sandbox: { "timeout-seconds": 0 } })).toThrow(
      "config.sandbox.timeout-seconds: must be a positive integer",
    );
  });

  it("uses the mindlogic default url for an empty api-url", () => {
    const config = parseConfig(
      withProviders({ name: "mindlogic", type: "mindlogic", "api-url": "", "api-key": "key" }),
    );

    expect(config.providers[0]?.apiUrl).toBe("https://factchat-cloud.mindlogic.ai/v1/gateway");
  });

  it("keeps an explicit api-url", () => {
    const config = parseConfig(
      withProviders({
        name: "proxy",
        type: "claude",
        "api-url": "https://proxy.example",
        "api-key": "key",
      }),
    );

    expect(config.providers[0]?.apiUrl).toBe("https://proxy.example");
  });

  it("requires api-url for openai-compatible", () => {
    expect(() =>
      parseConfig(withProviders({ name: "router", type: "openai-compatible", "api-key": "key" })),
    ).toThrow("config.providers[0].api-url: is required for type openai-compatible");
  });

  it("rejects unknown provider types", () => {
    expect(() =>
      parseConfig(withProviders({ name: "x", type: "gemini", "api-key": "key" })),
    ).toThrow("config.providers[0].type: must be one of");
  });

  it("rejects duplicate provider names", () => {
    const entry = { name: "same", type: "claude", "api-key": "key" };

    expect(() => parseConfig(withProviders(entry, entry))).toThrow('duplicate name "same"');
  });

  it("rejects an empty bot token", () => {
    expect(() => parseConfig({ ...minimal, telegram: { "bot-token": "" } })).toThrow(
      "config.telegram.bot-token: must not be empty",
    );
  });

  it("rejects negative tool limits", () => {
    expect(() =>
      parseConfig({ ...minimal, tools: { "web-search": { "daily-limit-per-user": -1 } } }),
    ).toThrow("config.tools.web-search.daily-limit-per-user: must be a non-negative integer");
  });
});
