import type { Api } from "grammy";
import { generateAnswer } from "../pipeline/answer.ts";
import { buildMessages } from "../pipeline/context.ts";
import { classifyError, EmptyAnswerError } from "../pipeline/errors.ts";
import { answerMarkdown, appendText, renderAnswer } from "../render/answer.ts";
import { plain } from "../render/formatted.ts";
import { strings } from "../strings.ts";
import { type Destination, sendFormatted } from "../telegram/send.ts";
import { type AnswerSink, DraftSink, GroupSink } from "../telegram/sinks.ts";
import { dayOf } from "../time.ts";
import type { Deps } from "./deps.ts";

export interface AnswerJob {
  promptNodeId: number;
  destination: Destination;
  userId: number;
}

function sinkFor(deps: Deps, api: Api, destination: Destination, model: string): AnswerSink {
  return destination.isPrivate
    ? new DraftSink(api, destination, deps.config.telegram.draftIntervalMs, deps.logger)
    : new GroupSink(api, destination, model, deps.logger);
}

export async function runAnswer(deps: Deps, api: Api, job: AnswerJob): Promise<void> {
  const { config, repo } = deps;
  const { destination } = job;
  const prompt = repo.node(job.promptNodeId);
  const provider = deps.providers.find((candidate) => candidate.name === prompt?.provider);
  if (prompt === undefined || prompt.model === null || provider === undefined) {
    await sendFormatted(api, destination, plain(strings.errors.noModel), destination.replyTo);
    return;
  }

  const model = prompt.model;
  const day = dayOf(Date.now(), config.timezone);
  const usage = repo.dailyUsage(job.userId, day);
  const webConfig = config.tools.webSearch;
  const webRemaining = webConfig.dailyLimitPerUser - usage.webSearches;
  const runsRemaining = config.sandbox.dailyLimitPerUser - usage.sandboxRuns;
  const logger = deps.logger.child({ chatId: destination.chatId, promptNodeId: prompt.id, model });

  const sink = sinkFor(deps, api, destination, model);
  const timeout = AbortSignal.timeout(config.chat.timeoutSeconds * 1000);
  try {
    await sink.start();
    const info = (await provider.listModels()).find((candidate) => candidate.id === model);
    const adapter = provider.adapterFor(model);
    const webAvailable =
      webConfig.enabled && adapter.supportsWebSearch && (info?.webSearch ?? false);
    const result = await generateAnswer({
      adapter,
      model,
      maxOutputTokens: info?.maxOutputTokens,
      messages: buildMessages(repo.chain(prompt.id, config.chat.maxContextNodes), adapter.kind),
      webSearch:
        webAvailable && webRemaining > 0
          ? { maxUses: Math.min(webConfig.maxUsesPerRequest, webRemaining) }
          : undefined,
      sandbox:
        config.sandbox.enabled && runsRemaining > 0
          ? {
              runner: deps.sandbox,
              limits: config.sandbox,
              runsAllowed: Math.min(config.sandbox.maxRunsPerRequest, runsRemaining),
            }
          : undefined,
      signal: AbortSignal.any([deps.shutdown, timeout]),
      onUpdate: (segments) => sink.update(renderAnswer(segments)),
      costOf: provider.costOf && ((usage) => provider.costOf?.(model, usage)),
    });
    if (result.segments.length === 0 && result.media.length === 0) throw new EmptyAnswerError();
    if (webAvailable && webRemaining <= 0)
      appendText(result.segments, strings.webSearchQuotaNotice);

    const messageIds = await sink.finish(renderAnswer(result.segments));
    const answerId = repo.insertNode({
      parentId: prompt.id,
      chatId: destination.chatId,
      userId: job.userId,
      kind: "answer",
      text: answerMarkdown(result.segments),
      provider: provider.name,
      model,
      transcript: { adapter: adapter.kind, messages: result.transcript },
      inputTokens: result.inputTokens,
      cacheReadTokens: result.cacheReadTokens,
      cacheWriteTokens: result.cacheWriteTokens,
      outputTokens: result.outputTokens,
      webSearches: result.webSearches,
      sandboxRuns: result.sandboxRuns,
      costUsd: result.costUsd ?? null,
      day,
    });
    repo.linkMessages(destination.chatId, messageIds, answerId);
    const first = messageIds[0];
    if (result.media.length > 0 && first !== undefined) {
      repo.linkMessages(
        destination.chatId,
        await deps.media.send(destination, first, result.media),
        answerId,
      );
    }
    logger.info(
      {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        sandboxRuns: result.sandboxRuns,
      },
      "answered",
    );
  } catch (err) {
    if (deps.shutdown.aborted) return;
    const kind = classifyError(err, timeout.aborted);
    logger.error({ err, kind }, "answer failed");
    const text = strings.errors[kind];
    const messageIds = await sink.fail(text).catch((failure: unknown) => {
      logger.warn({ err: failure }, "error message send failed");
      return [];
    });
    const errorId = repo.insertNode({
      parentId: prompt.id,
      chatId: destination.chatId,
      userId: job.userId,
      kind: "error",
      text,
      day,
    });
    repo.linkMessages(destination.chatId, messageIds, errorId);
  }
}
