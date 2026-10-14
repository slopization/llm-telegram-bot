import { providerOf, show } from "./shared.ts";

const claude = providerOf("claude");
const claudeHeaders = {
  "x-api-key": claude.apiKey,
  "anthropic-version": "2023-06-01",
  "content-type": "application/json",
};

const claudeModelsResponse = await fetch(`${claude.apiUrl}/v1/models?limit=100`, {
  headers: claudeHeaders,
});
const claudeModels = (await claudeModelsResponse.json()) as Record<string, unknown>;
show("claude /v1/models status", claudeModelsResponse.status);
show(
  "claude /v1/models first entry",
  Array.isArray(claudeModels.data) ? claudeModels.data[0] : claudeModels,
);

const pingResponse = await fetch(`${claude.apiUrl}/v1/messages`, {
  method: "POST",
  headers: claudeHeaders,
  body: JSON.stringify({
    model: "claude-haiku-5-5",
    max_tokens: 5,
    messages: [{ role: "user", content: "hi" }],
  }),
});
show("claude /v1/messages status", pingResponse.status);
show(
  "claude rate limit headers",
  Object.fromEntries(
    [...pingResponse.headers].filter(([name]) => name.startsWith("anthropic-ratelimit")),
  ),
);
