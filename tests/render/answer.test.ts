import { describe, expect, it } from "vitest";
import { answerMarkdown, appendFooter, renderAnswer } from "../../src/render/answer.ts";
import { plain } from "../../src/render/formatted.ts";

const usage = {
  inputTokens: 200,
  cacheReadTokens: 1000,
  cacheWriteTokens: 34,
  outputTokens: 567,
  webSearches: 0,
};

describe("renderAnswer", () => {
  it("renders run segments as expandable quotes between text", () => {
    const rendered = renderAnswer([
      { kind: "text", markdown: "**before**" },
      { kind: "run", language: "python", code: "print(1)", output: "1" },
      { kind: "text", markdown: "after" },
    ]);

    expect(rendered.text).toBe("before\n\n코드 실행 (Python)\nprint(1)\n\n출력\n1\n\nafter");
    expect(rendered.entities.map((entity) => entity.type)).toEqual([
      "bold",
      "expandable_blockquote",
      "bold",
      "bold",
    ]);
  });

  it("keeps only text segments in the stored markdown", () => {
    expect(
      answerMarkdown([
        { kind: "text", markdown: "a" },
        { kind: "run", language: "bash", code: "ls", output: "" },
        { kind: "text", markdown: "b" },
      ]),
    ).toBe("a\n\nb");
  });
});

describe("appendFooter", () => {
  it("adds an italic model and token footer with cache hits", () => {
    const rendered = appendFooter(plain("answer"), "codex", "gpt-6-luna", usage);

    expect(rendered.text).toBe(
      "answer\n\n모델: codex/gpt-6-luna\n토큰: 입력 1,234 (캐시 1,000), 출력 567",
    );
    expect(rendered.entities).toEqual([{ type: "italic", offset: 8, length: 52 }]);
  });

  it("omits the cache part without cache hits", () => {
    expect(appendFooter(plain("a"), "p", "m", { ...usage, cacheReadTokens: 0 }).text).toBe(
      "a\n\n모델: p/m\n토큰: 입력 234, 출력 567",
    );
  });

  it("shows only the model when usage is unreported", () => {
    const unreported = {
      ...usage,
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
    };
    expect(appendFooter(plain("a"), "p", "m", unreported).text).toBe("a\n\n모델: p/m");
  });
});
