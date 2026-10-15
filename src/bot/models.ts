import type { Logger } from "../log.ts";
import { sortModels } from "../providers/models.ts";
import type { ModelInfo, Provider } from "../providers/types.ts";
import { strings } from "../strings.ts";

function price(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function modelLine(model: ModelInfo): string {
  return strings.modelsLine(
    model.id,
    model.outputPricePerMTok === undefined ? undefined : price(model.outputPricePerMTok),
  );
}

async function providerSection(provider: Provider, logger: Logger): Promise<string> {
  try {
    const models = sortModels(await provider.listModels());
    return [strings.modelsHeader(provider.name, models.length), ...models.map(modelLine)].join(
      "\n",
    );
  } catch (err) {
    logger.error({ err, provider: provider.name }, "model list failed");
    return strings.modelsFailed(provider.name);
  }
}

export async function modelsText(providers: readonly Provider[], logger: Logger): Promise<string> {
  const sections = await Promise.all(
    providers.map((provider) => providerSection(provider, logger)),
  );
  return [strings.modelsTitle, ...sections].join("\n\n");
}
