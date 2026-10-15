import { describe, expect, it } from "vitest";
import { modelsText } from "../../src/bot/models.ts";
import type { Logger } from "../../src/log.ts";
import type { ModelInfo, Provider } from "../../src/providers/types.ts";

const logger = { error: () => undefined } as unknown as Logger;

const model = (id: string, outputPricePerMTok?: number): ModelInfo => ({
  id,
  vendor: "openai",
  outputPricePerMTok,
  webSearch: false,
  maxOutputTokens: undefined,
  legacy: false,
});

function provider(name: string, listModels: () => Promise<ModelInfo[]>): Provider {
  return { name, listModels, adapterFor: () => undefined as never };
}

describe("modelsText", () => {
  it("lists each provider's models by price with failures inline", async () => {
    const text = await modelsText(
      [
        provider("codex", async () => [model("gpt-6-astra", 50), model("gpt-6-luna", 0.5)]),
        provider("broken", () => Promise.reject(new Error("down"))),
        provider("local", async () => [model("qwen")]),
      ],
      logger,
    );

    expect(text).toBe(
      [
        "모델 목록 (출력 100만 토큰당 가격)",
        "codex (2개)\n- gpt-6-luna ($0.5)\n- gpt-6-astra ($50)",
        "broken: 모델 목록을 불러오지 못했어요.",
        "local (1개)\n- qwen",
      ].join("\n\n"),
    );
  });
});
