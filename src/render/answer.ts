import type { MessageEntity } from "grammy/types";
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
