import { describe, expect, it } from "vitest";
import {
  answerMarkdown,
  appendFooter,
  appendSources,
  DETAILS_MARKER,
  renderAnswer,
} from "../../src/render/answer.ts";

const usage = {
  inputTokens: 200,
  cacheReadTokens: 1000,
  cacheWriteTokens: 34,
  outputTokens: 567,
  webSearches: 0,
};

const run = { kind: "run", language: "python", code: "print(1)", output: "1" } as const;

const RUN_BODY = [
  '<pre><code class="language-python">print(1)</code></pre>',
  "<p><b>출력</b></p>",
  "<pre><code>1</code></pre>",
].join("\n");

describe("renderAnswer", () => {
  it("folds run segments behind their own toggle between text", () => {
    expect(
      renderAnswer([
        { kind: "text", markdown: "**before**" },
        run,
        { kind: "text", markdown: "after" },
      ]),
    ).toBe(
      [
        "<p><b>before</b></p>",
        "<details><summary>코드 실행 (Python)</summary>",
        RUN_BODY,
        "</details>",
        "<p>after</p>",
      ].join("\n"),
    );
  });

  it("folds everything after the marker behind one toggle", () => {
    expect(
      renderAnswer([{ kind: "text", markdown: `짧은 **답**\n\n${DETAILS_MARKER}\n\n## 근거` }]),
    ).toBe(
      [
        "<p>짧은 <b>답</b></p>",
        "<details><summary>모두 보기</summary>",
        "<h2>근거</h2>",
        "</details>",
      ].join("\n"),
    );
  });

  it("folds run segments before the lead without nesting toggles", () => {
    expect(
      renderAnswer([
        { kind: "text", markdown: "계산" },
        run,
        { kind: "text", markdown: `답은 1\n${DETAILS_MARKER}\n설명` },
      ]),
    ).toBe(
      [
        "<p>답은 1</p>",
        "<details><summary>모두 보기</summary>",
        "<p>계산</p>",
        "<p><b>코드 실행 (Python)</b></p>",
        RUN_BODY,
        "<p>설명</p>",
        "</details>",
      ].join("\n"),
    );
  });

  it("renders flat without a lead before the marker", () => {
    expect(renderAnswer([{ kind: "text", markdown: `${DETAILS_MARKER}\n전문` }])).toBe(
      "<p>전문</p>",
    );
  });

  it("shows only the lead when nothing follows the marker", () => {
    expect(renderAnswer([{ kind: "text", markdown: `짧은 답\n${DETAILS_MARKER}\n` }])).toBe(
      "<p>짧은 답</p>",
    );
  });

  it("folds at the first marker and drops the rest", () => {
    expect(
      renderAnswer([
        { kind: "text", markdown: `요약\n${DETAILS_MARKER}\n앞\n\n${DETAILS_MARKER}\n\n뒤` },
      ]),
    ).toBe(
      [
        "<p>요약</p>",
        "<details><summary>모두 보기</summary>",
        "<p>앞</p>\n<p>뒤</p>",
        "</details>",
      ].join("\n"),
    );
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

describe("appendSources", () => {
  it("folds unique sources behind their own toggle", () => {
    expect(
      appendSources("<p>a</p>", [
        { url: "https://a.com", title: "A & B" },
        { url: "https://a.com", title: "dup" },
        { url: "javascript:x", title: null },
      ]),
    ).toBe(
      [
        "<p>a</p>",
        "<details><summary>출처 보기</summary>",
        "<ul>",
        '<li><a href="https://a.com">A &amp; B</a></li>',
        "<li>javascript:x</li>",
        "</ul>",
        "</details>",
      ].join("\n"),
    );
  });

  it("leaves the answer alone without sources", () => {
    expect(appendSources("<p>a</p>", [])).toBe("<p>a</p>");
  });
});

describe("appendFooter", () => {
  it("adds an italic model and token footer with cache hits", () => {
    expect(appendFooter("<p>answer</p>", "codex", "gpt-6-luna", usage)).toBe(
      "<p>answer</p>\n<p><i>모델: codex/gpt-6-luna<br/>\n토큰: 입력 1,234 (캐시 1,000), 출력 567</i></p>",
    );
  });

  it("omits the cache part without cache hits", () => {
    expect(appendFooter("", "p", "m", { ...usage, cacheReadTokens: 0 })).toBe(
      "<p><i>모델: p/m<br/>\n토큰: 입력 234, 출력 567</i></p>",
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
    expect(appendFooter("", "p", "<m>", unreported)).toBe("<p><i>모델: p/&lt;m&gt;</i></p>");
  });
});
