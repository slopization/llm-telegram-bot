import type { MessageEntity } from "grammy/types";
import type { Language, RunResult } from "../sandbox/run.ts";
import { strings } from "../strings.ts";
import { concat, type Formatted, plain } from "./formatted.ts";

export const LANGUAGE_LABELS: Record<Language, string> = {
  python: "Python",
  javascript: "JavaScript",
  bash: "Bash",
};

export function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, maxChars) + strings.runTruncated : text;
}

function styled(type: "bold" | "pre", text: string): Formatted {
  const entity: MessageEntity = { type, offset: 0, length: text.length };
  return { text, entities: text === "" ? [] : [entity] };
}

export function runNotices(result: RunResult, timeoutSeconds: number): string[] {
  const notices: string[] = [];
  if (result.timedOut) notices.push(strings.runTimedOut(timeoutSeconds));
  if (result.outOfMemory) notices.push(strings.runOutOfMemory);
  if (result.totalFiles > result.files.length) {
    notices.push(strings.runFilesTruncated(result.files.length, result.totalFiles));
  }
  return notices;
}

export function runSummary(language: Language, result: RunResult): string {
  return strings.runSummary(
    LANGUAGE_LABELS[language],
    result.exitCode,
    (result.durationMs / 1000).toFixed(2),
  );
}

export function formatRunMessage(
  language: Language,
  result: RunResult,
  outputChars: number,
  timeoutSeconds: number,
): Formatted {
  const parts: Formatted[] = [styled("bold", runSummary(language, result))];
  const stdout = result.stdout.trimEnd();
  const stderr = result.stderr.trimEnd();
  if (stdout !== "") parts.push(plain("\n\n"), styled("pre", truncate(stdout, outputChars)));
  if (stderr !== "") {
    parts.push(plain("\n\nstderr\n"), styled("pre", truncate(stderr, outputChars)));
  }
  if (stdout === "" && stderr === "" && result.files.length === 0) {
    parts.push(plain(`\n\n${strings.runNoOutput}`));
  }
  for (const notice of runNotices(result, timeoutSeconds)) parts.push(plain(`\n\n${notice}`));
  return concat(...parts);
}

export function runOutputText(result: RunResult, timeoutSeconds: number): string {
  const output = [result.stdout.trimEnd(), result.stderr.trimEnd()].filter((text) => text !== "");
  const notices = runNotices(result, timeoutSeconds);
  return [output.length > 0 ? output.join("\n") : strings.runNoOutput, ...notices].join("\n");
}

export function runTranscriptText(
  language: Language,
  code: string,
  result: RunResult,
  timeoutSeconds: number,
): string {
  return [
    `\`\`\`${language}\n${code}\n\`\`\``,
    runSummary(language, result),
    runOutputText(result, timeoutSeconds),
  ].join("\n\n");
}
