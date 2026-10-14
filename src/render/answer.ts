import type { MessageEntity } from "grammy/types";
import type { TokenUsage } from "../providers/types.ts";
import type { Language } from "../sandbox/run.ts";
import { strings } from "../strings.ts";
import { concat, type Formatted, plain } from "./formatted.ts";
import { renderMarkdown } from "./markdown.ts";
import { LANGUAGE_LABELS, truncate } from "./run.ts";

const RUN_BLOCK_OUTPUT_CHARS = 1500;

export type AnswerSegment =
  | { kind: "text"; markdown: string }
  | { kind: "run"; language: Language; code: string; output: string };

export function appendText(segments: AnswerSegment[], text: string): void {
  const last = segments.at(-1);
  if (last?.kind === "text") last.markdown += text;
  else segments.push({ kind: "text", markdown: text });
}

export function answerMarkdown(segments: readonly AnswerSegment[]): string {
  return segments
    .flatMap((segment) => (segment.kind === "text" ? [segment.markdown] : []))
    .join("\n\n")
    .trim();
}

function bold(text: string): Formatted {
  return { text, entities: [{ type: "bold", offset: 0, length: text.length }] };
}

function runBlock(segment: Extract<AnswerSegment, { kind: "run" }>): Formatted {
  const body = concat(
    bold(strings.runHeader(LANGUAGE_LABELS[segment.language])),
    plain(`\n${segment.code}\n\n`),
    bold(strings.runOutputHeader),
    plain(`\n${truncate(segment.output, RUN_BLOCK_OUTPUT_CHARS)}`),
  );
  const quote: MessageEntity = {
    type: "expandable_blockquote",
    offset: 0,
    length: body.text.length,
  };
  return { text: body.text, entities: [quote, ...body.entities] };
}

export function renderAnswer(segments: readonly AnswerSegment[]): Formatted {
  const parts: Formatted[] = [];
  for (const segment of segments) {
    const rendered = segment.kind === "text" ? renderMarkdown(segment.markdown) : runBlock(segment);
    if (rendered.text === "") continue;
    if (parts.length > 0) parts.push(plain("\n\n"));
    parts.push(rendered);
  }
  return concat(...parts);
}

function count(tokens: number): string {
  return tokens.toLocaleString("en-US");
}

function tokenLine(usage: TokenUsage): string | undefined {
  const input = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  if (input === 0 && usage.outputTokens === 0) return undefined;
  const cached = usage.cacheReadTokens > 0 ? count(usage.cacheReadTokens) : undefined;
  return strings.tokenUsage(count(input), cached, count(usage.outputTokens));
}

export function appendFooter(
  answer: Formatted,
  provider: string,
  model: string,
  usage: TokenUsage,
): Formatted {
  const modelLine = strings.modelUsed(provider, model);
  const tokens = tokenLine(usage);
  const text = tokens === undefined ? modelLine : `${modelLine}\n${tokens}`;
  const footer: Formatted = {
    text,
    entities: [{ type: "italic", offset: 0, length: text.length }],
  };
  return answer.text === "" ? footer : concat(answer, plain("\n\n"), footer);
}
