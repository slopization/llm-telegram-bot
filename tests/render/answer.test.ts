import { describe, expect, it } from "vitest";
import { answerMarkdown, renderAnswer } from "../../src/render/answer.ts";

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
