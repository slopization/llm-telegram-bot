import { describe, expect, it } from "vitest";
import {
  answerMarkdown,
  appendFooter,
  DETAILS_MARKER,
  renderAnswer,
} from "../../src/render/answer.ts";
import { type Formatted, plain } from "../../src/render/formatted.ts";

function entityTypes(formatted: Formatted): string[] {
  return formatted.entities.map((entity) => entity.type);
}

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

  it("folds everything after the marker into one expandable quote", () => {
    const rendered = renderAnswer([
      { kind: "text", markdown: `짧은 **답**\n\n${DETAILS_MARKER}\n\n## 근거\n\n- \`x\` 하나` },
    ]);

    expect(rendered.text).toBe("짧은 답\n\n근거\n\n- x 하나");
    expect(entityTypes(rendered)).toEqual(["bold", "expandable_blockquote", "bold"]);
    expect(rendered.entities[1]).toMatchObject({ offset: 6, length: 10 });
  });

  it("folds run segments before the lead behind it without nesting quotes", () => {
    const rendered = renderAnswer([
      { kind: "text", markdown: "계산" },
      { kind: "run", language: "python", code: "print(42)", output: "42" },
      { kind: "text", markdown: `답은 42\n${DETAILS_MARKER}\n설명` },
    ]);

    expect(rendered.text).toBe(
      "답은 42\n\n계산\n\n코드 실행 (Python)\nprint(42)\n\n출력\n42\n\n설명",
    );
    expect(entityTypes(rendered)).toEqual(["expandable_blockquote", "bold", "bold"]);
  });

  it("renders flat without a lead before the marker", () => {
    expect(renderAnswer([{ kind: "text", markdown: `${DETAILS_MARKER}\n전문` }])).toEqual({
      text: "전문",
      entities: [],
    });
  });

  it("shows only the lead when nothing follows the marker", () => {
    expect(renderAnswer([{ kind: "text", markdown: `짧은 답\n${DETAILS_MARKER}\n` }])).toEqual({
      text: "짧은 답",
      entities: [],
    });
  });

  it("folds at the first marker and drops the rest", () => {
    const rendered = renderAnswer([
      { kind: "text", markdown: `요약\n${DETAILS_MARKER}\n앞\n\n${DETAILS_MARKER}\n\n뒤` },
    ]);

    expect(rendered.text).toBe("요약\n\n앞\n\n뒤");
    expect(entityTypes(rendered)).toEqual(["expandable_blockquote"]);
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
