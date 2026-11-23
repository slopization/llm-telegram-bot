import type { MessageEntity } from "grammy/types";
import type { TokenUsage } from "../providers/types.ts";
import type { Language } from "../sandbox/run.ts";
import { strings } from "../strings.ts";
import { concat, type Formatted, plain } from "./formatted.ts";
import { renderMarkdown } from "./markdown.ts";
import { LANGUAGE_LABELS, truncate } from "./run.ts";

const RUN_BLOCK_OUTPUT_CHARS = 1500;

export const DETAILS_MARKER = "[[DETAILS]]";

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

function expandable(body: Formatted): Formatted {
  const quote: MessageEntity = {
    type: "expandable_blockquote",
    offset: 0,
    length: body.text.length,
  };
  return { text: body.text, entities: [quote, ...body.entities] };
}

function runBody(segment: Extract<AnswerSegment, { kind: "run" }>): Formatted {
  return concat(
    bold(strings.runHeader(LANGUAGE_LABELS[segment.language])),
    plain(`\n${segment.code}\n\n`),
    bold(strings.runOutputHeader),
    plain(`\n${truncate(segment.output, RUN_BLOCK_OUTPUT_CHARS)}`),
  );
}

function renderSegments(segments: readonly AnswerSegment[], insideQuote: boolean): Formatted {
  const parts: Formatted[] = [];
  for (const segment of segments) {
    const rendered =
      segment.kind === "text"
        ? renderMarkdown(segment.markdown, insideQuote)
        : insideQuote
          ? runBody(segment)
          : expandable(runBody(segment));
    if (rendered.text === "") continue;
    if (parts.length > 0) parts.push(plain("\n\n"));
    parts.push(rendered);
  }
  return concat(...parts);
}

function splitLead(segments: readonly AnswerSegment[]): { lead: string; body: AnswerSegment[] } {
  let lead: string | undefined;
  const body: AnswerSegment[] = [];
  for (const segment of segments) {
    if (segment.kind === "run") {
      body.push(segment);
      continue;
    }
    const [before = "", ...after] = segment.markdown.split(DETAILS_MARKER);
    if (lead === undefined && after.length > 0) {
      lead = before;
      body.push({ kind: "text", markdown: after.join("") });
    } else {
      body.push({ kind: "text", markdown: [before, ...after].join("") });
    }
  }
  return { lead: lead ?? "", body };
}

export function renderAnswer(segments: readonly AnswerSegment[]): Formatted {
  const { lead, body } = splitLead(segments);
  if (lead.trim() === "") return renderSegments(body, false);
  const visible = renderMarkdown(lead);
  const folded = renderSegments(body, true);
  return folded.text === "" ? visible : concat(visible, plain("\n\n"), expandable(folded));
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
