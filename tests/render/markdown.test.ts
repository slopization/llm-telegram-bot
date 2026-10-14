import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../src/render/markdown.ts";

function entityText(markdown: string) {
  const { text, entities } = renderMarkdown(markdown);
  return entities.map((entity) => ({
    type: entity.type,
    text: text.slice(entity.offset, entity.offset + entity.length),
  }));
}

describe("renderMarkdown", () => {
  it("maps inline styles to entities", () => {
    expect(entityText("**b** *i* ~~s~~ `c`")).toEqual([
      { type: "bold", text: "b" },
      { type: "italic", text: "i" },
      { type: "strikethrough", text: "s" },
      { type: "code", text: "c" },
    ]);
  });

  it("keeps code text unescaped", () => {
    expect(renderMarkdown("`a < b && c`").text).toBe("a < b && c");
  });

  it("decodes html entities in text", () => {
    expect(renderMarkdown("a &amp; b &lt;c&gt;").text).toBe("a & b <c>");
  });

  it("renders fenced code as pre with language", () => {
    const { text, entities } = renderMarkdown("```ts\nconst x = 1;\n```");

    expect(text).toBe("const x = 1;");
    expect(entities).toEqual([{ type: "pre", language: "ts", offset: 0, length: 12 }]);
  });

  it("renders headings as bold lines", () => {
    expect(renderMarkdown("# 제목\n\n본문").text).toBe("제목\n\n본문");
    expect(entityText("# 제목")).toEqual([{ type: "bold", text: "제목" }]);
  });

  it("renders nested and ordered lists", () => {
    expect(renderMarkdown("- a\n  - b\n- c\n\n3. x\n4. y").text).toBe(
      "- a\n  - b\n- c\n\n3. x\n4. y",
    );
  });

  it("renders task lists", () => {
    expect(renderMarkdown("- [x] done\n- [ ] todo").text).toBe("- [x] done\n- [ ] todo");
  });

  it("renders tables as aligned pre with wide characters counted twice", () => {
    const { text, entities } = renderMarkdown("| 이름 | n |\n|---|--:|\n| ab | 1 |");

    expect(text).toBe("이름 | n\n-----+--\nab   | 1");
    expect(entities.map((entity) => entity.type)).toEqual(["pre"]);
  });

  it("renders links with safe protocols only", () => {
    expect(renderMarkdown("[x](https://a.com)").entities).toEqual([
      { type: "text_link", url: "https://a.com", offset: 0, length: 1 },
    ]);
    expect(renderMarkdown("[x](javascript:alert(1))").entities).toEqual([]);
  });

  it("does not nest code inside bold", () => {
    expect(entityText("**a `b` c**")).toEqual([{ type: "bold", text: "a b c" }]);
  });

  it("keeps quotes free of code, pre and links", () => {
    const markdown = "> see `x` and [doc](https://d.com)\n>\n> ```\n> code\n> ```";

    expect(renderMarkdown(markdown).text).toBe("see x and doc (https://d.com)\n\ncode");
    expect(entityText(markdown).map((entity) => entity.type)).toEqual(["blockquote"]);
  });

  it("flattens nested quotes", () => {
    expect(entityText("> a\n>> b").map((entity) => entity.type)).toEqual(["blockquote"]);
  });

  it("treats an unclosed fence as code to the end", () => {
    expect(entityText("text\n\n```py\nprint(1)")).toEqual([{ type: "pre", text: "print(1)" }]);
  });

  it("trims trailing whitespace", () => {
    expect(renderMarkdown("a\n\n\n").text).toBe("a");
  });
});
