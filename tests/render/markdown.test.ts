import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../src/render/markdown.ts";

describe("renderMarkdown", () => {
  it("maps inline styles to tags", () => {
    expect(renderMarkdown("**b** *i* ~~s~~ `c <x>` [링크](https://a.b)")).toBe(
      '<p><b>b</b> <i>i</i> <s>s</s> <code>c &lt;x&gt;</code> <a href="https://a.b">링크</a></p>',
    );
  });

  it("turns soft breaks into line-break tags", () => {
    expect(renderMarkdown("줄1\n줄2\n\n다음")).toBe("<p>줄1<br/>\n줄2</p>\n<p>다음</p>");
  });

  it("escapes raw html and keeps resolved entities", () => {
    expect(renderMarkdown("<div>x</div>")).toBe("<p>&lt;div&gt;x&lt;/div&gt;</p>");
    expect(renderMarkdown("a <b> &amp; b & c")).toBe("<p>a &lt;b&gt; &amp; b &amp; c</p>");
  });

  it("renders fenced code with a language class", () => {
    expect(renderMarkdown("```ts\nconst x = a < b;\n```")).toBe(
      '<pre><code class="language-ts">const x = a &lt; b;</code></pre>',
    );
  });

  it("keeps heading levels", () => {
    expect(renderMarkdown("### 제목")).toBe("<h3>제목</h3>");
  });

  it("renders nested and ordered lists", () => {
    expect(renderMarkdown("- a\n  - b\n- c\n\n3. x")).toBe(
      ["<ul>", "<li>a", "<ul>", "<li>b</li>", "</ul></li>", "<li>c</li>", "</ul>"]
        .concat(['<ol start="3">', "<li>x</li>", "</ol>"])
        .join("\n"),
    );
  });

  it("renders task lists as checkboxes", () => {
    expect(renderMarkdown("- [x] done\n- [ ] todo")).toBe(
      [
        "<ul>",
        '<li><input type="checkbox" checked/>done</li>',
        '<li><input type="checkbox"/>todo</li>',
        "</ul>",
      ].join("\n"),
    );
  });

  it("flattens lists nested past the depth cap", () => {
    const markdown = Array.from({ length: 8 }, (_, i) => `${"  ".repeat(i)}- d${i + 1}`).join("\n");
    const html = renderMarkdown(markdown);

    expect(html.match(/<ul>/g)).toHaveLength(6);
    expect(html).toContain("<p>• d7<br/>\n• d8</p>");
  });

  it("renders tables with alignment", () => {
    expect(renderMarkdown("| a | b |\n|:--|--:|\n| **1** | 2 |")).toBe(
      [
        "<table bordered>",
        '<tr><th align="left">a</th><th align="right">b</th></tr>',
        '<tr><td align="left"><b>1</b></td><td align="right">2</td></tr>',
        "</table>",
      ].join("\n"),
    );
  });

  it("links safe schemes only", () => {
    expect(renderMarkdown("[x](javascript:alert(1)) [y](/relative)")).toBe("<p>x y</p>");
  });

  it("caps blockquote nesting at three", () => {
    expect(renderMarkdown("> > > > 깊은").match(/<blockquote>/g)).toHaveLength(3);
  });

  it("drops inline tags past the depth cap", () => {
    const html = renderMarkdown("**a *b ~~c **d *e ~~f~~***~~***");

    expect(html).not.toMatch(/(<[bis]>){6}/);
    expect(html.replace(/<[^>]+>/g, "")).toBe("a b c d e f");
  });

  it("closes emphasis after punctuation when a CJK particle follows", () => {
    expect(renderMarkdown("총 **O(E log E)**가 **굵게(괄호)**입니다 *기울(임)*이")).toBe(
      "<p>총 <b>O(E log E)</b>가 <b>굵게(괄호)</b>입니다 <i>기울(임)</i>이</p>",
    );
    expect(renderMarkdown("좋아요**👍**입니다")).toBe("<p>좋아요<b>👍</b>입니다</p>");
  });

  it("opens emphasis before punctuation when a CJK character precedes", () => {
    expect(renderMarkdown('이것은**"인용"**입니다')).toBe('<p>이것은<b>"인용"</b>입니다</p>');
  });

  it("renders inline and display math with escaped source", () => {
    expect(renderMarkdown("넓이 $\\pi r^2$, 조건 \\(a<b\\)")).toBe(
      "<p>넓이 <tg-math>\\pi r^2</tg-math>, 조건 <tg-math>a&lt;b</tg-math></p>",
    );
    expect(renderMarkdown("$$\n\\int_0^1 x\\,dx\n$$")).toBe(
      "<tg-math-block>\\int_0^1 x\\,dx</tg-math-block>",
    );
    expect(renderMarkdown("\\[ E = mc^2 \\]")).toBe("<tg-math-block>E = mc^2</tg-math-block>");
    expect(renderMarkdown("```math\na^2+b^2\n```")).toBe("<tg-math-block>a^2+b^2</tg-math-block>");
  });

  it("leaves currency amounts and code alone", () => {
    expect(renderMarkdown("가격은 $5 and $10, 범위 $5-$10")).toBe(
      "<p>가격은 $5 and $10, 범위 $5-$10</p>",
    );
    expect(renderMarkdown("`$x$`")).toBe("<p><code>$x$</code></p>");
  });

  it("closes emphasis around math before a CJK particle", () => {
    expect(renderMarkdown("총 **$O(E \\log E)$**가")).toBe(
      "<p>총 <b><tg-math>O(E \\log E)</tg-math></b>가</p>",
    );
  });

  it("keeps non-CJK flanking rules", () => {
    expect(renderMarkdown("**foo(bar)**baz")).toBe("<p>**foo(bar)**baz</p>");
  });
});
