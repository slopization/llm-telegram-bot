import type { Api } from "grammy";
import { fileMedia } from "../pipeline/answer.ts";
import { plain } from "../render/formatted.ts";
import { formatRunMessage, runTranscriptText } from "../render/run.ts";
import { split } from "../render/split.ts";
import type { Language } from "../sandbox/run.ts";
import { strings } from "../strings.ts";
import { type Destination, sendChunks, sendFormatted } from "../telegram/send.ts";
import { Typing } from "../telegram/typing.ts";
import { dayOf } from "../time.ts";
import type { Deps } from "./deps.ts";

export interface CodeJob {
  destination: Destination;
  userId: number;
  language: Language;
  code: string;
}

export async function runCode(deps: Deps, api: Api, job: CodeJob): Promise<void> {
  const { config, repo } = deps;
  const { destination } = job;
  const logger = deps.logger.child({ chatId: destination.chatId, language: job.language });
  const typing = new Typing(api, destination, logger);
  typing.start();

  let result: Awaited<ReturnType<typeof deps.sandbox.run>>;
  try {
    result = await deps.sandbox.run(job.language, job.code, true);
  } catch (err) {
    logger.error({ err }, "sandbox run failed");
    await sendFormatted(api, destination, plain(strings.errors.sandbox), destination.replyTo);
    return;
  } finally {
    typing.stop();
  }

  const message = formatRunMessage(
    job.language,
    result,
    config.sandbox.outputChars,
    config.sandbox.timeoutSeconds,
  );
  const messageIds = await sendChunks(api, destination, split(message), destination.replyTo);
  const runId = repo.insertNode({
    parentId: null,
    chatId: destination.chatId,
    userId: job.userId,
    kind: "run",
    text: runTranscriptText(job.language, job.code, result, config.sandbox.timeoutSeconds),
    sandboxRuns: 1,
    day: dayOf(Date.now(), config.timezone),
  });
  repo.linkMessages(destination.chatId, messageIds, runId);
  const first = messageIds[0];
  if (result.files.length > 0 && first !== undefined) {
    const media = result.files.map((file) => fileMedia(file.name, file.data));
    repo.linkMessages(destination.chatId, await deps.media.send(destination, first, media), runId);
  }
  logger.info({ exitCode: result.exitCode, durationMs: result.durationMs }, "code ran");
}
