import { expect, it } from "vitest";
import { MAX_BLOCKS, MAX_BYTES, splitRichHtml } from "../../src/render/rich-split.ts";

const bytes = (text: string): number => Buffer.byteLength(text, "utf8");
const TOGGLE = "<details><summary>모두 보기</summary>";

it("keeps a small document in one chunk", () => {
  expect(splitRichHtml("<p>a</p>\n<p>b</p>")).toEqual(["<p>a</p>\n<p>b</p>"]);
});

it("yields nothing for empty or tag-only input", () => {
  expect(splitRichHtml("  \n ")).toEqual([]);
  expect(splitRichHtml("<hr/>")).toEqual([]);
});

it("budgets chunks in UTF-8 bytes", () => {
  const html = Array.from({ length: 10 }, () => `<p>${"가".repeat(3000)}</p>`).join("\n");
  const chunks = splitRichHtml(html);

  expect(chunks.length).toBeGreaterThan(1);
  for (const chunk of chunks) expect(bytes(chunk)).toBeLessThanOrEqual(MAX_BYTES);
  expect(chunks.join("\n")).toBe(html);
});

it("keeps chunks within the block budget", () => {
  const html = Array.from({ length: MAX_BLOCKS + 10 }, (_, i) => `<p>${i}</p>`).join("\n");

  expect(splitRichHtml(html).map((chunk) => chunk.match(/<p>/g)?.length)).toEqual([MAX_BLOCKS, 10]);
});

it("reopens a toggle with its summary in every chunk", () => {
  const lines = Array.from({ length: 20 }, () => `<p>${"가".repeat(2000)}</p>`).join("\n");
  const chunks = splitRichHtml(`<p>요약</p>\n${TOGGLE}\n${lines}\n</details>\n<p>끝</p>`);

  expect(chunks.length).toBeGreaterThan(1);
  for (const chunk of chunks) {
    expect(bytes(chunk)).toBeLessThanOrEqual(MAX_BYTES);
    expect(chunk.match(/<details><summary>모두 보기<\/summary>/g)).toHaveLength(1);
    expect(chunk.match(/<\/details>/g)).toHaveLength(1);
  }
  expect(chunks.at(-1)).toMatch(/<\/details>\n<p>끝<\/p>$/);
});

it("force-cuts an overlong line outside tags, entities and surrogate pairs", () => {
  const html = `<p><b>${"aa&amp;😀".repeat(5000)}</b></p>`;
  const chunks = splitRichHtml(html);

  expect(chunks.length).toBeGreaterThan(1);
  for (const chunk of chunks) {
    expect(bytes(chunk)).toBeLessThanOrEqual(MAX_BYTES);
    expect(chunk).toMatch(/^<p><b>/);
    expect(chunk).toMatch(/<\/b><\/p>$/);
    expect(chunk).not.toMatch(/&a?m?p?<|[\uD800-\uDBFF]</);
  }
});
