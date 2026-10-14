import { type Formatted, slice } from "./formatted.ts";

export const MESSAGE_LIMIT = 4096;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function cutPoint(text: string, start: number, limit: number): number {
  const hardEnd = start + limit;
  if (hardEnd >= text.length) return text.length;
  const newline = text.lastIndexOf("\n", hardEnd - 1);
  if (newline > start + limit / 2) return newline + 1;
  return isHighSurrogate(text.charCodeAt(hardEnd - 1)) ? hardEnd - 1 : hardEnd;
}

function skipNewlines(text: string, index: number): number {
  let result = index;
  while (text[result] === "\n") result++;
  return result;
}

export function splitRanges(text: string, from = 0, limit = MESSAGE_LIMIT): [number, number][] {
  const ranges: [number, number][] = [];
  let start = skipNewlines(text, from);
  while (start < text.length) {
    const end = cutPoint(text, start, limit);
    ranges.push([start, start + text.slice(start, end).trimEnd().length]);
    start = skipNewlines(text, end);
  }
  return ranges;
}

export function split(source: Formatted, limit = MESSAGE_LIMIT): Formatted[] {
  return splitRanges(source.text, 0, limit).map(([start, end]) => slice(source, start, end));
}
