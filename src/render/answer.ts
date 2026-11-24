import { type Source, uniqueSources } from "../providers/sources.ts";
import type { TokenUsage } from "../providers/types.ts";
import type { Language } from "../sandbox/run.ts";
import { strings } from "../strings.ts";
import { codeBlock, escapeAttribute, escapeHtml, renderMarkdown, safeHref } from "./markdown.ts";
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

type RunSegment = Extract<AnswerSegment, { kind: "run" }>;

function toggle(summary: string, body: string): string {
  return `<details><summary>${escapeHtml(summary)}</summary>\n${body}\n</details>`;
}

function runHeader(segment: RunSegment): string {
  return strings.runHeader(LANGUAGE_LABELS[segment.language]);
}

function runBody(segment: RunSegment): string {
  return [
    codeBlock(segment.code, segment.language),
    `<p><b>${escapeHtml(strings.runOutputHeader)}</b></p>`,
    codeBlock(truncate(segment.output, RUN_BLOCK_OUTPUT_CHARS)),
  ].join("\n");
}

function renderRun(segment: RunSegment, folded: boolean): string {
  if (!folded) return toggle(runHeader(segment), runBody(segment));
  return `<p><b>${escapeHtml(runHeader(segment))}</b></p>\n${runBody(segment)}`;
}

function renderSegments(segments: readonly AnswerSegment[], folded: boolean): string {
  return segments
    .map((segment) =>
      segment.kind === "text" ? renderMarkdown(segment.markdown) : renderRun(segment, folded),
    )
    .filter((rendered) => rendered !== "")
    .join("\n");
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

export function renderAnswer(segments: readonly AnswerSegment[]): string {
  const { lead, body } = splitLead(segments);
  if (lead.trim() === "") return renderSegments(body, false);
  const visible = renderMarkdown(lead);
  const folded = renderSegments(body, true);
  return folded === "" ? visible : `${visible}\n${toggle(strings.detailsSummary, folded)}`;
}

function sourceItem(source: Source): string {
  const label = escapeHtml(source.title || source.url);
  const href = safeHref(source.url);
  return `<li>${href === undefined ? label : `<a href="${escapeAttribute(href)}">${label}</a>`}</li>`;
}

export function appendSources(answer: string, sources: readonly Source[]): string {
  const unique = uniqueSources(sources);
  if (unique.length === 0) return answer;
  const list = ["<ul>", ...unique.map(sourceItem), "</ul>"].join("\n");
  const block = toggle(strings.sourcesSummary, list);
  return answer === "" ? block : `${answer}\n${block}`;
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
  answer: string,
  provider: string,
  model: string,
  usage: TokenUsage,
): string {
  const lines = [strings.modelUsed(provider, model), tokenLine(usage)].flatMap((line) =>
    line === undefined ? [] : [escapeHtml(line)],
  );
  const footer = `<p><i>${lines.join("<br/>\n")}</i></p>`;
  return answer === "" ? footer : `${answer}\n${footer}`;
}
