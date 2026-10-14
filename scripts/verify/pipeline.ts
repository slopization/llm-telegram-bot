import { type ProviderType, parseConfig } from "../../src/config.ts";
import { log } from "../../src/log.ts";
import { generateAnswer } from "../../src/pipeline/answer.ts";
import { createProvider } from "../../src/providers/registry.ts";
import type { ChatMessage } from "../../src/providers/types.ts";
import { answerMarkdown } from "../../src/render/answer.ts";
import { Sandbox } from "../../src/sandbox/run.ts";
import { providerOf, show } from "./shared.ts";

const DEFAULT_MODELS: Record<ProviderType, string[]> = {
  mindlogic: ["claude-haiku-5-5", "gemini-3.5-flash-lite", "gpt-5.6-luna", "solar-mini4"],
  claude: ["claude-haiku-5-5"],
  "openai-compatible": [],
};
const FIRST_PROMPT =
  "run_code 도구로 파이썬을 실행해서 2의 100제곱을 계산하고, 웹 검색이 가능하면 오늘 서울 날씨도 찾아서 한국어로 짧게 답해줘.";
const FOLLOW_UP = "방금 계산한 값에 1을 더하면 얼마야? 숫자만 답해.";

const providerType = (process.env.PROVIDER ?? "mindlogic") as ProviderType;
const config = providerOf(providerType);
const limits = parseConfig({
  telegram: { "bot-token": "unused" },
  providers: [{ name: "unused", type: "mindlogic", "api-key": "unused" }],
}).sandbox;
const provider = createProvider(config);
const sandbox = new Sandbox(limits, log);
const models = await provider.listModels();
const requested = process.argv.slice(2);

for (const model of requested.length > 0 ? requested : DEFAULT_MODELS[providerType]) {
  const info = models.find((candidate) => candidate.id === model);
  const adapter = provider.adapterFor(model);
  const ask = (messages: ChatMessage[]) =>
    generateAnswer({
      adapter,
      model,
      maxOutputTokens: info?.maxOutputTokens,
      messages,
      webSearch: info?.webSearch ? { maxUses: 2 } : undefined,
      sandbox: { runner: sandbox, limits, runsAllowed: 2 },
      signal: AbortSignal.timeout(180_000),
      onUpdate: () => undefined,
      costOf: provider.costOf && ((usage) => provider.costOf?.(model, usage)),
    });
  try {
    const first: ChatMessage[] = [{ role: "user", text: FIRST_PROMPT }];
    const answer = await ask(first);
    show(`${model} (${adapter.kind}, webSearch=${info?.webSearch})`, {
      segments: answer.segments.map((segment) => segment.kind),
      sandboxRuns: answer.sandboxRuns,
      webSearches: answer.webSearches,
      tokens: [
        answer.inputTokens,
        answer.cacheReadTokens,
        answer.cacheWriteTokens,
        answer.outputTokens,
      ],
      costUsd: answer.costUsd,
      media: answer.media.length,
      text: answerMarkdown(answer.segments).slice(0, 400),
    });
    const followUp = await ask([...first, ...answer.transcript, { role: "user", text: FOLLOW_UP }]);
    show(`${model} follow-up`, {
      text: answerMarkdown(followUp.segments).slice(0, 200),
      tokens: [
        followUp.inputTokens,
        followUp.cacheReadTokens,
        followUp.cacheWriteTokens,
        followUp.outputTokens,
      ],
      costUsd: followUp.costUsd,
    });
  } catch (error) {
    show(`${model} failed`, String(error));
  }
}
